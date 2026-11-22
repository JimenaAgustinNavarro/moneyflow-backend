export const FUNDS_PATTERNS = {
  LIST: 'funds.list',
  GET_BY_ID: 'funds.getById',
  CREATE: 'funds.create',
  UPDATE: 'funds.update',
  ARCHIVE: 'funds.archive',
} as const;

export type FundCurrencyCode = 'PEN' | 'USD';

export type FundTypeValue = 'CASH' | 'BANK' | 'WALLET' | 'SAVINGS' | 'OTHER';

export interface ListFundsTcpPayload {
  includeArchived?: boolean;
  currency?: FundCurrencyCode;
  type?: FundTypeValue;
}

export interface GetFundByIdTcpPayload {
  id: string;
}

export interface CreateFundTcpPayload {
  name: string;
  type: FundTypeValue;
  currency?: FundCurrencyCode;
  color?: string;
  icon?: string;
  allowNegativeBalance?: boolean;
  initialBalance?: string;
}

export interface UpdateFundTcpPayload {
  id: string;
  name?: string;
  type?: FundTypeValue;
  color?: string | null;
  icon?: string | null;
  allowNegativeBalance?: boolean;
}

export interface ArchiveFundTcpPayload {
  id: string;
}

export interface FundView {
  id: string;
  name: string;
  type: FundTypeValue;
  currency: FundCurrencyCode;
  color: string | null;
  icon: string | null;
  allowNegativeBalance: boolean;
  isArchived: boolean;
  balance: string;
  createdAt: string;
  updatedAt: string;
}

export interface FundDetailView extends FundView {
  entryCount: number;
}

export interface CurrencyBalanceSummary {
  currency: FundCurrencyCode;
  totalBalance: string;
  fundCount: number;
}

export interface ListFundsResponse {
  funds: FundView[];
  totalsByCurrency: CurrencyBalanceSummary[];
}

export interface GetFundResponse {
  fund: FundDetailView;
}

export interface CreateFundResponse {
  fund: FundView;
}

export interface UpdateFundResponse {
  fund: FundView;
}

export interface ArchiveFundResponse {
  fund: FundView;
  message: string;
}
