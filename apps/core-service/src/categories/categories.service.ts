import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  ArchiveCategoryResponse,
  ArchiveCategoryTcpPayload,
  CategoryResponse,
  CategoryView,
  CreateCategoryTcpPayload,
  InternalAuthContext,
  ListCategoriesResponse,
  ListCategoriesTcpPayload,
  UnarchiveCategoryResponse,
  UnarchiveCategoryTcpPayload,
  UpdateCategoryTcpPayload,
} from '@app/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

function buildBadRequestRpc(message: string): RpcException {
  return new RpcException({
    statusCode: 400,
    error: 'Bad Request',
    message,
  });
}

function buildUnauthorizedRpc(message: string): RpcException {
  return new RpcException({
    statusCode: 401,
    error: 'Unauthorized',
    message,
  });
}

function buildForbiddenRpc(message: string): RpcException {
  return new RpcException({
    statusCode: 403,
    error: 'Forbidden',
    message,
  });
}

function buildNotFoundRpc(message: string): RpcException {
  return new RpcException({
    statusCode: 404,
    error: 'Not Found',
    message,
  });
}

function buildConflictRpc(message: string): RpcException {
  return new RpcException({
    statusCode: 409,
    error: 'Conflict',
    message,
  });
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

interface CategoryDbProjection {
  id: string;
  userId: string | null;
  name: string;
  kind: 'INCOME' | 'EXPENSE';
  color: string | null;
  icon: string | null;
  isSystem: boolean;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toCategoryView(category: CategoryDbProjection): CategoryView {
  return {
    id: category.id,
    userId: category.userId,
    name: category.name,
    kind: category.kind,
    color: category.color,
    icon: category.icon,
    isSystem: category.isSystem,
    isArchived: category.isArchived,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

function requireAuthenticatedUserId(context: InternalAuthContext): string {
  if (typeof context.userId !== 'string' || context.userId.trim().length === 0) {
    throw buildUnauthorizedRpc('Authenticated user context is required');
  }

  return context.userId;
}

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(
    context: InternalAuthContext,
    payload: ListCategoriesTcpPayload,
  ): Promise<ListCategoriesResponse> {
    const userId = requireAuthenticatedUserId(context);

    const where: Prisma.CategoryWhereInput = {
      OR: [{ isSystem: true }, { userId }],
    };

    if (payload.kind) {
      where.kind = payload.kind;
    }

    if (payload.includeArchived !== true) {
      where.isArchived = false;
    }

    const categories = await this.prisma.category.findMany({
      where,
      orderBy: [{ isSystem: 'desc' }, { kind: 'asc' }, { name: 'asc' }],
    });

    return {
      categories: categories.map(toCategoryView),
    };
  }

  async create(
    context: InternalAuthContext,
    payload: CreateCategoryTcpPayload,
  ): Promise<CategoryResponse> {
    const userId = requireAuthenticatedUserId(context);
    const trimmedName = typeof payload.name === 'string' ? payload.name.trim() : '';

    if (trimmedName.length === 0 || trimmedName.length > 100) {
      throw buildBadRequestRpc('Invalid category name');
    }

    if (payload.kind !== 'INCOME' && payload.kind !== 'EXPENSE') {
      throw buildBadRequestRpc('Invalid category kind');
    }

    const trimmedColor =
      typeof payload.color === 'string'
        ? payload.color.trim()
        : payload.color === null
          ? null
          : undefined;

    const trimmedIcon =
      typeof payload.icon === 'string'
        ? payload.icon.trim()
        : payload.icon === null
          ? null
          : undefined;

    // Check collision case-insensitive against active system categories and active own categories
    const collision = await this.prisma.category.findFirst({
      where: {
        kind: payload.kind,
        isArchived: false,
        name: { equals: trimmedName, mode: 'insensitive' },
        OR: [{ isSystem: true }, { userId }],
      },
      select: { id: true },
    });

    if (collision) {
      throw buildConflictRpc('A category with this name and kind already exists');
    }

    try {
      const created = await this.prisma.category.create({
        data: {
          userId,
          name: trimmedName,
          kind: payload.kind,
          color: trimmedColor ?? null,
          icon: trimmedIcon ?? null,
          isSystem: false,
          isArchived: false,
        },
      });

      return { category: toCategoryView(created) };
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw buildConflictRpc('A category with this name and kind already exists');
      }
      throw error;
    }
  }

  async update(
    context: InternalAuthContext,
    payload: UpdateCategoryTcpPayload,
  ): Promise<CategoryResponse> {
    const userId = requireAuthenticatedUserId(context);

    if (payload.name === undefined && payload.color === undefined && payload.icon === undefined) {
      throw buildBadRequestRpc(
        'At least one field (name, color, or icon) must be provided for update',
      );
    }

    const category = await this.prisma.category.findUnique({
      where: { id: payload.id },
    });

    if (!category) {
      throw buildNotFoundRpc('Category not found');
    }

    if (category.isSystem) {
      throw buildForbiddenRpc('System categories cannot be modified');
    }

    if (category.userId !== userId) {
      throw buildNotFoundRpc('Category not found');
    }

    if (category.isArchived) {
      throw buildBadRequestRpc('Archived categories cannot be modified');
    }

    const updateData: Prisma.CategoryUpdateInput = {};

    if (payload.name !== undefined) {
      const trimmedName = typeof payload.name === 'string' ? payload.name.trim() : '';
      if (trimmedName.length === 0 || trimmedName.length > 100) {
        throw buildBadRequestRpc('Invalid category name');
      }

      // Adjustment 3: Anti auto-colisión: exclude current category id
      const collision = await this.prisma.category.findFirst({
        where: {
          id: { not: category.id },
          kind: category.kind,
          isArchived: false,
          name: { equals: trimmedName, mode: 'insensitive' },
          OR: [{ isSystem: true }, { userId }],
        },
        select: { id: true },
      });

      if (collision) {
        throw buildConflictRpc('A category with this name and kind already exists');
      }

      updateData.name = trimmedName;
    }

    if (payload.color !== undefined) {
      updateData.color = typeof payload.color === 'string' ? payload.color.trim() : payload.color;
    }

    if (payload.icon !== undefined) {
      updateData.icon = typeof payload.icon === 'string' ? payload.icon.trim() : payload.icon;
    }

    try {
      const updated = await this.prisma.category.update({
        where: { id: category.id },
        data: updateData,
      });

      return { category: toCategoryView(updated) };
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw buildConflictRpc('A category with this name and kind already exists');
      }
      throw error;
    }
  }

  async archive(
    context: InternalAuthContext,
    payload: ArchiveCategoryTcpPayload,
  ): Promise<ArchiveCategoryResponse> {
    const userId = requireAuthenticatedUserId(context);

    const category = await this.prisma.category.findUnique({
      where: { id: payload.id },
    });

    if (!category) {
      throw buildNotFoundRpc('Category not found');
    }

    if (category.isSystem) {
      throw buildForbiddenRpc('System categories cannot be archived');
    }

    if (category.userId !== userId) {
      throw buildNotFoundRpc('Category not found');
    }

    // Adjustment 3: Idempotent if already archived
    if (!category.isArchived) {
      await this.prisma.category.update({
        where: { id: category.id },
        data: { isArchived: true },
      });
    }

    return {
      id: category.id,
      isArchived: true,
      message: 'Category archived successfully.',
    };
  }

  async unarchive(
    context: InternalAuthContext,
    payload: UnarchiveCategoryTcpPayload,
  ): Promise<UnarchiveCategoryResponse> {
    const userId = requireAuthenticatedUserId(context);

    const category = await this.prisma.category.findUnique({
      where: { id: payload.id },
    });

    if (!category) {
      throw buildNotFoundRpc('Category not found');
    }

    if (category.isSystem) {
      throw buildForbiddenRpc('System categories cannot be modified');
    }

    if (category.userId !== userId) {
      throw buildNotFoundRpc('Category not found');
    }

    // Adjustment 3: Idempotent if already active
    if (!category.isArchived) {
      return {
        id: category.id,
        isArchived: false,
        message: 'Category unarchived successfully.',
      };
    }

    // Check collision against active categories excluding current category id
    const collision = await this.prisma.category.findFirst({
      where: {
        id: { not: category.id },
        kind: category.kind,
        isArchived: false,
        name: { equals: category.name.trim(), mode: 'insensitive' },
        OR: [{ isSystem: true }, { userId }],
      },
      select: { id: true },
    });

    if (collision) {
      throw buildConflictRpc('An active category with this name and kind already exists');
    }

    try {
      await this.prisma.category.update({
        where: { id: category.id },
        data: { isArchived: false },
      });

      return {
        id: category.id,
        isArchived: false,
        message: 'Category unarchived successfully.',
      };
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw buildConflictRpc('An active category with this name and kind already exists');
      }
      throw error;
    }
  }
}
