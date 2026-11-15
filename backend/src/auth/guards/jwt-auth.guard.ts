import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Request } from 'express';
import { Model } from 'mongoose';
import {
  ACCESS_TOKEN_COOKIE,
  CSRF_HEADER,
  CSRF_TOKEN_COOKIE,
  INACTIVITY_TTL_MS,
} from '../constants/auth.constants';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  RefreshSession,
  RefreshSessionDocument,
} from '../schemas/refresh-session.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { AccountStatus } from '../constants/account-status';
import { AccessTokenPayload } from '../types/jwt-payload';
import { AuthenticatedUser } from '../types/authenticated-user';
import { UserRole } from '../constants/roles';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(RefreshSession.name)
    private readonly refreshSessionModel: Model<RefreshSessionDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const accessToken = request.cookies?.[ACCESS_TOKEN_COOKIE] as
      | string
      | undefined;

    if (!accessToken) {
      throw new UnauthorizedException('Not logged in');
    }

    this.assertCsrf(request);

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(
        accessToken,
        {
          secret: this.requireJwtSecret(),
        },
      );
    } catch {
      throw new UnauthorizedException('Session expired or invalid');
    }

    const session = await this.refreshSessionModel.findById(payload.sid);
    if (!session || session.revokedAt) {
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

    if (session.expiresAt.getTime() <= Date.now()) {
      session.revokedAt = new Date();
      await session.save();
      throw new UnauthorizedException('Session expired or invalid');
    }

    const user = await this.userModel.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Not logged in');
    }

    if (user.status === AccountStatus.SUSPENDED) {
      throw new UnauthorizedException('Account is suspended');
    }

    if (user.status === AccountStatus.DEACTIVATED) {
      throw new UnauthorizedException('Account is deactivated');
    }

    session.lastActivityAt = new Date();
    await session.save();

    const authenticatedUser: AuthenticatedUser = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
      mustChangePassword: user.mustChangePassword,
      providerType: user.providerType ?? null,
      providerId: user.providerId ? user.providerId.toString() : null,
      sessionId: session._id.toString(),
    };

    (request as Request & { user: AuthenticatedUser }).user =
      authenticatedUser;

    // ACC-07a / ACC-13: temporary password must be changed before other actions.
    if (user.mustChangePassword && !this.isPasswordChangeAllowedRoute(request)) {
      throw new ForbiddenException(
        'You must change your temporary password before continuing',
      );
    }

    return true;
  }

  private isPasswordChangeAllowedRoute(request: Request): boolean {
    const method = request.method.toUpperCase();
    const path = (request.route?.path as string | undefined) ?? request.path;
    const fullPath = `${request.baseUrl ?? ''}${path}`;

    if (method === 'PATCH' && fullPath.includes('change-password')) {
      return true;
    }
    if (method === 'GET' && /(^|\/)(auth\/)?me$/.test(fullPath.replace(/^\//, ''))) {
      return true;
    }
    return false;
  }

  private assertCsrf(request: Request): void {
    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return;
    }

    const csrfCookie = request.cookies?.[CSRF_TOKEN_COOKIE] as
      | string
      | undefined;
    const csrfHeader = request.headers[CSRF_HEADER];
    const headerValue = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;

    if (!csrfCookie || !headerValue || csrfCookie !== headerValue) {
      throw new UnauthorizedException('Invalid CSRF token');
    }
  }

  private requireJwtSecret(): string {
    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new UnauthorizedException('Authentication is not configured');
    }
    return secret;
  }
}
