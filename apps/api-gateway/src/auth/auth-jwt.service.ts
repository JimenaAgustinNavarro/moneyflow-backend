import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  type: 'access';
}

export interface AuthenticatedGatewayUser {
  userId: string;
  sessionId: string;
}

@Injectable()
export class AuthJwtService {
  private readonly jwtSecret: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    const secret = this.configService.get<string>('JWT_SECRET');
    if (typeof secret !== 'string' || secret.trim().length === 0) {
      throw new Error('JWT_SECRET must be configured in api-gateway');
    }
    this.jwtSecret = secret;
  }

  async signAccessToken(userId: string, sessionId: string): Promise<string> {
    if (!this.jwtSecret) {
      throw new InternalServerErrorException('JWT configuration is missing');
    }

    const payload: AccessTokenPayload = {
      sub: userId,
      sid: sessionId,
      type: 'access',
    };

    return this.jwtService.signAsync(payload, {
      secret: this.jwtSecret,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedGatewayUser> {
    let decoded: unknown;
    try {
      decoded = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.jwtSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (typeof decoded !== 'object' || decoded === null) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const candidate = decoded as Record<string, unknown>;
    const sub = candidate.sub;
    const sid = candidate.sid;
    const type = candidate.type;

    if (
      type !== 'access' ||
      typeof sub !== 'string' ||
      !UUID_REGEX.test(sub) ||
      typeof sid !== 'string' ||
      !UUID_REGEX.test(sid)
    ) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    return {
      userId: sub,
      sessionId: sid,
    };
  }
}
