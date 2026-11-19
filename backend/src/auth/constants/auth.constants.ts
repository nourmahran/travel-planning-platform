export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';
export const CSRF_TOKEN_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';

/** Access JWT lifetime in seconds (15 minutes). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Absolute refresh-session lifetime in milliseconds (7 days).
 * Inactivity expiry is enforced separately (30 minutes).
 */
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** ACC-06: session expires after 30 minutes without authenticated activity. */
export const INACTIVITY_TTL_MS = 30 * 60 * 1000;

/** ACC-05: lock after five consecutive failed logins. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;

/** ACC-05: lock duration is 15 minutes. */
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export const BCRYPT_ROUNDS = 12;

/** ACC-02 (optional): email verification link lifetime. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** ACC-07 (optional): password reset code lifetime. */
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

/** Minimum gap between two verification or reset emails to one account. */
export const EMAIL_RESEND_COOLDOWN_MS = 60 * 1000;
