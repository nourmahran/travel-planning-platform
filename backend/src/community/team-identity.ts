import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { CommunityIdentity } from './auth';
import { Actor, Role } from './types';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';

@Injectable()
export class TeamIdentity extends CommunityIdentity {
  async resolve(request: Request): Promise<Actor | undefined> {
    const user = (request as Request & { user?: AuthenticatedUser }).user;
    if (!user) return undefined;
    return {
      id: user.id,
      name: user.name,
      role: user.role as unknown as Role,
      assignedHotelId:
        user.providerType === 'hotel'
          ? (user.providerId ?? undefined)
          : undefined,
      assignedAirlineId:
        user.providerType === 'airline'
          ? (user.providerId ?? undefined)
          : undefined,
    };
  }
}
