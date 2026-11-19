import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../constants';

export const ROLES_KEY = 'hotels:roles';

/** Requires the authenticated user to have one of the given roles. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
