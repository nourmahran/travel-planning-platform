import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Request } from 'express';
import { Model } from 'mongoose';
import {
  CommunityIdentity,
} from '../../community/auth';
import { Actor, Role } from '../../community/types';
import { AccountStatus } from '../constants/account-status';
import {
  ACCESS_TOKEN_COOKIE,
  CSRF_HEADER,
  CSRF_TOKEN_COOKIE,
  INACTIVITY_TTL_MS,
} from '../constants/auth.constants';
import { UserRole } from '../constants/roles';
import {
  RefreshSession,
  RefreshSessionDocument,
} from '../schemas/refresh-session.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { AccessTokenPayload } from '../types/jwt-payload';

/**
 * Adapts Member 1 JWT/cookie auth for Member 6 CommunityIdentity (INTEGRATION.md).
 */
@Injectable()
export class JwtCommunityIdentity extends CommunityIdentity {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(RefreshSession.name)
    private readonly refreshSessionModel: Model<RefreshSessionDocument>,
  ) {
    super();
  }

  async resolve(request: Request): Promise<Actor | undefined> {
    const accessToken = request.cookies?.[ACCESS_TOKEN_COOKIE] as
      | string
      | undefined;
    if (!accessToken) {
      return undefined;
    }

    this.assertCsrf(request);

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(
        accessToken,
        { secret: this.requireJwtSecret() },
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
    if (!user || user.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException(
        'Account is unavailable or requires a password change',
      );
    }
    if (user.mustChangePassword) {
      throw new UnauthorizedException(
        'Account is unavailable or requires a password change',
      );
    }

    const role = this.mapRole(user.role as UserRole);
    if (!role) {
      throw new UnauthorizedException('Invalid account role');
    }

    session.lastActivityAt = new Date();
    await session.save();

    const providerId = user.providerId ? user.providerId.toString() : undefined;

    return {
      id: user._id.toString(),
      name: user.name,
      role,
      assignedAirlineId:
        user.providerType === 'airline' ? providerId : undefined,
      assignedHotelId: user.providerType === 'hotel' ? providerId : undefined,
    };
  }

  private mapRole(role: UserRole): Role | undefined {
    switch (role) {
      case UserRole.USER:
        return Role.User;
      case UserRole.ADMIN:
        return Role.Admin;
      case UserRole.AIRLINE_MODERATOR:
        return Role.AirlineModerator;
      case UserRole.HOTEL_MODERATOR:
        return Role.HotelModerator;
      default:
        return undefined;
    }
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
      throw new ForbiddenException('A valid X-CSRF-Token header is required');
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
