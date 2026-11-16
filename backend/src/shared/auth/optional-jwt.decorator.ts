import { SetMetadata } from '@nestjs/common';

export const OptionalJwt = () => SetMetadata('hotels.optional', true);
export const InternalHotelEndpoint = () => SetMetadata('hotels.internal', true);
