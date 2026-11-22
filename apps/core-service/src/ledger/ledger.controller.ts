import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  GetMonthlySummaryTcpPayload,
  GetTransactionByIdTcpPayload,
  GetTransactionResponse,
  InternalAuthContext,
  LEDGER_PATTERNS,
  ListTransactionsResponse,
  ListTransactionsTcpPayload,
  MonthlySummaryResponse,
  RecordAdjustmentResponse,
  RecordAdjustmentTcpPayload,
  RecordTransactionResponse,
  RecordTransactionTcpPayload,
  RecordTransferResponse,
  RecordTransferTcpPayload,
  RefundTransactionResponse,
  RefundTransactionTcpPayload,
  SignedTcpEnvelope,
  VoidTransactionResponse,
  VoidTransactionTcpPayload,
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

  @MessagePattern(LEDGER_PATTERNS.RECORD_TRANSFER)
  recordTransfer(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<RecordTransferTcpPayload>,
  ): Promise<RecordTransferResponse> {
    return this.ledgerService.recordTransfer(context, envelope.payload);
  }

  @MessagePattern(LEDGER_PATTERNS.RECORD_ADJUSTMENT)
  recordAdjustment(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<RecordAdjustmentTcpPayload>,
  ): Promise<RecordAdjustmentResponse> {
    return this.ledgerService.recordAdjustment(context, envelope.payload);
  }

  @MessagePattern(LEDGER_PATTERNS.GET_BY_ID)
  getById(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<GetTransactionByIdTcpPayload>,
  ): Promise<GetTransactionResponse> {
    return this.ledgerService.getById(context, envelope.payload);
  }

  @MessagePattern(LEDGER_PATTERNS.VOID_TRANSACTION)
  voidTransaction(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<VoidTransactionTcpPayload>,
  ): Promise<VoidTransactionResponse> {
    return this.ledgerService.voidTransaction(context, envelope.payload);
  }

  @MessagePattern(LEDGER_PATTERNS.REFUND_TRANSACTION)
  refundTransaction(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<RefundTransactionTcpPayload>,
  ): Promise<RefundTransactionResponse> {
    return this.ledgerService.refundTransaction(context, envelope.payload);
  }

  @MessagePattern(LEDGER_PATTERNS.LIST_TRANSACTIONS)
  listTransactions(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<ListTransactionsTcpPayload>,
  ): Promise<ListTransactionsResponse> {
    return this.ledgerService.listTransactions(context, envelope.payload);
  }

  @MessagePattern(LEDGER_PATTERNS.GET_MONTHLY_SUMMARY)
  getMonthlySummary(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<GetMonthlySummaryTcpPayload>,
  ): Promise<MonthlySummaryResponse> {
    return this.ledgerService.getMonthlySummary(context, envelope.payload);
  }
}
