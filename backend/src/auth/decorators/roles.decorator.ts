import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../constants/roles';

export const ROLES_KEY = 'roles';

/** Restrict a route to one or more roles (checked by RolesGuard). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
