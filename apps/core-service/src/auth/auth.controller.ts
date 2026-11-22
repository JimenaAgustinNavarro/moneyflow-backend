import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AUTH_PATTERNS,
  ChangePasswordResponse,
  ChangePasswordTcpPayload,
  CoreAuthSessionResult,
  ForgotPasswordResponse,
  ForgotPasswordTcpPayload,
  GetProfileResponse,
  GetProfileTcpPayload,
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
  ResetPasswordResponse,
  ResetPasswordTcpPayload,
  RevokeSessionResponse,
  RevokeSessionTcpPayload,
  SignedTcpEnvelope,
  UpdateProfileResponse,
  UpdateProfileTcpPayload,
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

  @MessagePattern(AUTH_PATTERNS.FORGOT_PASSWORD)
  forgotPassword(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<ForgotPasswordTcpPayload>,
  ): Promise<ForgotPasswordResponse> {
    return this.authService.forgotPassword(context, envelope.payload);
  }

  @MessagePattern(AUTH_PATTERNS.RESET_PASSWORD)
  resetPassword(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<ResetPasswordTcpPayload>,
  ): Promise<ResetPasswordResponse> {
    return this.authService.resetPassword(context, envelope.payload);
  }

  @MessagePattern(AUTH_PATTERNS.GET_ME)
  getMe(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() _envelope: SignedTcpEnvelope<GetProfileTcpPayload>,
  ): Promise<GetProfileResponse> {
    return this.authService.getMe(context);
  }

  @MessagePattern(AUTH_PATTERNS.UPDATE_ME)
  updateMe(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<UpdateProfileTcpPayload>,
  ): Promise<UpdateProfileResponse> {
    return this.authService.updateMe(context, envelope.payload);
  }

  @MessagePattern(AUTH_PATTERNS.CHANGE_PASSWORD)
  changePassword(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<ChangePasswordTcpPayload>,
  ): Promise<ChangePasswordResponse> {
    return this.authService.changePassword(context, envelope.payload);
  }
}
