import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';
import { Response } from 'express';
import { AccountStatus } from './constants/account-status';
import {
  ACCESS_TOKEN_COOKIE,
  BCRYPT_ROUNDS,
  CSRF_HEADER,
  CSRF_TOKEN_COOKIE,
  LOCKOUT_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  ACCESS_TOKEN_TTL_SECONDS,
  INACTIVITY_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  REFRESH_TOKEN_COOKIE,
} from './constants/auth.constants';
import { UserRole } from './constants/roles';
import { AuthCookieService } from './cookies/auth-cookie.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import {
  RefreshSession,
  RefreshSessionDocument,
} from './schemas/refresh-session.schema';
import { User, UserDocument } from './schemas/user.schema';
import { AccessTokenPayload } from './types/jwt-payload';
import { AuthenticatedUser } from './types/authenticated-user';
import { generateOpaqueToken, hashToken } from './utils/token-hash';
import { SafeUser, toSafeUser } from './utils/safe-user';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(RefreshSession.name)
    private readonly refreshSessionModel: Model<RefreshSessionDocument>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly authCookieService: AuthCookieService,
  ) {}

  async register(registerDto: RegisterDto) {
    const email = registerDto.email.trim().toLowerCase();

    const existingUser = await this.userModel.findOne({ email });
    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(registerDto.password, BCRYPT_ROUNDS);

    const user = await this.userModel.create({
      name: registerDto.name.trim(),
      email,
      passwordHash,
      role: UserRole.USER,
      status: AccountStatus.ACTIVE,
      acceptedTerms: registerDto.acceptedTerms,
      acceptedPrivacyPolicy: registerDto.acceptedPrivacyPolicy,
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockUntil: null,
      phone: null,
      preferredCurrency: 'USD',
      providerType: null,
      providerId: null,
    });

    return {
      message: 'Registration successful',
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  async login(loginDto: LoginDto, response: Response) {
    const email = loginDto.email.trim().toLowerCase();

    const user = await this.userModel
      .findOne({ email })
      .select('+passwordHash');

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status === AccountStatus.SUSPENDED) {
      throw new UnauthorizedException('Account is suspended');
    }

    if (user.status === AccountStatus.DEACTIVATED) {
      throw new UnauthorizedException('Account is deactivated');
    }

    if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
      throw new UnauthorizedException(
        'Account is temporarily locked. Try again later.',
      );
    }

    const passwordMatches = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      await this.registerFailedLogin(user);
      throw new UnauthorizedException('Invalid email or password');
    }

    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    const tokens = await this.createSession(user);
    this.authCookieService.setAuthCookies(
      response,
      tokens.accessToken,
      tokens.refreshToken,
      tokens.csrfToken,
    );

    return {
      message: 'Login successful',
      user: toSafeUser(user),
    };
  }

  async logout(
    requestCookies: Record<string, string | undefined>,
    requestHeaders: Record<string, string | string[] | undefined>,
    response: Response,
  ) {
    const refreshToken = requestCookies?.[REFRESH_TOKEN_COOKIE];
    const csrfCookie = requestCookies?.[CSRF_TOKEN_COOKIE];
    const csrfHeaderRaw = requestHeaders[CSRF_HEADER];
    const csrfHeader = Array.isArray(csrfHeaderRaw)
      ? csrfHeaderRaw[0]
      : csrfHeaderRaw;

    // CSRF check when a session cookie is present (ACC-19).
    if (refreshToken || requestCookies?.[ACCESS_TOKEN_COOKIE]) {
      if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        throw new UnauthorizedException('Invalid CSRF token');
      }
    }

    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      await this.refreshSessionModel.updateOne(
        { tokenHash, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
    }

    this.authCookieService.clearAuthCookies(response);

    return { message: 'Logout successful' };
  }

  async me(userId: string): Promise<{ user: SafeUser }> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Not logged in');
    }
    return { user: toSafeUser(user) };
  }

  /**
   * Rotates the refresh session and issues a new access cookie.
   * Old refresh tokens become invalid after a successful refresh (ACC-19).
   */
  async refresh(
    requestCookies: Record<string, string | undefined>,
    requestHeaders: Record<string, string | string[] | undefined>,
    response: Response,
  ) {
    const refreshToken = requestCookies?.[REFRESH_TOKEN_COOKIE];
    const csrfCookie = requestCookies?.[CSRF_TOKEN_COOKIE];
    const csrfHeaderRaw = requestHeaders[CSRF_HEADER];
    const csrfHeader = Array.isArray(csrfHeaderRaw)
      ? csrfHeaderRaw[0]
      : csrfHeaderRaw;

    if (!refreshToken) {
      throw new UnauthorizedException('Not logged in');
    }

    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      throw new UnauthorizedException('Invalid CSRF token');
    }

    const tokenHash = hashToken(refreshToken);
    const session = await this.refreshSessionModel.findOne({
      tokenHash,
      revokedAt: null,
    });

    if (!session) {
      throw new UnauthorizedException('Session expired or invalid');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      session.revokedAt = new Date();
      await session.save();
      throw new UnauthorizedException('Session expired or invalid');
    }

    const inactiveFor = Date.now() - session.lastActivityAt.getTime();
    if (inactiveFor > INACTIVITY_TTL_MS) {
      session.revokedAt = new Date();
      await session.save();
      throw new UnauthorizedException(
        'Session expired due to inactivity. Please log in again.',
      );
    }

    const user = await this.userModel.findById(session.userId);
    if (!user) {
      session.revokedAt = new Date();
      await session.save();
      throw new UnauthorizedException('Not logged in');
    }

    if (
      user.status === AccountStatus.SUSPENDED ||
      user.status === AccountStatus.DEACTIVATED
    ) {
      session.revokedAt = new Date();
      await session.save();
      throw new UnauthorizedException(
        user.status === AccountStatus.SUSPENDED
          ? 'Account is suspended'
          : 'Account is deactivated',
      );
    }

    // Rotate: revoke the used refresh token, then issue a fresh session.
    session.revokedAt = new Date();
    await session.save();

    const tokens = await this.createSession(user);
    this.authCookieService.setAuthCookies(
      response,
      tokens.accessToken,
      tokens.refreshToken,
      tokens.csrfToken,
    );

    return {
      message: 'Session refreshed',
      user: toSafeUser(user),
    };
  }

  async changePassword(
    authUser: AuthenticatedUser,
    dto: ChangePasswordDto,
  ) {
    const user = await this.userModel
      .findById(authUser.id)
      .select('+passwordHash');

    if (!user) {
      throw new UnauthorizedException('Not logged in');
    }

    const matches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    user.mustChangePassword = false;
    await user.save();

    // Revoke other sessions except the current one for security.
    await this.refreshSessionModel.updateMany(
      {
        userId: user._id,
        _id: { $ne: new Types.ObjectId(authUser.sessionId) },
        revokedAt: null,
      },
      { $set: { revokedAt: new Date() } },
    );

    return { message: 'Password changed successfully' };
  }

  async adminResetPassword(targetUserId: string, temporaryPassword: string) {
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestException('Invalid user id');
    }

    const user = await this.userModel.findById(targetUserId);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException('Cannot reset another admin password here');
    }

    user.passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);
    user.mustChangePassword = true;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    await this.refreshSessionModel.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );

    return {
      message: 'Temporary password set. User must change it on next login.',
      user: {
        id: user._id.toString(),
        email: user.email,
        mustChangePassword: true,
      },
      temporaryPassword,
    };
  }

  private async registerFailedLogin(user: UserDocument): Promise<void> {
    const attempts = (user.failedLoginAttempts ?? 0) + 1;
    user.failedLoginAttempts = attempts;

    if (attempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      user.lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      user.failedLoginAttempts = 0;
    }

    await user.save();
  }

  private async createSession(user: UserDocument): Promise<{
    accessToken: string;
    refreshToken: string;
    csrfToken: string;
  }> {
    const refreshToken = generateOpaqueToken();
    const csrfToken = generateOpaqueToken();
    const now = new Date();

    const session = await this.refreshSessionModel.create({
      userId: user._id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      lastActivityAt: now,
      revokedAt: null,
    });

    const payload: AccessTokenPayload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role as UserRole,
      sid: session._id.toString(),
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.requireJwtSecret(),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });

    return { accessToken, refreshToken, csrfToken };
  }

  private requireJwtSecret(): string {
    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is missing from backend/.env');
    }
    return secret;
  }
}
