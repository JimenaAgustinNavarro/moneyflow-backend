export const CATEGORIES_PATTERNS = {
  LIST: 'categories.list',
  CREATE: 'categories.create',
  UPDATE: 'categories.update',
  ARCHIVE: 'categories.archive',
  UNARCHIVE: 'categories.unarchive',
} as const;

export type CategoryKindUnion = 'INCOME' | 'EXPENSE';

export interface CategoryView {
  id: string;
  userId: string | null;
  name: string;
  kind: CategoryKindUnion;
  color: string | null;
  icon: string | null;
  isSystem: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListCategoriesTcpPayload {
  kind?: CategoryKindUnion;
  includeArchived?: boolean;
}

export interface CreateCategoryTcpPayload {
  name: string;
  kind: CategoryKindUnion;
  color?: string | null;
  icon?: string | null;
}

export interface UpdateCategoryTcpPayload {
  id: string;
  name?: string;
  color?: string | null;
  icon?: string | null;
}

export interface ArchiveCategoryTcpPayload {
  id: string;
}

export interface UnarchiveCategoryTcpPayload {
  id: string;
}

export interface ListCategoriesResponse {
  categories: CategoryView[];
}

export interface CategoryResponse {
  category: CategoryView;
}

export interface ArchiveCategoryResponse {
  id: string;
  isArchived: true;
  message: string;
}

export interface UnarchiveCategoryResponse {
  id: string;
  isArchived: false;
  message: string;
}
