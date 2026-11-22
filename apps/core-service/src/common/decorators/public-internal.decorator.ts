import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_INTERNAL_KEY = 'isPublicInternal';

export const PublicInternal = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_INTERNAL_KEY, true);
