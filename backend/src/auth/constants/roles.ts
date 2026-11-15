export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  AIRLINE_MODERATOR = 'airline_moderator',
  HOTEL_MODERATOR = 'hotel_moderator',
}

export const ALL_ROLES = Object.values(UserRole);

export const MODERATOR_ROLES: UserRole[] = [
  UserRole.AIRLINE_MODERATOR,
  UserRole.HOTEL_MODERATOR,
];
