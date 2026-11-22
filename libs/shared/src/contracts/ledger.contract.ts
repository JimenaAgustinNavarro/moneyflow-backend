import { FundCurrencyCode } from './funds.contract';

export const LEDGER_PATTERNS = {
  RECORD_TRANSACTION: 'ledger.recordTransaction',
  RECORD_TRANSFER: 'ledger.recordTransfer',
  RECORD_ADJUSTMENT: 'ledger.recordAdjustment',
  GET_BY_ID: 'ledger.getById',
} as const;

export type RecordableTransactionType = 'INCOME' | 'EXPENSE';

export type AdjustmentDirection = 'INCREASE' | 'DECREASE';

export type TransactionTypeValue =
  'INCOME' | 'EXPENSE' | 'TRANSFER' | 'ADJUSTMENT' | 'VOID' | 'REFUND';

export type TransactionStatusValue = 'POSTED' | 'VOIDED';

export interface TransactionSplitInput {
  categoryId: string;
  amount: string;
  note?: string | null;
}

export interface RecordTransactionTcpPayload {
  type: RecordableTransactionType;
  fundId: string;
  amount: string;
  occurredOn?: string;
  description: string;
  notes?: string | null;
  categoryId?: string;
  splits?: TransactionSplitInput[];
  idempotencyKey?: string;
}

export interface GetTransactionByIdTcpPayload {
  id: string;
}

export interface RecordTransferTcpPayload {
  sourceFundId: string;
  destinationFundId: string;
  amount: string;
  occurredOn?: string;
  description: string;
  notes?: string | null;
  idempotencyKey?: string;
}

export interface RecordAdjustmentTcpPayload {
  fundId: string;
  direction: AdjustmentDirection;
  amount: string;
  occurredOn?: string;
  description: string;
  notes?: string | null;
  idempotencyKey?: string;
}

export interface FundEntryView {
  id: string;
  fundId: string;
  signedAmount: string;
  currency: FundCurrencyCode;
  occurredOn: string;
  createdAt: string;
}

export interface TransactionSplitView {
  id: string;
  categoryId: string;
  amount: string;
  note: string | null;
  createdAt: string;
}

export interface TransactionView {
  id: string;
  type: TransactionTypeValue;
  status: TransactionStatusValue;
  amount: string;
  currency: FundCurrencyCode;
  occurredOn: string;
  recordedAt: string;
  description: string;
  notes: string | null;
  categoryId: string | null;
  relatedTransactionId: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionDetailView extends TransactionView {
  entries: FundEntryView[];
  splits: TransactionSplitView[];
}

export interface RecordTransactionResponse {
  transaction: TransactionDetailView;
  fundBalanceAfter: string;
}

export interface RecordTransferResponse {
  transaction: TransactionDetailView;
  sourceFundBalanceAfter: string;
  destinationFundBalanceAfter: string;
}

export interface RecordAdjustmentResponse {
  transaction: TransactionDetailView;
  fundBalanceAfter: string;
}

export interface GetTransactionResponse {
  transaction: TransactionDetailView;
}
