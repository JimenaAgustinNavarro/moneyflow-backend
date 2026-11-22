import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';

export const ACCESS_TOKEN_COOKIE_NAME = 'mf_access_token';
export const REFRESH_TOKEN_COOKIE_NAME = 'mf_refresh_token';

const ACCESS_COOKIE_PATH = '/';
const REFRESH_COOKIE_PATH = '/api/v1/auth';
const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthCookiesService {
  private readonly secureCookie: boolean;

  constructor(private readonly configService: ConfigService) {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const cookieSecure = this.configService.get<string>('COOKIE_SECURE');
    this.secureCookie = nodeEnv === 'production' || cookieSecure === 'true';
  }

  setAuthCookies(response: Response, accessToken: string, refreshToken: string): void {
    response.cookie(ACCESS_TOKEN_COOKIE_NAME, accessToken, {
      ...this.buildBaseCookieOptions(ACCESS_COOKIE_PATH),
      maxAge: ACCESS_COOKIE_MAX_AGE_MS,
    });
    response.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
      ...this.buildBaseCookieOptions(REFRESH_COOKIE_PATH),
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
  }

  clearAuthCookies(response: Response): void {
    response.clearCookie(ACCESS_TOKEN_COOKIE_NAME, this.buildBaseCookieOptions(ACCESS_COOKIE_PATH));
    response.clearCookie(
      REFRESH_TOKEN_COOKIE_NAME,
      this.buildBaseCookieOptions(REFRESH_COOKIE_PATH),
    );
  }

  getAccessTokenFromRequest(request: Request): string | null {
    return this.getCookieValue(request, ACCESS_TOKEN_COOKIE_NAME);
  }

  getRefreshTokenFromRequest(request: Request): string | null {
    return this.getCookieValue(request, REFRESH_TOKEN_COOKIE_NAME);
  }

  private buildBaseCookieOptions(path: string): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.secureCookie,
      path,
    };
  }

  private getCookieValue(request: Request, cookieName: string): string | null {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    if (!cookies || typeof cookies !== 'object') {
      return null;
    }

    const value = cookies[cookieName];
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
