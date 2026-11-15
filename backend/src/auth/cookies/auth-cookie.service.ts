import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response, CookieOptions } from 'express';
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  CSRF_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_TTL_MS,
} from '../constants/auth.constants';

@Injectable()
export class AuthCookieService {
  constructor(private readonly configService: ConfigService) {}

  private baseOptions(): CookieOptions {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
    };
  }

  setAuthCookies(
    response: Response,
    accessToken: string,
    refreshToken: string,
    csrfToken: string,
  ): void {
    const base = this.baseOptions();

    response.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
      ...base,
      maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
    });

    response.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      ...base,
      maxAge: REFRESH_TOKEN_TTL_MS,
    });

    // Readable by the frontend so it can send X-CSRF-Token (double-submit).
    response.cookie(CSRF_TOKEN_COOKIE, csrfToken, {
      ...base,
      httpOnly: false,
      maxAge: REFRESH_TOKEN_TTL_MS,
    });
  }

  clearAuthCookies(response: Response): void {
    const base = this.baseOptions();
    response.clearCookie(ACCESS_TOKEN_COOKIE, base);
    response.clearCookie(REFRESH_TOKEN_COOKIE, base);
    response.clearCookie(CSRF_TOKEN_COOKIE, {
      ...base,
      httpOnly: false,
    });
  }
}
