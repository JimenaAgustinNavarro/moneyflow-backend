import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuthCookiesService } from '../auth-cookies.service';
import { AuthJwtService, AuthenticatedGatewayUser } from '../auth-jwt.service';

export interface RequestWithUser extends Request {
  user?: AuthenticatedGatewayUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly authCookiesService: AuthCookiesService,
    private readonly authJwtService: AuthJwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const accessToken = this.authCookiesService.getAccessTokenFromRequest(request);

    if (!accessToken) {
      throw new UnauthorizedException('Authentication cookie is missing');
    }

    const authenticatedUser = await this.authJwtService.verifyAccessToken(accessToken);
    request.user = authenticatedUser;
    return true;
  }
}
