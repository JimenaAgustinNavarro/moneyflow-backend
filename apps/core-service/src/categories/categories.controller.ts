import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ArchiveCategoryResponse,
  ArchiveCategoryTcpPayload,
  CATEGORIES_PATTERNS,
  CategoryResponse,
  CreateCategoryTcpPayload,
  InternalAuthContext,
  ListCategoriesResponse,
  ListCategoriesTcpPayload,
  SignedTcpEnvelope,
  UnarchiveCategoryResponse,
  UnarchiveCategoryTcpPayload,
  UpdateCategoryTcpPayload,
} from '@app/shared';
import { CurrentInternalContext } from '../common/decorators/current-internal-context.decorator';
import { CategoriesService } from './categories.service';

@Controller()
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @MessagePattern(CATEGORIES_PATTERNS.LIST)
  list(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<ListCategoriesTcpPayload>,
  ): Promise<ListCategoriesResponse> {
    return this.categoriesService.list(context, envelope.payload);
  }

  @MessagePattern(CATEGORIES_PATTERNS.CREATE)
  create(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<CreateCategoryTcpPayload>,
  ): Promise<CategoryResponse> {
    return this.categoriesService.create(context, envelope.payload);
  }

  @MessagePattern(CATEGORIES_PATTERNS.UPDATE)
  update(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<UpdateCategoryTcpPayload>,
  ): Promise<CategoryResponse> {
    return this.categoriesService.update(context, envelope.payload);
  }

  @MessagePattern(CATEGORIES_PATTERNS.ARCHIVE)
  archive(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<ArchiveCategoryTcpPayload>,
  ): Promise<ArchiveCategoryResponse> {
    return this.categoriesService.archive(context, envelope.payload);
  }

  @MessagePattern(CATEGORIES_PATTERNS.UNARCHIVE)
  unarchive(
    @CurrentInternalContext() context: InternalAuthContext,
    @Payload() envelope: SignedTcpEnvelope<UnarchiveCategoryTcpPayload>,
  ): Promise<UnarchiveCategoryResponse> {
    return this.categoriesService.unarchive(context, envelope.payload);
  }
}
