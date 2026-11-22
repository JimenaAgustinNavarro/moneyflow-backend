import { RpcException } from '@nestjs/microservices';
import { Test, TestingModule } from '@nestjs/testing';
import { InternalAuthContext } from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesService } from './categories.service';

interface MockCategory {
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

describe('CategoriesService', () => {
  let service: CategoriesService;
  let mockPrisma: {
    category: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  const userContextA: InternalAuthContext = {
    requestId: 'req-cat-test-1',
    userId: 'user-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    timestamp: Date.now(),
    signature: 'a'.repeat(64),
  };

  const userContextB: InternalAuthContext = {
    requestId: 'req-cat-test-2',
    userId: 'user-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    timestamp: Date.now(),
    signature: 'b'.repeat(64),
  };

  const systemCategory: MockCategory = {
    id: 'sys-cat-1111-1111-1111-111111111111',
    userId: null,
    name: 'Alimentación',
    kind: 'EXPENSE',
    color: '#EA580C',
    icon: 'utensils',
    isSystem: true,
    isArchived: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const userCategoryA: MockCategory = {
    id: 'usr-cat-aaaa-1111-1111-111111111111',
    userId: userContextA.userId,
    name: 'Gimnasio',
    kind: 'EXPENSE',
    color: '#0284C7',
    icon: 'dumbbell',
    isSystem: false,
    isArchived: false,
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
  };

  const userCategoryB: MockCategory = {
    id: 'usr-cat-bbbb-2222-2222-222222222222',
    userId: userContextB.userId,
    name: 'Mascotas',
    kind: 'EXPENSE',
    color: '#CA8A04',
    icon: 'dog',
    isSystem: false,
    isArchived: false,
    createdAt: new Date('2026-02-02T00:00:00.000Z'),
    updatedAt: new Date('2026-02-02T00:00:00.000Z'),
  };

  beforeEach(async () => {
    mockPrisma = {
      category: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
  });

  describe('list', () => {
    it('returns system and owned categories ordered deterministically', async () => {
      mockPrisma.category.findMany.mockResolvedValue([systemCategory, userCategoryA]);

      const result = await service.list(userContextA, {});

      expect(mockPrisma.category.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ isSystem: true }, { userId: userContextA.userId }],
          isArchived: false,
        },
        orderBy: [{ isSystem: 'desc' }, { kind: 'asc' }, { name: 'asc' }],
      });
      expect(result.categories).toHaveLength(2);
      expect(result.categories[0].name).toBe('Alimentación');
      expect(result.categories[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(result.categories[1].name).toBe('Gimnasio');
    });

    it('filters by kind and includes archived when requested', async () => {
      mockPrisma.category.findMany.mockResolvedValue([userCategoryA]);

      const result = await service.list(userContextA, {
        kind: 'EXPENSE',
        includeArchived: true,
      });

      expect(mockPrisma.category.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ isSystem: true }, { userId: userContextA.userId }],
          kind: 'EXPENSE',
        },
        orderBy: [{ isSystem: 'desc' }, { kind: 'asc' }, { name: 'asc' }],
      });
      expect(result.categories).toHaveLength(1);
    });

    it('throws 401 when userId is missing from context', async () => {
      await expect(service.list({ ...userContextA, userId: null }, {})).rejects.toThrow(
        RpcException,
      );
    });
  });

  describe('create', () => {
    it('creates a custom category with isSystem=false and owner=context.userId', async () => {
      mockPrisma.category.findFirst.mockResolvedValue(null);
      mockPrisma.category.create.mockResolvedValue({
        ...userCategoryA,
        name: 'Suscripciones',
      });

      const result = await service.create(userContextA, {
        name: '  Suscripciones  ',
        kind: 'EXPENSE',
        color: '#4F46E5',
        icon: 'credit-card',
      });

      expect(mockPrisma.category.findFirst).toHaveBeenCalledWith({
        where: {
          kind: 'EXPENSE',
          isArchived: false,
          name: { equals: 'Suscripciones', mode: 'insensitive' },
          OR: [{ isSystem: true }, { userId: userContextA.userId }],
        },
        select: { id: true },
      });
      expect(mockPrisma.category.create).toHaveBeenCalledWith({
        data: {
          userId: userContextA.userId,
          name: 'Suscripciones',
          kind: 'EXPENSE',
          color: '#4F46E5',
          icon: 'credit-card',
          isSystem: false,
          isArchived: false,
        },
      });
      expect(result.category.name).toBe('Suscripciones');
      expect(result.category.isSystem).toBe(false);
    });

    it('throws 409 when category name collides case-insensitively with active category', async () => {
      mockPrisma.category.findFirst.mockResolvedValue({ id: systemCategory.id });

      await expect(
        service.create(userContextA, {
          name: 'alimentación',
          kind: 'EXPENSE',
        }),
      ).rejects.toThrow(RpcException);

      try {
        await service.create(userContextA, {
          name: 'alimentación',
          kind: 'EXPENSE',
        });
      } catch (err: unknown) {
        const error = (err as RpcException).getError() as { statusCode: number };
        expect(error.statusCode).toBe(409);
      }
    });

    it('catches Prisma P2002 unique violation and returns 409', async () => {
      mockPrisma.category.findFirst.mockResolvedValue(null);
      mockPrisma.category.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.create(userContextA, {
          name: 'Inversiones Extra',
          kind: 'INCOME',
        }),
      ).rejects.toThrow(RpcException);

      try {
        await service.create(userContextA, {
          name: 'Inversiones Extra',
          kind: 'INCOME',
        });
      } catch (err: unknown) {
        const error = (err as RpcException).getError() as { statusCode: number };
        expect(error.statusCode).toBe(409);
      }
    });

    it('throws 400 when name is empty after trim', async () => {
      await expect(
        service.create(userContextA, {
          name: '   ',
          kind: 'EXPENSE',
        }),
      ).rejects.toThrow(RpcException);
    });
  });

  describe('update', () => {
    it('updates own category allowing rename and nullable fields', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(userCategoryA);
      mockPrisma.category.findFirst.mockResolvedValue(null);
      mockPrisma.category.update.mockResolvedValue({
        ...userCategoryA,
        name: 'Gimnasio y Deporte',
        color: null,
      });

      const result = await service.update(userContextA, {
        id: userCategoryA.id,
        name: 'Gimnasio y Deporte',
        color: null,
      });

      expect(mockPrisma.category.update).toHaveBeenCalledWith({
        where: { id: userCategoryA.id },
        data: {
          name: 'Gimnasio y Deporte',
          color: null,
        },
      });
      expect(result.category.name).toBe('Gimnasio y Deporte');
      expect(result.category.color).toBeNull();
    });

    it('anti auto-colisión: renaming "gimnasio" to "Gimnasio" on same category succeeds (200, not 409)', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(userCategoryA);
      // findFirst excludes category.id so it returns null
      mockPrisma.category.findFirst.mockResolvedValue(null);
      mockPrisma.category.update.mockResolvedValue({
        ...userCategoryA,
        name: 'GIMNASIO',
      });

      const result = await service.update(userContextA, {
        id: userCategoryA.id,
        name: 'GIMNASIO',
      });

      expect(mockPrisma.category.findFirst).toHaveBeenCalledWith({
        where: {
          id: { not: userCategoryA.id },
          kind: userCategoryA.kind,
          isArchived: false,
          name: { equals: 'GIMNASIO', mode: 'insensitive' },
          OR: [{ isSystem: true }, { userId: userContextA.userId }],
        },
        select: { id: true },
      });
      expect(result.category.name).toBe('GIMNASIO');
    });

    it('throws 400 when no fields are provided for update', async () => {
      await expect(
        service.update(userContextA, {
          id: userCategoryA.id,
        }),
      ).rejects.toThrow(RpcException);
    });

    it('throws 403 when attempting to update a system category', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(systemCategory);

      try {
        await service.update(userContextA, {
          id: systemCategory.id,
          name: 'Alimentación Modificada',
        });
        fail('Should have thrown RpcException');
      } catch (err: unknown) {
        const error = (err as RpcException).getError() as { statusCode: number };
        expect(error.statusCode).toBe(403);
      }
    });

    it('throws 400 when attempting to update an archived category', async () => {
      mockPrisma.category.findUnique.mockResolvedValue({
        ...userCategoryA,
        isArchived: true,
      });

      try {
        await service.update(userContextA, {
          id: userCategoryA.id,
          name: 'Gimnasio Reactivado',
        });
        fail('Should have thrown RpcException');
      } catch (err: unknown) {
        const error = (err as RpcException).getError() as { statusCode: number };
        expect(error.statusCode).toBe(400);
      }
    });

    it('throws 404 when category does not exist', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(null);

      try {
        await service.update(userContextA, {
          id: 'non-existent-id',
          name: 'Nuevo Nombre',
        });
        fail('Should have thrown RpcException');
      } catch (err: unknown) {
        const error = (err as RpcException).getError() as { statusCode: number };
        expect(error.statusCode).toBe(404);
      }
    });
  });

  describe('archive', () => {
    it('archives own category and returns 200', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(userCategoryA);
      mockPrisma.category.update.mockResolvedValue({
        ...userCategoryA,
        isArchived: true,
      });

      const result = await service.archive(userContextA, { id: userCategoryA.id });

      expect(mockPrisma.category.update).toHaveBeenCalledWith({
        where: { id: userCategoryA.id },
        data: { isArchived: true },
      });
      expect(result.id).toBe(userCategoryA.id);
      expect(result.isArchived).toBe(true);
    });

    it('is idempotent when category is already archived', async () => {
      mockPrisma.category.findUnique.mockResolvedValue({
        ...userCategoryA,
        isArchived: true,
      });

      const result = await service.archive(userContextA, { id: userCategoryA.id });

      expect(mockPrisma.category.update).not.toHaveBeenCalled();
      expect(result.isArchived).toBe(true);
    });

    it('throws 403 when attempting to archive a system category', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(systemCategory);

      try {
        await service.archive(userContextA, { id: systemCategory.id });
        fail('Should have thrown RpcException');
      } catch (err: unknown) {
        const error = (err as RpcException).getError() as { statusCode: number };
        expect(error.statusCode).toBe(403);
      }
    });
  });

  describe('unarchive', () => {
    it('unarchives own category when no collision exists', async () => {
      mockPrisma.category.findUnique.mockResolvedValue({
        ...userCategoryA,
        isArchived: true,
      });
      mockPrisma.category.findFirst.mockResolvedValue(null);
      mockPrisma.category.update.mockResolvedValue({
        ...userCategoryA,
        isArchived: false,
      });

      const result = await service.unarchive(userContextA, { id: userCategoryA.id });

      expect(mockPrisma.category.update).toHaveBeenCalledWith({
        where: { id: userCategoryA.id },
        data: { isArchived: false },
      });
      expect(result.isArchived).toBe(false);
    });

    it('is idempotent when category is already active', async () => {
      mockPrisma.category.findUnique.mockResolvedValue({
        ...userCategoryA,
        isArchived: false,
      });

      const result = await service.unarchive(userContextA, { id: userCategoryA.id });

      expect(mockPrisma.category.update).not.toHaveBeenCalled();
      expect(result.isArchived).toBe(false);
    });

    it('throws 409 when unarchiving collides with an existing active category', async () => {
      mockPrisma.category.findUnique.mockResolvedValue({
        ...userCategoryA,
        isArchived: true,
      });
      mockPrisma.category.findFirst.mockResolvedValue({ id: 'another-active-cat' });

      try {
        await service.unarchive(userContextA, { id: userCategoryA.id });
        fail('Should have thrown RpcException');
      } catch (err: unknown) {
        const error = (err as RpcException).getError() as { statusCode: number };
        expect(error.statusCode).toBe(409);
      }
    });

    it('throws 403 when attempting to unarchive a system category', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(systemCategory);

      try {
        await service.unarchive(userContextA, { id: systemCategory.id });
        fail('Should have thrown RpcException');
      } catch (err: unknown) {
        const error = (err as RpcException).getError() as { statusCode: number };
        expect(error.statusCode).toBe(403);
      }
    });
  });

  describe('SEC-002: cross-user isolation suite', () => {
    it('User A cannot update User B category (returns 404)', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(userCategoryB);

      try {
        await service.update(userContextA, {
          id: userCategoryB.id,
          name: 'Ataque Inyeccion',
        });
        fail('Should have thrown 404');
      } catch (err: unknown) {
        const error = (err as RpcException).getError() as { statusCode: number };
        expect(error.statusCode).toBe(404);
      }
    });

    it('User A cannot archive User B category (returns 404)', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(userCategoryB);

      try {
        await service.archive(userContextA, { id: userCategoryB.id });
        fail('Should have thrown 404');
      } catch (err: unknown) {
        const error = (err as RpcException).getError() as { statusCode: number };
        expect(error.statusCode).toBe(404);
      }
    });

    it('User A cannot unarchive User B category (returns 404)', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(userCategoryB);

      try {
        await service.unarchive(userContextA, { id: userCategoryB.id });
        fail('Should have thrown 404');
      } catch (err: unknown) {
        const error = (err as RpcException).getError() as { statusCode: number };
        expect(error.statusCode).toBe(404);
      }
    });
  });
});
