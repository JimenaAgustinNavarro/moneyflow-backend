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
  ArchiveCategoryResponse,
  ArchiveCategoryTcpPayload,
  CATEGORIES_PATTERNS,
  CategoryResponse,
  CreateCategoryTcpPayload,
  ListCategoriesResponse,
  ListCategoriesTcpPayload,
  UnarchiveCategoryResponse,
  UnarchiveCategoryTcpPayload,
  UpdateCategoryTcpPayload,
} from '@app/shared';
import { Request } from 'express';
import { AuthenticatedGatewayUser } from '../auth/auth-jwt.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CoreTcpClientService } from '../core-client/core-tcp-client.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('categories')
@UseGuards(JwtAuthGuard)
export class CategoriesController {
  constructor(private readonly coreTcpClient: CoreTcpClientService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  listCategories(
    @Query() query: ListCategoriesQueryDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<ListCategoriesResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: ListCategoriesTcpPayload = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.includeArchived !== undefined ? { includeArchived: query.includeArchived } : {}),
    };

    return this.coreTcpClient.send<ListCategoriesResponse, ListCategoriesTcpPayload>(
      CATEGORIES_PATTERNS.LIST,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<CategoryResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: CreateCategoryTcpPayload = {
      name: dto.name,
      kind: dto.kind,
      color: dto.color ?? null,
      icon: dto.icon ?? null,
    };

    return this.coreTcpClient.send<CategoryResponse, CreateCategoryTcpPayload>(
      CATEGORIES_PATTERNS.CREATE,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  updateCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<CategoryResponse> {
    if (dto.name === undefined && dto.color === undefined && dto.icon === undefined) {
      throw new BadRequestException(
        'At least one field (name, color, or icon) must be provided for update',
      );
    }

    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: UpdateCategoryTcpPayload = {
      id,
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.color !== undefined ? { color: dto.color } : {}),
      ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
    };

    return this.coreTcpClient.send<CategoryResponse, UpdateCategoryTcpPayload>(
      CATEGORIES_PATTERNS.UPDATE,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  archiveCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<ArchiveCategoryResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: ArchiveCategoryTcpPayload = { id };

    return this.coreTcpClient.send<ArchiveCategoryResponse, ArchiveCategoryTcpPayload>(
      CATEGORIES_PATTERNS.ARCHIVE,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }

  @Post(':id/unarchive')
  @HttpCode(HttpStatus.OK)
  unarchiveCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthenticatedGatewayUser,
    @Req() request: Request,
  ): Promise<UnarchiveCategoryResponse> {
    const context = this.coreTcpClient.buildRequestContext(request, currentUser.userId);
    const payload: UnarchiveCategoryTcpPayload = { id };

    return this.coreTcpClient.send<UnarchiveCategoryResponse, UnarchiveCategoryTcpPayload>(
      CATEGORIES_PATTERNS.UNARCHIVE,
      payload,
      {
        requestId: context.requestId,
        userId: currentUser.userId,
      },
    );
  }
}
