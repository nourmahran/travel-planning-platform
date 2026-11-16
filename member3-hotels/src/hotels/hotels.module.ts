import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelIntegrationsModule } from './integrations/integrations.module';
import { AvailabilityService } from './availability.service';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { ReviewsController, HotelReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { Hotel, HotelSchema } from './schemas/hotel.schema';
import { HotelBooking, HotelBookingSchema } from './schemas/hotel-booking.schema';
import { Review, ReviewSchema } from './schemas/review.schema';
import { RoomAvailability, RoomAvailabilitySchema } from './schemas/room-availability.schema';
import { RoomNightLock, RoomNightLockSchema } from './schemas/room-night-lock.schema';
import { Room, RoomSchema } from './schemas/room.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomAvailability.name, schema: RoomAvailabilitySchema },
      { name: RoomNightLock.name, schema: RoomNightLockSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: Review.name, schema: ReviewSchema },
    ]),
    HotelIntegrationsModule,
  ],
  controllers: [
    HotelsController,
    RoomsController,
    HotelBookingsController,
    ReviewsController,
    HotelReviewsController,
  ],
  providers: [
    HotelsService,
    AvailabilityService,
    RoomsService,
    HotelBookingsService,
    ReviewsService,
  ],
  exports: [
    HotelsService,
    AvailabilityService,
    RoomsService,
    HotelBookingsService,
    ReviewsService,
  ],
})
export class HotelsModule {}
