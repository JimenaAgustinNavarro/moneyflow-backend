import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  AUTH_PATTERNS,
  RegisterUserResponse,
  RegisterUserTcpPayload,
  ResendVerificationResponse,
  ResendVerificationTcpPayload,
  VerifyEmailResponse,
  VerifyEmailTcpPayload,
} from '@app/shared';
import { Request } from 'express';
import { CoreTcpClientService } from '../core-client/core-tcp-client.service';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly coreTcpClient: CoreTcpClientService) {}

  @Post('register')
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
}
