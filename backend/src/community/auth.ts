import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { CommunityStore } from './store';
import { TeamBridge } from './team.bridge';
import { Actor, objectId, Role } from './types';

export interface CommunityRequest extends Request {
  actor?: Actor;
}

export type AccessLevel =
  'optional' | 'authenticated' | 'user' | 'admin' | 'media';
export const Access = (level: AccessLevel) =>
  SetMetadata('community.access', level);
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<CommunityRequest>().actor,
);

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class CommunitySessionsService {
  constructor(
    private readonly store: CommunityStore,
    private readonly bridge: TeamBridge,
  ) {}

  async issue(userId: string) {
    const user = await this.bridge.account(userId);
    if (!user || user.status !== 'active' || user.mustChangePassword) {
      throw new UnauthorizedException(
        'An active account with a completed login is required',
      );
    }
    const token = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    await this.store.sessions.create({
      userId: objectId(userId),
      tokenHash: hash(token),
      csrfHash: hash(csrfToken),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    return { token, csrfToken };
  }

  setCookies(
    response: Response,
    session: { token: string; csrfToken: string },
  ) {
    const secure =
      process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test';
    const options = {
      secure,
      sameSite: 'strict' as const,
      path: '/',
      maxAge: 24 * 60 * 60 * 1000,
    };
    response.cookie('session', session.token, { ...options, httpOnly: true });
    response.cookie('csrf', session.csrfToken, { ...options, httpOnly: false });
  }

  async revoke(token: string) {
    await this.store.sessions.deleteOne({ tokenHash: hash(token) });
  }
}

export abstract class CommunityIdentity {
  abstract resolve(request: Request): Promise<Actor | undefined>;
}

@Injectable()
export class MongoSessionIdentity extends CommunityIdentity {
  constructor(
    private readonly store: CommunityStore,
    private readonly bridge: TeamBridge,
  ) {
    super();
  }

  async resolve(request: Request): Promise<Actor | undefined> {
    const token: unknown = request.cookies?.session;
    if (token === undefined) return undefined;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
      throw new UnauthorizedException('Invalid session');
    }
    const session = await this.store.sessions.findOne({
      tokenHash: hash(token),
      expiresAt: { $gt: new Date() },
      lastSeenAt: { $gt: new Date(Date.now() - 30 * 60 * 1000) },
    });
    if (!session) throw new UnauthorizedException('Session expired');
    const user = await this.bridge.account(session.userId.toString());
    if (!user || user.status !== 'active' || user.mustChangePassword) {
      throw new UnauthorizedException(
        'Account is unavailable or requires a password change',
      );
    }
    if (!Object.values(Role).includes(user.role))
      throw new UnauthorizedException('Invalid account role');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const csrf = request.get('X-CSRF-Token');
      if (
        !csrf ||
        !timingSafeEqual(Buffer.from(hash(csrf)), Buffer.from(session.csrfHash))
      ) {
        throw new ForbiddenException('A valid X-CSRF-Token header is required');
      }
    }
    await this.store.sessions.updateOne(
      { _id: session._id },
      { $set: { lastSeenAt: new Date() } },
    );
    return {
      id: user._id.toString(),
      name: user.name,
      role: user.role,
      assignedHotelId: user.assignedHotelId?.toString(),
      assignedAirlineId: user.assignedAirlineId?.toString(),
    };
  }
}

@Injectable()
export class CommunityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identity: CommunityIdentity,
  ) {}

  async canActivate(context: ExecutionContext) {
    const access = this.reflector.getAllAndOverride<AccessLevel>(
      'community.access',
      [context.getHandler(), context.getClass()],
    );
    if (!access) return true;
    const request = context.switchToHttp().getRequest<CommunityRequest>();
    const actor = await this.identity.resolve(request);
    request.actor = actor;
    if (access === 'optional' || access === 'media') return true;
    if (!actor) throw new UnauthorizedException('Please log in');
    if (access === 'admin' && actor.role !== Role.Admin) {
      throw new ForbiddenException('Administrator access is required');
    }
    if (access === 'user' && actor.role !== Role.User) {
      throw new ForbiddenException('A traveler account is required');
    }
    return true;
  }
}
