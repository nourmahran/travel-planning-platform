import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { ItinerariesService } from './itineraries.service';
import { requireDay } from './subdocuments';
import { resolveEntryCurrency } from './entry-currency';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import type { BudgetEntry } from './schemas/itinerary.schema';
import { toBudgetResponse } from './itinerary-detail';

type BookingKind = 'flight' | 'hotel';

@Injectable()
export class ItineraryBookingsService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly referenceData: ReferenceDataService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private kind(value: string): BookingKind {
    if (value !== 'flight' && value !== 'hotel') throw new BadRequestException('Booking type must be flight or hotel');
    return value;
  }

  async link(ownerId: string, itineraryId: string, dayId: string, kindInput: string, bookingId: string) {
    const kind = this.kind(kindInput);
    const itinerary = await this.itineraries.findOne(ownerId, itineraryId);
    const day = requireDay(itinerary, dayId);
    const booking = await this.connection.collection(kind === 'flight' ? 'bookings' : 'hotel_bookings').findOne({ _id: new Types.ObjectId(bookingId) });
    if (!booking ||
      (kind === 'flight' ? booking.userId !== ownerId : String(booking.userId) !== ownerId)) {
      throw new NotFoundException('Booking not found');
    }
    if (!(kind === 'flight' ? ['Confirmed', 'Completed'].includes(String(booking.status)) : ['CONFIRMED', 'COMPLETED'].includes(String(booking.status)))) {
      throw new ConflictException('Only confirmed or completed bookings can be linked');
    }
    if (itinerary.days.some((entry) => entry.budgets.some((budget) =>
      budget.bookingType === kind && budget.bookingId?.toString() === bookingId))) {
      throw new ConflictException('Booking is already linked to this itinerary');
    }
    const amount = kind === 'flight' ? Number(booking.totalPrice) : Number(booking.totalAmountCents) / 100;
    const currency = kind === 'flight'
      ? (process.env.PLATFORM_CURRENCY ?? 'USD').toUpperCase()
      : String(booking.currency).toUpperCase();
    if (!Number.isFinite(amount) || amount < 0) throw new ConflictException('Booking has no valid total');
    if (currency !== itinerary.currency) {
      await resolveEntryCurrency(currency, itinerary.currency, this.referenceData);
    }
    day.budgets.push({
      category: kind === 'flight' ? 'local_transport' : 'accommodation',
      amount, currency, bookingType: kind, bookingId: new Types.ObjectId(bookingId),
      note: kind === 'flight' ? 'Linked flight booking' : 'Linked hotel reservation',
    } as BudgetEntry);
    await itinerary.save();
    const added = day.budgets[day.budgets.length - 1];
    return toBudgetResponse(added as BudgetEntry & { _id: Types.ObjectId }, itinerary.currency);
  }

  async unlink(ownerId: string, itineraryId: string, dayId: string, kindInput: string, bookingId: string) {
    const kind = this.kind(kindInput);
    const itinerary = await this.itineraries.findOne(ownerId, itineraryId);
    const day = requireDay(itinerary, dayId);
    const index = day.budgets.findIndex((budget) => budget.bookingType === kind && budget.bookingId?.toString() === bookingId);
    if (index < 0) throw new NotFoundException('Booking link not found');
    day.budgets.splice(index, 1);
    await itinerary.save();
    return { unlinked: true };
  }
}
