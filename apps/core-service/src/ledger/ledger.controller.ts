import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  GetTransactionByIdTcpPayload,
  GetTransactionResponse,
  InternalAuthContext,
  LEDGER_PATTERNS,
  RecordTransactionResponse,
  RecordTransactionTcpPayload,
  SignedTcpEnvelope,
} from '@app/shared';
import { CurrentInternalContext } from '../common/decorators/current-internal-context.decorator';
import { LedgerService } from './ledger.service';

@Controller()
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @MessagePattern(LEDGER_PATTERNS.RECORD_TRANSACTION)
  recordTransaction(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<RecordTransactionTcpPayload>,
  ): Promise<RecordTransactionResponse> {
    return this.ledgerService.recordTransaction(context, envelope.payload);
  }

  @MessagePattern(LEDGER_PATTERNS.GET_BY_ID)
  getById(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<GetTransactionByIdTcpPayload>,
  ): Promise<GetTransactionResponse> {
    return this.ledgerService.getById(context, envelope.payload);
  }
}
