import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  GetMonthlySummaryTcpPayload,
  GetTransactionByIdTcpPayload,
  GetTransactionResponse,
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
  VoidTransactionResponse,
  VoidTransactionTcpPayload,
} from '@app/shared';
import { Request } from 'express';
import { AuthenticatedGatewayUser } from '../auth/auth-jwt.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CoreTcpClientService } from '../core-client/core-tcp-client.service';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { MonthlySummaryQueryDto } from './dto/monthly-summary-query.dto';
import { RecordAdjustmentDto } from './dto/record-adjustment.dto';
import { RecordTransactionDto } from './dto/record-transaction.dto';
import { RecordTransferDto } from './dto/record-transfer.dto';
import { RefundTransactionDto } from './dto/refund-transaction.dto';
import { VoidTransactionDto } from './dto/void-transaction.dto';

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

function extractOptionalIdempotencyKey(request: Request): string | undefined {
  const rawHeader = request.headers['idempotency-key'];
  if (rawHeader === undefined) {
    return undefined;
  }

  if (Array.isArray(rawHeader)) {
    throw new BadRequestException('Invalid Idempotency-Key header');
  }

  const trimmed = rawHeader.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new BadRequestException('Idempotency-Key must be between 1 and 128 characters');
  }

  return trimmed;
}

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class LedgerController {
  constructor(private readonly coreTcpClient: CoreTcpClientService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  recordTransaction(
    @Body() dto: RecordTransactionDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<RecordTransactionResponse> {
    const idempotencyKey = extractOptionalIdempotencyKey(request);
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);

    const payload: RecordTransactionTcpPayload = {
      type: dto.type,
      fundId: dto.fundId,
      amount: dto.amount,
      description: dto.description,
      ...(dto.occurredOn !== undefined ? { occurredOn: dto.occurredOn } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
      ...(dto.splits !== undefined ? { splits: dto.splits } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    };

    return this.coreTcpClient.send<RecordTransactionResponse, RecordTransactionTcpPayload>(
      LEDGER_PATTERNS.RECORD_TRANSACTION,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }

  @Post('transfers')
  @HttpCode(HttpStatus.CREATED)
  recordTransfer(
    @Body() dto: RecordTransferDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<RecordTransferResponse> {
    const idempotencyKey = extractOptionalIdempotencyKey(request);
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);

    const payload: RecordTransferTcpPayload = {
      sourceFundId: dto.sourceFundId,
      destinationFundId: dto.destinationFundId,
      amount: dto.amount,
      description: dto.description,
      ...(dto.occurredOn !== undefined ? { occurredOn: dto.occurredOn } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    };

    return this.coreTcpClient.send<RecordTransferResponse, RecordTransferTcpPayload>(
      LEDGER_PATTERNS.RECORD_TRANSFER,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }

  @Post('adjustments')
  @HttpCode(HttpStatus.CREATED)
  recordAdjustment(
    @Body() dto: RecordAdjustmentDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<RecordAdjustmentResponse> {
    const idempotencyKey = extractOptionalIdempotencyKey(request);
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);

    const payload: RecordAdjustmentTcpPayload = {
      fundId: dto.fundId,
      direction: dto.direction,
      amount: dto.amount,
      description: dto.description,
      ...(dto.occurredOn !== undefined ? { occurredOn: dto.occurredOn } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    };

    return this.coreTcpClient.send<RecordAdjustmentResponse, RecordAdjustmentTcpPayload>(
      LEDGER_PATTERNS.RECORD_ADJUSTMENT,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.CREATED)
  voidTransaction(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VoidTransactionDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<VoidTransactionResponse> {
    const idempotencyKey = extractOptionalIdempotencyKey(request);
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);

    const payload: VoidTransactionTcpPayload = {
      id,
      ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
      ...(dto.occurredOn !== undefined ? { occurredOn: dto.occurredOn } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    };

    return this.coreTcpClient.send<VoidTransactionResponse, VoidTransactionTcpPayload>(
      LEDGER_PATTERNS.VOID_TRANSACTION,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.CREATED)
  refundTransaction(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RefundTransactionDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<RefundTransactionResponse> {
    const idempotencyKey = extractOptionalIdempotencyKey(request);
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);

    const payload: RefundTransactionTcpPayload = {
      id,
      amount: dto.amount,
      ...(dto.occurredOn !== undefined ? { occurredOn: dto.occurredOn } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    };

    return this.coreTcpClient.send<RefundTransactionResponse, RefundTransactionTcpPayload>(
      LEDGER_PATTERNS.REFUND_TRANSACTION,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  listTransactions(
    @Query() query: ListTransactionsQueryDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<ListTransactionsResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);

    const payload: ListTransactionsTcpPayload = {
      ...(query.page !== undefined ? { page: query.page } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.fundId !== undefined ? { fundId: query.fundId } : {}),
      ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
      ...(query.type !== undefined ? { type: query.type } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.currency !== undefined ? { currency: query.currency } : {}),
      ...(query.fromDate !== undefined ? { fromDate: query.fromDate } : {}),
      ...(query.toDate !== undefined ? { toDate: query.toDate } : {}),
      ...(query.search !== undefined ? { search: query.search } : {}),
    };

    return this.coreTcpClient.send<ListTransactionsResponse, ListTransactionsTcpPayload>(
      LEDGER_PATTERNS.LIST_TRANSACTIONS,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }

  @Get('summary/monthly')
  @HttpCode(HttpStatus.OK)
  getMonthlySummary(
    @Query() query: MonthlySummaryQueryDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<MonthlySummaryResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);

    const payload: GetMonthlySummaryTcpPayload = {
      ...(query.month !== undefined ? { month: query.month } : {}),
      ...(query.fundId !== undefined ? { fundId: query.fundId } : {}),
    };

    return this.coreTcpClient.send<MonthlySummaryResponse, GetMonthlySummaryTcpPayload>(
      LEDGER_PATTERNS.GET_MONTHLY_SUMMARY,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  getById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<GetTransactionResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: GetTransactionByIdTcpPayload = { id };

    return this.coreTcpClient.send<GetTransactionResponse, GetTransactionByIdTcpPayload>(
      LEDGER_PATTERNS.GET_BY_ID,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }
}
