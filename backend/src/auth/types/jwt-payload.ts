import { UserRole } from '../constants/roles';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  sid: string;
}
