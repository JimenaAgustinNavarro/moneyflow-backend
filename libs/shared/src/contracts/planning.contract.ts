import { CategoryKindUnion } from './categories.contract';
import { FundCurrencyCode } from './funds.contract';
import { TransactionDetailView } from './ledger.contract';

export const PLANNING_PATTERNS = {
  CREATE_RULE: 'planning.createRule',
  LIST_RULES: 'planning.listRules',
  GET_RULE_BY_ID: 'planning.getRuleById',
  UPDATE_RULE: 'planning.updateRule',
  PAUSE_RULE: 'planning.pauseRule',
  RESUME_RULE: 'planning.resumeRule',
  ARCHIVE_RULE: 'planning.archiveRule',
  LIST_OCCURRENCES: 'planning.listOccurrences',
  PAY_OCCURRENCE: 'planning.payOccurrence',
  SKIP_OCCURRENCE: 'planning.skipOccurrence',
  UNSKIP_OCCURRENCE: 'planning.unskipOccurrence',
} as const;

export type RecurringFrequencyValue = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'YEARLY';

export type RecurringOccurrenceStatusValue = 'PENDING' | 'PAID' | 'SKIPPED';

export interface CreateRecurringRuleTcpPayload {
  name: string;
  kind: CategoryKindUnion;
  amount: string;
  currency: FundCurrencyCode;
  frequency: RecurringFrequencyValue;
  startDate: string;
  endDate?: string;
  categoryId: string;
  defaultFundId?: string;
  notes?: string;
}

export interface ListRecurringRulesTcpPayload {
  includeArchived?: boolean;
  isActive?: boolean;
  kind?: CategoryKindUnion;
  currency?: FundCurrencyCode;
  frequency?: RecurringFrequencyValue;
}

export interface GetRecurringRuleByIdTcpPayload {
  id: string;
}

export interface UpdateRecurringRuleTcpPayload {
  id: string;
  name?: string;
  amount?: string;
  frequency?: RecurringFrequencyValue;
  startDate?: string;
  endDate?: string | null;
  categoryId?: string;
  defaultFundId?: string | null;
  notes?: string | null;
}

export interface RuleLifecycleTcpPayload {
  id: string;
}

export interface ListRecurringOccurrencesTcpPayload {
  fromDate?: string;
  toDate?: string;
  status?: RecurringOccurrenceStatusValue;
  currency?: FundCurrencyCode;
  kind?: CategoryKindUnion;
  ruleId?: string;
}

export interface PayRecurringOccurrenceTcpPayload {
  id: string;
  fundId: string;
  amount?: string;
  occurredOn?: string;
  description?: string;
  notes?: string | null;
  idempotencyKey: string;
}

export interface OccurrenceLifecycleTcpPayload {
  id: string;
}

export interface RecurringRuleView {
  id: string;
  name: string;
  kind: CategoryKindUnion;
  amount: string;
  currency: FundCurrencyCode;
  frequency: RecurringFrequencyValue;
  startDate: string;
  endDate: string | null;
  anchorDay: number;
  categoryId: string;
  defaultFundId: string | null;
  notes: string | null;
  isActive: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRecurringRuleResponse {
  rule: RecurringRuleView;
  materializedCount: number;
}

export interface ListRecurringRulesResponse {
  rules: RecurringRuleView[];
}

export interface GetRecurringRuleResponse {
  rule: RecurringRuleView;
}

export interface UpdateRecurringRuleResponse {
  rule: RecurringRuleView;
}

export interface ArchiveRecurringRuleResponse {
  rule: RecurringRuleView;
  deletedPendingCount: number;
}

export interface RecurringOccurrenceView {
  id: string;
  ruleId: string;
  ruleName: string;
  kind: CategoryKindUnion;
  currency: FundCurrencyCode;
  frequency: RecurringFrequencyValue;
  categoryId: string;
  defaultFundId: string | null;
  ruleIsActive: boolean;
  ruleIsArchived: boolean;
  scheduledDate: string;
  expectedAmount: string;
  status: RecurringOccurrenceStatusValue;
  isOverdue: boolean;
  paidTransactionId: string | null;
  paidAmount: string | null;
  paidAt: string | null;
  skippedAt: string | null;
  lastVoidedTransactionId: string | null;
  lastVoidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringCurrencyTotalsView {
  currency: FundCurrencyCode;
  pendingIncome: string;
  pendingExpense: string;
  paidIncome: string;
  paidExpense: string;
  pendingCount: number;
  overdueCount: number;
}

export interface ListRecurringOccurrencesResponse {
  horizonStart: string;
  horizonEnd: string;
  occurrences: RecurringOccurrenceView[];
  totalsByCurrency: RecurringCurrencyTotalsView[];
}

export interface PayRecurringOccurrenceResponse {
  occurrence: RecurringOccurrenceView;
  transaction: TransactionDetailView;
  fundBalanceAfter: string;
}

export interface OccurrenceStatusResponse {
  occurrence: RecurringOccurrenceView;
}
