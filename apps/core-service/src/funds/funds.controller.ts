import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ArchiveFundResponse,
  ArchiveFundTcpPayload,
  CreateFundResponse,
  CreateFundTcpPayload,
  FUNDS_PATTERNS,
  GetFundByIdTcpPayload,
  GetFundResponse,
  InternalAuthContext,
  ListFundsResponse,
  ListFundsTcpPayload,
  SignedTcpEnvelope,
  UpdateFundResponse,
  UpdateFundTcpPayload,
} from '@app/shared';
import { CurrentInternalContext } from '../common/decorators/current-internal-context.decorator';
import { FundsService } from './funds.service';

@Controller()
export class FundsController {
  constructor(private readonly fundsService: FundsService) {}

  @MessagePattern(FUNDS_PATTERNS.LIST)
  list(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<ListFundsTcpPayload>,
  ): Promise<ListFundsResponse> {
    return this.fundsService.list(context, envelope.payload);
  }

  @MessagePattern(FUNDS_PATTERNS.GET_BY_ID)
  getById(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<GetFundByIdTcpPayload>,
  ): Promise<GetFundResponse> {
    return this.fundsService.getById(context, envelope.payload);
  }

  @MessagePattern(FUNDS_PATTERNS.CREATE)
  create(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<CreateFundTcpPayload>,
  ): Promise<CreateFundResponse> {
    return this.fundsService.create(context, envelope.payload);
  }

  @MessagePattern(FUNDS_PATTERNS.UPDATE)
  update(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<UpdateFundTcpPayload>,
  ): Promise<UpdateFundResponse> {
    return this.fundsService.update(context, envelope.payload);
  }

  @MessagePattern(FUNDS_PATTERNS.ARCHIVE)
  archive(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<ArchiveFundTcpPayload>,
  ): Promise<ArchiveFundResponse> {
    return this.fundsService.archive(context, envelope.payload);
  }
}
