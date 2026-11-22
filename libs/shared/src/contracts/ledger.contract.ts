import { FundCurrencyCode } from './funds.contract';

export const LEDGER_PATTERNS = {
  RECORD_TRANSACTION: 'ledger.recordTransaction',
  GET_BY_ID: 'ledger.getById',
} as const;

export type RecordableTransactionType = 'INCOME' | 'EXPENSE';

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

export interface GetTransactionResponse {
  transaction: TransactionDetailView;
}
