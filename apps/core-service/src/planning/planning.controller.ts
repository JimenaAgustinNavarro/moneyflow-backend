import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ArchiveRecurringRuleResponse,
  CreateRecurringRuleResponse,
  CreateRecurringRuleTcpPayload,
  GetRecurringRuleByIdTcpPayload,
  GetRecurringRuleResponse,
  InternalAuthContext,
  ListRecurringOccurrencesResponse,
  ListRecurringOccurrencesTcpPayload,
  ListRecurringRulesResponse,
  ListRecurringRulesTcpPayload,
  OccurrenceLifecycleTcpPayload,
  OccurrenceStatusResponse,
  PayRecurringOccurrenceResponse,
  PayRecurringOccurrenceTcpPayload,
  PLANNING_PATTERNS,
  RuleLifecycleTcpPayload,
  SignedTcpEnvelope,
  UpdateRecurringRuleResponse,
  UpdateRecurringRuleTcpPayload,
} from '@app/shared';
import { CurrentInternalContext } from '../common/decorators/current-internal-context.decorator';
import { PlanningService } from './planning.service';

@Controller()
export class PlanningController {
  constructor(private readonly planningService: PlanningService) {}

  @MessagePattern(PLANNING_PATTERNS.CREATE_RULE)
  createRule(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<CreateRecurringRuleTcpPayload>,
  ): Promise<CreateRecurringRuleResponse> {
    return this.planningService.createRule(context, envelope.payload);
  }

  @MessagePattern(PLANNING_PATTERNS.LIST_RULES)
  listRules(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<ListRecurringRulesTcpPayload>,
  ): Promise<ListRecurringRulesResponse> {
    return this.planningService.listRules(context, envelope.payload);
  }

  @MessagePattern(PLANNING_PATTERNS.GET_RULE_BY_ID)
  getRuleById(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<GetRecurringRuleByIdTcpPayload>,
  ): Promise<GetRecurringRuleResponse> {
    return this.planningService.getRuleById(context, envelope.payload);
  }

  @MessagePattern(PLANNING_PATTERNS.UPDATE_RULE)
  updateRule(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<UpdateRecurringRuleTcpPayload>,
  ): Promise<UpdateRecurringRuleResponse> {
    return this.planningService.updateRule(context, envelope.payload);
  }

  @MessagePattern(PLANNING_PATTERNS.PAUSE_RULE)
  pauseRule(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<RuleLifecycleTcpPayload>,
  ): Promise<GetRecurringRuleResponse> {
    return this.planningService.pauseRule(context, envelope.payload);
  }

  @MessagePattern(PLANNING_PATTERNS.RESUME_RULE)
  resumeRule(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<RuleLifecycleTcpPayload>,
  ): Promise<GetRecurringRuleResponse> {
    return this.planningService.resumeRule(context, envelope.payload);
  }

  @MessagePattern(PLANNING_PATTERNS.ARCHIVE_RULE)
  archiveRule(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<RuleLifecycleTcpPayload>,
  ): Promise<ArchiveRecurringRuleResponse> {
    return this.planningService.archiveRule(context, envelope.payload);
  }

  @MessagePattern(PLANNING_PATTERNS.LIST_OCCURRENCES)
  listOccurrences(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<ListRecurringOccurrencesTcpPayload>,
  ): Promise<ListRecurringOccurrencesResponse> {
    return this.planningService.listOccurrences(context, envelope.payload);
  }

  @MessagePattern(PLANNING_PATTERNS.PAY_OCCURRENCE)
  payOccurrence(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<PayRecurringOccurrenceTcpPayload>,
  ): Promise<PayRecurringOccurrenceResponse> {
    return this.planningService.payOccurrence(context, envelope.payload);
  }

  @MessagePattern(PLANNING_PATTERNS.SKIP_OCCURRENCE)
  skipOccurrence(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<OccurrenceLifecycleTcpPayload>,
  ): Promise<OccurrenceStatusResponse> {
    return this.planningService.skipOccurrence(context, envelope.payload);
  }

  @MessagePattern(PLANNING_PATTERNS.UNSKIP_OCCURRENCE)
  unskipOccurrence(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<OccurrenceLifecycleTcpPayload>,
  ): Promise<OccurrenceStatusResponse> {
    return this.planningService.unskipOccurrence(context, envelope.payload);
  }
}
