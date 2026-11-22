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
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  GetTransactionByIdTcpPayload,
  GetTransactionResponse,
  LEDGER_PATTERNS,
  RecordTransactionResponse,
  RecordTransactionTcpPayload,
} from '@app/shared';
import { Request } from 'express';
import { AuthenticatedGatewayUser } from '../auth/auth-jwt.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CoreTcpClientService } from '../core-client/core-tcp-client.service';
import { RecordTransactionDto } from './dto/record-transaction.dto';

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
