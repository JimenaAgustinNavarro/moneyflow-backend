import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AUTH_PATTERNS,
  CoreAuthSessionResult,
  InternalAuthContext,
  ListSessionsResponse,
  ListSessionsTcpPayload,
  LoginTcpPayload,
  LogoutAllResponse,
  LogoutAllTcpPayload,
  LogoutResponse,
  LogoutTcpPayload,
  RefreshSessionTcpPayload,
  RegisterUserResponse,
  RegisterUserTcpPayload,
  ResendVerificationResponse,
  ResendVerificationTcpPayload,
  RevokeSessionResponse,
  RevokeSessionTcpPayload,
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

  @MessagePattern(AUTH_PATTERNS.LOGIN)
  login(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<LoginTcpPayload>,
  ): Promise<CoreAuthSessionResult> {
    return this.authService.login(context, envelope.payload);
  }

  @MessagePattern(AUTH_PATTERNS.REFRESH)
  refresh(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<RefreshSessionTcpPayload>,
  ): Promise<CoreAuthSessionResult> {
    return this.authService.refresh(context, envelope.payload);
  }

  @MessagePattern(AUTH_PATTERNS.LOGOUT)
  logout(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<LogoutTcpPayload>,
  ): Promise<LogoutResponse> {
    return this.authService.logout(context, envelope.payload);
  }

  @MessagePattern(AUTH_PATTERNS.LIST_SESSIONS)
  listSessions(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<ListSessionsTcpPayload>,
  ): Promise<ListSessionsResponse> {
    return this.authService.listSessions(context, envelope.payload);
  }

  @MessagePattern(AUTH_PATTERNS.REVOKE_SESSION)
  revokeSession(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<RevokeSessionTcpPayload>,
  ): Promise<RevokeSessionResponse> {
    return this.authService.revokeSession(context, envelope.payload);
  }

  @MessagePattern(AUTH_PATTERNS.LOGOUT_ALL)
  logoutAll(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<LogoutAllTcpPayload>,
  ): Promise<LogoutAllResponse> {
    return this.authService.logoutAll(context, envelope.payload);
  }
}
