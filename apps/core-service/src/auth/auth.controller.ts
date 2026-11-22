import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AUTH_PATTERNS,
  InternalAuthContext,
  RegisterUserResponse,
  RegisterUserTcpPayload,
  ResendVerificationResponse,
  ResendVerificationTcpPayload,
  SignedTcpEnvelope,
  VerifyEmailResponse,
  VerifyEmailTcpPayload,
} from '@app/shared';
import { CurrentInternalContext } from '../common/decorators/current-internal-context.decorator';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @MessagePattern(AUTH_PATTERNS.REGISTER)
  register(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<RegisterUserTcpPayload>,
  ): Promise<RegisterUserResponse> {
    return this.authService.register(context, envelope.payload);
  }

  @MessagePattern(AUTH_PATTERNS.VERIFY_EMAIL)
  verifyEmail(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<VerifyEmailTcpPayload>,
  ): Promise<VerifyEmailResponse> {
    return this.authService.verifyEmail(context, envelope.payload);
  }

  @MessagePattern(AUTH_PATTERNS.RESEND_VERIFICATION)
  resendVerification(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<ResendVerificationTcpPayload>,
  ): Promise<ResendVerificationResponse> {
    return this.authService.resendVerification(context, envelope.payload);
  }
}
