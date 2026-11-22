import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AUTH_PATTERNS,
  ChangePasswordResponse,
  ChangePasswordTcpPayload,
  CoreAuthSessionResult,
  ForgotPasswordResponse,
  ForgotPasswordTcpPayload,
  GetProfileResponse,
  GetProfileTcpPayload,
  ListSessionsResponse,
  ListSessionsTcpPayload,
  LoginTcpPayload,
  LogoutAllResponse,
  LogoutAllTcpPayload,
  LogoutResponse,
  LogoutTcpPayload,
  PublicAuthResponse,
  RefreshSessionTcpPayload,
  RegisterUserResponse,
  RegisterUserTcpPayload,
  ResendVerificationResponse,
  ResendVerificationTcpPayload,
  ResetPasswordResponse,
  ResetPasswordTcpPayload,
  RevokeSessionResponse,
  RevokeSessionTcpPayload,
  UpdateProfileResponse,
  UpdateProfileTcpPayload,
  VerifyEmailResponse,
  VerifyEmailTcpPayload,
} from '@app/shared';
import { Request, Response } from 'express';
import { CoreTcpClientService } from '../core-client/core-tcp-client.service';
import { AuthCookiesService } from './auth-cookies.service';
import { AuthJwtService, AuthenticatedGatewayUser } from './auth-jwt.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { MeQueryDto } from './dto/me-query.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SessionIdParamDto } from './dto/session-id-param.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly coreTcpClient: CoreTcpClientService,
    private readonly authCookiesService: AuthCookiesService,
    private readonly authJwtService: AuthJwtService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto, @Req() request: Request): Promise<RegisterUserResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, null);
    const payload: RegisterUserTcpPayload = {
      email: dto.email,
      fullName: dto.fullName,
      password: dto.password,
      audit: context.audit,
    };

    return this.coreTcpClient.send<RegisterUserResponse, RegisterUserTcpPayload>(
      AUTH_PATTERNS.REGISTER,
      payload,
      {
        requestId: context.requestId,
        userId: null,
      },
    );
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: VerifyEmailDto, @Req() request: Request): Promise<VerifyEmailResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, null);
    const payload: VerifyEmailTcpPayload = {
      token: dto.token,
      audit: context.audit,
    };

    return this.coreTcpClient.send<VerifyEmailResponse, VerifyEmailTcpPayload>(
      AUTH_PATTERNS.VERIFY_EMAIL,
      payload,
      {
        requestId: context.requestId,
        userId: null,
      },
    );
  }

  @Post('resend-verification')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  resendVerification(
    @Body() dto: ResendVerificationDto,
    @Req() request: Request,
  ): Promise<ResendVerificationResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, null);
    const payload: ResendVerificationTcpPayload = {
      email: dto.email,
      audit: context.audit,
    };

    return this.coreTcpClient.send<ResendVerificationResponse, ResendVerificationTcpPayload>(
      AUTH_PATTERNS.RESEND_VERIFICATION,
      payload,
      {
        requestId: context.requestId,
        userId: null,
      },
    );
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicAuthResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, null);
    const payload: LoginTcpPayload = {
      email: dto.email,
      password: dto.password,
      audit: context.audit,
    };

    const result = await this.coreTcpClient.send<CoreAuthSessionResult, LoginTcpPayload>(
      AUTH_PATTERNS.LOGIN,
      payload,
      {
        requestId: context.requestId,
        userId: null,
      },
    );

    const accessToken = await this.authJwtService.signAccessToken(result.user.id, result.sessionId);
    this.authCookiesService.setAuthCookies(response, accessToken, result.refreshToken);

    return {
      user: result.user,
      message: 'Login successful.',
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicAuthResponse> {
    const refreshToken = this.authCookiesService.getRefreshTokenFromRequest(request);
    if (!refreshToken) {
      this.authCookiesService.clearAuthCookies(response);
      throw new UnauthorizedException('Refresh token cookie is missing');
    }

    const context = this.coreTcpClient.buildRequestContext(request, null);
    const payload: RefreshSessionTcpPayload = {
      refreshToken,
      audit: context.audit,
    };

    try {
      const result = await this.coreTcpClient.send<CoreAuthSessionResult, RefreshSessionTcpPayload>(
        AUTH_PATTERNS.REFRESH,
        payload,
        {
          requestId: context.requestId,
          userId: null,
        },
      );

      const accessToken = await this.authJwtService.signAccessToken(
        result.user.id,
        result.sessionId,
      );
      this.authCookiesService.setAuthCookies(response, accessToken, result.refreshToken);

      return {
        user: result.user,
        message: 'Session refreshed successfully.',
      };
    } catch (error) {
      this.authCookiesService.clearAuthCookies(response);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LogoutResponse> {
    const refreshToken = this.authCookiesService.getRefreshTokenFromRequest(request);
    const rawAccessToken = this.authCookiesService.getAccessTokenFromRequest(request);

    let verifiedUser: AuthenticatedGatewayUser | null = null;
    if (rawAccessToken) {
      try {
        verifiedUser = await this.authJwtService.verifyAccessToken(rawAccessToken);
      } catch {
        verifiedUser = null;
      }
    }

    const context = this.coreTcpClient.buildRequestContext(request, verifiedUser?.userId ?? null);
    const payload: LogoutTcpPayload = {
      sessionId: verifiedUser?.sessionId ?? null,
      refreshToken,
      audit: context.audit,
    };

    try {
      return await this.coreTcpClient.send<LogoutResponse, LogoutTcpPayload>(
        AUTH_PATTERNS.LOGOUT,
        payload,
        {
          requestId: context.requestId,
          userId: verifiedUser?.userId ?? null,
        },
      );
    } finally {
      this.authCookiesService.clearAuthCookies(response);
    }
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  listSessions(
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<ListSessionsResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: ListSessionsTcpPayload = {
      currentSessionId: currentUser.sessionId,
    };

    return this.coreTcpClient.send<ListSessionsResponse, ListSessionsTcpPayload>(
      AUTH_PATTERNS.LIST_SESSIONS,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @Param() params: SessionIdParamDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RevokeSessionResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: RevokeSessionTcpPayload = {
      sessionId: params.id,
      currentSessionId: currentUser.sessionId,
      audit: context.audit,
    };

    const result = await this.coreTcpClient.send<RevokeSessionResponse, RevokeSessionTcpPayload>(
      AUTH_PATTERNS.REVOKE_SESSION,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );

    if (result.currentSessionCleared) {
      this.authCookiesService.clearAuthCookies(response);
    }

    return result;
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LogoutAllResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: LogoutAllTcpPayload = {
      audit: context.audit,
    };

    try {
      return await this.coreTcpClient.send<LogoutAllResponse, LogoutAllTcpPayload>(
        AUTH_PATTERNS.LOGOUT_ALL,
        payload,
        {
          requestId: context.requestId,
          userId: currentUser.userId,
        },
      );
    } finally {
      this.authCookiesService.clearAuthCookies(response);
    }
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() request: Request,
  ): Promise<ForgotPasswordResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, null);
    const payload: ForgotPasswordTcpPayload = {
      email: dto.email,
      audit: context.audit,
    };

    return this.coreTcpClient.send<ForgotPasswordResponse, ForgotPasswordTcpPayload>(
      AUTH_PATTERNS.FORGOT_PASSWORD,
      payload,
      {
        requestId: context.requestId,
        userId: null,
      },
    );
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ResetPasswordResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, null);
    const payload: ResetPasswordTcpPayload = {
      token: dto.token,
      newPassword: dto.newPassword,
      audit: context.audit,
    };

    const result = await this.coreTcpClient.send<ResetPasswordResponse, ResetPasswordTcpPayload>(
      AUTH_PATTERNS.RESET_PASSWORD,
      payload,
      {
        requestId: context.requestId,
        userId: null,
      },
    );

    this.authCookiesService.clearAuthCookies(response);
    return result;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  getMe(
    @Query() _query: MeQueryDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<GetProfileResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: GetProfileTcpPayload = {};

    return this.coreTcpClient.send<GetProfileResponse, GetProfileTcpPayload>(
      AUTH_PATTERNS.GET_ME,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  updateMe(
    @Body() dto: UpdateProfileDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<UpdateProfileResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: UpdateProfileTcpPayload = {
      fullName: dto.fullName,
    };

    return this.coreTcpClient.send<UpdateProfileResponse, UpdateProfileTcpPayload>(
      AUTH_PATTERNS.UPDATE_ME,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<ChangePasswordResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: ChangePasswordTcpPayload = {
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
      currentSessionId: currentUser.sessionId,
      audit: context.audit,
    };

    return this.coreTcpClient.send<ChangePasswordResponse, ChangePasswordTcpPayload>(
      AUTH_PATTERNS.CHANGE_PASSWORD,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }
}
