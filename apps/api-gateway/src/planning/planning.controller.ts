import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ArchiveRecurringRuleResponse,
  CreateRecurringRuleResponse,
  CreateRecurringRuleTcpPayload,
  GetRecurringRuleByIdTcpPayload,
  GetRecurringRuleResponse,
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
  UpdateRecurringRuleResponse,
  UpdateRecurringRuleTcpPayload,
} from '@app/shared';
import { Request } from 'express';
import { AuthenticatedGatewayUser } from '../auth/auth-jwt.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CoreTcpClientService } from '../core-client/core-tcp-client.service';
import { CreateRecurringRuleDto } from './dto/create-recurring-rule.dto';
import { ListRecurringOccurrencesQueryDto } from './dto/list-recurring-occurrences-query.dto';
import { ListRecurringRulesQueryDto } from './dto/list-recurring-rules-query.dto';
import { PayRecurringOccurrenceDto } from './dto/pay-recurring-occurrence.dto';
import { UpdateRecurringRuleDto } from './dto/update-recurring-rule.dto';

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

function extractRequiredIdempotencyKey(request: Request): string {
  const rawHeader = request.headers['idempotency-key'];

  if (rawHeader === undefined) {
    throw new BadRequestException('Idempotency-Key header is required');
  }

  if (Array.isArray(rawHeader)) {
    throw new BadRequestException('Invalid Idempotency-Key header');
  }

  const trimmed = rawHeader.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new BadRequestException(
      `Idempotency-Key must be between 1 and ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
    );
  }

  return trimmed;
}

@Controller('recurring')
@UseGuards(JwtAuthGuard)
export class PlanningController {
  constructor(private readonly coreTcpClient: CoreTcpClientService) {}

  @Post('rules')
  @HttpCode(HttpStatus.CREATED)
  createRule(
    @Body() dto: CreateRecurringRuleDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<CreateRecurringRuleResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);

    const payload: CreateRecurringRuleTcpPayload = {
      name: dto.name,
      kind: dto.kind,
      amount: dto.amount,
      currency: dto.currency,
      frequency: dto.frequency,
      startDate: dto.startDate,
      ...(dto.endDate !== undefined ? { endDate: dto.endDate } : {}),
      categoryId: dto.categoryId,
      ...(dto.defaultFundId !== undefined ? { defaultFundId: dto.defaultFundId } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    };

    return this.coreTcpClient.send<CreateRecurringRuleResponse, CreateRecurringRuleTcpPayload>(
      PLANNING_PATTERNS.CREATE_RULE,
      payload,
      { requestId: context.requestId, userId: currentUser.userId },
    );
  }

  @Get('rules')
  @HttpCode(HttpStatus.OK)
  listRules(
    @Query() query: ListRecurringRulesQueryDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<ListRecurringRulesResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);

    const payload: ListRecurringRulesTcpPayload = {
      ...(query.includeArchived !== undefined ? { includeArchived: query.includeArchived } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.kind !== undefined ? { kind: query.kind } : {}),
      ...(query.currency !== undefined ? { currency: query.currency } : {}),
      ...(query.frequency !== undefined ? { frequency: query.frequency } : {}),
    };

    return this.coreTcpClient.send<ListRecurringRulesResponse, ListRecurringRulesTcpPayload>(
      PLANNING_PATTERNS.LIST_RULES,
      payload,
      { requestId: context.requestId, userId: currentUser.userId },
    );
  }

  @Get('rules/:id')
  @HttpCode(HttpStatus.OK)
  getRuleById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<GetRecurringRuleResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: GetRecurringRuleByIdTcpPayload = { id };

    return this.coreTcpClient.send<GetRecurringRuleResponse, GetRecurringRuleByIdTcpPayload>(
      PLANNING_PATTERNS.GET_RULE_BY_ID,
      payload,
      { requestId: context.requestId, userId: currentUser.userId },
    );
  }

  @Patch('rules/:id')
  @HttpCode(HttpStatus.OK)
  updateRule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateRecurringRuleDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<UpdateRecurringRuleResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);

    const payload: UpdateRecurringRuleTcpPayload = {
      id,
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...(dto.frequency !== undefined ? { frequency: dto.frequency } : {}),
      ...(dto.startDate !== undefined ? { startDate: dto.startDate } : {}),
      ...(dto.endDate !== undefined ? { endDate: dto.endDate } : {}),
      ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
      ...(dto.defaultFundId !== undefined ? { defaultFundId: dto.defaultFundId } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    };

    return this.coreTcpClient.send<UpdateRecurringRuleResponse, UpdateRecurringRuleTcpPayload>(
      PLANNING_PATTERNS.UPDATE_RULE,
      payload,
      { requestId: context.requestId, userId: currentUser.userId },
    );
  }

  @Post('rules/:id/pause')
  @HttpCode(HttpStatus.OK)
  pauseRule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<GetRecurringRuleResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: RuleLifecycleTcpPayload = { id };

    return this.coreTcpClient.send<GetRecurringRuleResponse, RuleLifecycleTcpPayload>(
      PLANNING_PATTERNS.PAUSE_RULE,
      payload,
      { requestId: context.requestId, userId: currentUser.userId },
    );
  }

  @Post('rules/:id/resume')
  @HttpCode(HttpStatus.OK)
  resumeRule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<GetRecurringRuleResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: RuleLifecycleTcpPayload = { id };

    return this.coreTcpClient.send<GetRecurringRuleResponse, RuleLifecycleTcpPayload>(
      PLANNING_PATTERNS.RESUME_RULE,
      payload,
      { requestId: context.requestId, userId: currentUser.userId },
    );
  }

  @Post('rules/:id/archive')
  @HttpCode(HttpStatus.OK)
  archiveRule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<ArchiveRecurringRuleResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: RuleLifecycleTcpPayload = { id };

    return this.coreTcpClient.send<ArchiveRecurringRuleResponse, RuleLifecycleTcpPayload>(
      PLANNING_PATTERNS.ARCHIVE_RULE,
      payload,
      { requestId: context.requestId, userId: currentUser.userId },
    );
  }

  @Get('occurrences')
  @HttpCode(HttpStatus.OK)
  listOccurrences(
    @Query() query: ListRecurringOccurrencesQueryDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<ListRecurringOccurrencesResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);

    const payload: ListRecurringOccurrencesTcpPayload = {
      ...(query.fromDate !== undefined ? { fromDate: query.fromDate } : {}),
      ...(query.toDate !== undefined ? { toDate: query.toDate } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.currency !== undefined ? { currency: query.currency } : {}),
      ...(query.kind !== undefined ? { kind: query.kind } : {}),
      ...(query.ruleId !== undefined ? { ruleId: query.ruleId } : {}),
    };

    return this.coreTcpClient.send<
      ListRecurringOccurrencesResponse,
      ListRecurringOccurrencesTcpPayload
    >(PLANNING_PATTERNS.LIST_OCCURRENCES, payload, {
      requestId: context.requestId,
      userId: currentUser.userId,
    });
  }

  @Post('occurrences/:id/pay')
  @HttpCode(HttpStatus.CREATED)
  payOccurrence(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PayRecurringOccurrenceDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<PayRecurringOccurrenceResponse> {
    const idempotencyKey = extractRequiredIdempotencyKey(request);
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);

    const payload: PayRecurringOccurrenceTcpPayload = {
      id,
      fundId: dto.fundId,
      idempotencyKey,
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...(dto.occurredOn !== undefined ? { occurredOn: dto.occurredOn } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    };

    return this.coreTcpClient.send<
      PayRecurringOccurrenceResponse,
      PayRecurringOccurrenceTcpPayload
    >(PLANNING_PATTERNS.PAY_OCCURRENCE, payload, {
      requestId: context.requestId,
      userId: currentUser.userId,
    });
  }

  @Post('occurrences/:id/skip')
  @HttpCode(HttpStatus.OK)
  skipOccurrence(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<OccurrenceStatusResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: OccurrenceLifecycleTcpPayload = { id };

    return this.coreTcpClient.send<OccurrenceStatusResponse, OccurrenceLifecycleTcpPayload>(
      PLANNING_PATTERNS.SKIP_OCCURRENCE,
      payload,
      { requestId: context.requestId, userId: currentUser.userId },
    );
  }

  @Post('occurrences/:id/unskip')
  @HttpCode(HttpStatus.OK)
  unskipOccurrence(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<OccurrenceStatusResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: OccurrenceLifecycleTcpPayload = { id };

    return this.coreTcpClient.send<OccurrenceStatusResponse, OccurrenceLifecycleTcpPayload>(
      PLANNING_PATTERNS.UNSKIP_OCCURRENCE,
      payload,
      { requestId: context.requestId, userId: currentUser.userId },
    );
  }
}
