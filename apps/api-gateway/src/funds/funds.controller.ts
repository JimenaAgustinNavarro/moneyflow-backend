import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  ArchiveFundResponse,
  ArchiveFundTcpPayload,
  CreateFundResponse,
  CreateFundTcpPayload,
  FUNDS_PATTERNS,
  GetFundByIdTcpPayload,
  GetFundResponse,
  ListFundsResponse,
  ListFundsTcpPayload,
  UpdateFundResponse,
  UpdateFundTcpPayload,
} from '@app/shared';
import { Request } from 'express';
import { AuthenticatedGatewayUser } from '../auth/auth-jwt.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CoreTcpClientService } from '../core-client/core-tcp-client.service';
import { CreateFundDto } from './dto/create-fund.dto';
import { ListFundsQueryDto } from './dto/list-funds-query.dto';
import { UpdateFundDto } from './dto/update-fund.dto';

@Controller('funds')
@UseGuards(JwtAuthGuard)
export class FundsController {
  constructor(private readonly coreTcpClient: CoreTcpClientService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @Query() query: ListFundsQueryDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<ListFundsResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: ListFundsTcpPayload = {
      ...(query.includeArchived !== undefined ? { includeArchived: query.includeArchived } : {}),
      ...(query.currency !== undefined ? { currency: query.currency } : {}),
      ...(query.type !== undefined ? { type: query.type } : {}),
    };

    return this.coreTcpClient.send<ListFundsResponse, ListFundsTcpPayload>(
      FUNDS_PATTERNS.LIST,
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
  ): Promise<GetFundResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: GetFundByIdTcpPayload = { id };

    return this.coreTcpClient.send<GetFundResponse, GetFundByIdTcpPayload>(
      FUNDS_PATTERNS.GET_BY_ID,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateFundDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<CreateFundResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: CreateFundTcpPayload = {
      name: dto.name,
      type: dto.type,
      ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      ...(dto.color !== undefined ? { color: dto.color } : {}),
      ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
      ...(dto.allowNegativeBalance !== undefined
        ? { allowNegativeBalance: dto.allowNegativeBalance }
        : {}),
      ...(dto.initialBalance !== undefined ? { initialBalance: dto.initialBalance } : {}),
    };

    return this.coreTcpClient.send<CreateFundResponse, CreateFundTcpPayload>(
      FUNDS_PATTERNS.CREATE,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateFundDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<UpdateFundResponse> {
    if (
      dto.name === undefined &&
      dto.type === undefined &&
      dto.color === undefined &&
      dto.icon === undefined &&
      dto.allowNegativeBalance === undefined
    ) {
      throw new BadRequestException('At least one field must be provided for update');
    }

    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: UpdateFundTcpPayload = {
      id,
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.color !== undefined ? { color: dto.color } : {}),
      ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
      ...(dto.allowNegativeBalance !== undefined
        ? { allowNegativeBalance: dto.allowNegativeBalance }
        : {}),
    };

    return this.coreTcpClient.send<UpdateFundResponse, UpdateFundTcpPayload>(
      FUNDS_PATTERNS.UPDATE,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  archive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<ArchiveFundResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: ArchiveFundTcpPayload = { id };

    return this.coreTcpClient.send<ArchiveFundResponse, ArchiveFundTcpPayload>(
      FUNDS_PATTERNS.ARCHIVE,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }
}
