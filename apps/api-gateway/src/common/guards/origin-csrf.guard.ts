import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

const MUTATING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_CORS_ORIGIN = 'http://localhost:3001';

function parseCanonicalOrigin(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseAllowedOrigins(rawOrigins: string | undefined): Set<string> {
  const source =
    typeof rawOrigins === 'string' && rawOrigins.trim().length > 0
      ? rawOrigins
      : DEFAULT_CORS_ORIGIN;

  const allowed = new Set<string>();
  for (const entry of source.split(',')) {
    const canonical = parseCanonicalOrigin(entry);
    if (canonical) {
      allowed.add(canonical);
    }
  }

  return allowed;
}

function getSingleHeader(request: Request, headerName: string): string | null {
  const value = request.headers[headerName];
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    return value[0];
  }
  return null;
}

@Injectable()
export class OriginCsrfGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(private readonly configService: ConfigService) {
    this.allowedOrigins = parseAllowedOrigins(this.configService.get<string>('CORS_ORIGIN'));
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    if (!MUTATING_HTTP_METHODS.has(request.method.toUpperCase())) {
      return true;
    }

    const secFetchSite = getSingleHeader(request, 'sec-fetch-site')?.trim().toLowerCase();
    if (secFetchSite === 'cross-site') {
      throw new ForbiddenException('Cross-site requests are not allowed');
    }

    const originHeader = getSingleHeader(request, 'origin');
    if (originHeader !== null) {
      const canonicalOrigin = parseCanonicalOrigin(originHeader);
      if (!canonicalOrigin || !this.allowedOrigins.has(canonicalOrigin)) {
        throw new ForbiddenException('Invalid request origin');
      }
      return true;
    }

    const refererHeader = getSingleHeader(request, 'referer');
    if (refererHeader !== null) {
      const canonicalReferer = parseCanonicalOrigin(refererHeader);
      if (!canonicalReferer || !this.allowedOrigins.has(canonicalReferer)) {
        throw new ForbiddenException('Invalid request referer');
      }
      return true;
    }

    return true;
  }
}
