import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { HotelBookingStatus, HotelBooking, HotelBookingDocument } from '../src/hotels/schemas/hotel-booking.schema';
import { Hotel, HotelDocument } from '../src/hotels/schemas/hotel.schema';
import { Room, RoomDocument } from '../src/hotels/schemas/room.schema';
import { ApiExceptionFilter } from '../src/sandbox/api-exception.filter';
import { SandboxModule } from '../src/sandbox/sandbox.module';

const GUEST = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const GUEST_TWO = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const MODERATOR = 'cccccccccccccccccccccccc';
const ADMIN = 'dddddddddddddddddddddddd';
const INTERNAL_KEY = 'e2e-internal-key';

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function as(userId: string, role: 'USER' | 'HOTEL_MODERATOR' | 'ADMIN' = 'USER') {
  return { 'x-user-id': userId, 'x-user-role': role };
}

function internal() {
  return { 'x-internal-api-key': INTERNAL_KEY };
}

describe('Hotels module (e2e)', () => {
  let replSet: MongoMemoryReplSet;
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let bookingModel: Model<HotelBookingDocument>;
  let hotelModel: Model<HotelDocument>;
  let roomModel: Model<RoomDocument>;

  let hotelId: string;
  let room101: string;
  let room102: string;
  let firstBookingId: string;

  const checkIn = isoDate(8);
  const checkOut = isoDate(10);

  beforeAll(async () => {
    process.env.MONGODB_URI = '';
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODB_URI = replSet.getUri();
    process.env.AUTH_DEV_MODE = 'true';
    process.env.PLATFORM_CURRENCY = 'USD';
    process.env.INTERNAL_API_KEY = INTERNAL_KEY;
    process.env.ENABLE_HOTEL_JOBS = 'false';
    process.env.REQUIRE_POLICY_ACCEPTANCE = 'true';
    process.env.HOTEL_HOLD_MINUTES = '10';

    const moduleRef = await Test.createTestingModule({ imports: [SandboxModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
        validationError: { target: false, value: false },
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    http = request(app.getHttpServer());
    bookingModel = app.get<Model<HotelBookingDocument>>(getModelToken(HotelBooking.name));
    hotelModel = app.get<Model<HotelDocument>>(getModelToken(Hotel.name));
    roomModel = app.get<Model<RoomDocument>>(getModelToken(Room.name));
  });

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  it('lets a moderator create a hotel and rooms, and exposes the profile publicly', async () => {
    const hotelResponse = await http
      .post('/api/hotels')
      .set(as(MODERATOR, 'HOTEL_MODERATOR'))
      .send({
        name: 'E2E Nile Hotel',
        description:
          'A hotel created by the end-to-end test to exercise the complete reservation and review lifecycle.',
        location: { city: 'Cairo', country: 'Egypt', address: '1 Integration Street' },
        amenities: ['wifi', 'pool'],
        images: [{ url: 'https://example.com/hotel.jpg' }],
        starRating: 5,
      })
      .expect(201);

    hotelId = hotelResponse.body.id;
    expect(hotelResponse.body.moderatorId).toBe(MODERATOR);

    const policies = await http
      .put(`/api/hotels/${hotelId}/policies`)
      .set(as(MODERATOR, 'HOTEL_MODERATOR'))
      .send({
        checkInTime: '14:00',
        checkOutTime: '11:00',
        childrenAllowed: true,
        cancellationTiers: [
          { minDaysBeforeCheckIn: 0, refundPercent: 0 },
          { minDaysBeforeCheckIn: 7, refundPercent: 50, description: 'One week' },
          { minDaysBeforeCheckIn: 14, refundPercent: 100, description: 'Two weeks' },
        ],
      })
      .expect(200);
    expect(policies.body.cancellationTiers).toHaveLength(3);

    const roomOne = await http
      .post(`/api/hotels/${hotelId}/rooms`)
      .set(as(MODERATOR, 'HOTEL_MODERATOR'))
      .send({
        roomNumber: '101',
        name: 'Deluxe Double',
        bedType: 'queen',
        bedCount: 1,
        maxAdults: 2,
        maxChildren: 1,
        basePricePerNightCents: 12000,
      })
      .expect(201);

    const roomTwo = await http
      .post(`/api/hotels/${hotelId}/rooms`)
      .set(as(MODERATOR, 'HOTEL_MODERATOR'))
      .send({
        roomNumber: '102',
        name: 'Family Suite',
        bedType: 'king',
        bedCount: 2,
        maxAdults: 4,
        maxChildren: 2,
        basePricePerNightCents: 24000,
      })
      .expect(201);

    room101 = roomOne.body.id;
    room102 = roomTwo.body.id;

    const publicHotel = await http.get(`/api/hotels/${hotelId}`).expect(200);
    expect(publicHotel.body.rooms).toHaveLength(2);
    expect(publicHotel.body.averageRating).toBe(0);
  });

  it('rejects a guest who tries to create a hotel', async () => {
    await http
      .post('/api/hotels')
      .set(as(GUEST))
      .send({
        name: 'Forbidden Hotel',
        description: 'This request must be rejected before it reaches the service layer.',
        location: { city: 'Cairo', country: 'Egypt', address: '2 Integration Street' },
        starRating: 3,
      })
      .expect(403);
  });

  it('searches by destination, dates, guests and rooms', async () => {
    const response = await http
      .get('/api/hotels/search')
      .query({ city: 'Cairo', checkIn, checkOut, guests: 2, rooms: 2, sort: 'price_asc' })
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.items[0].id).toBe(hotelId);
    expect(response.body.items[0].totalPriceCents).toBeGreaterThan(0);
  });

  it('holds multiple rooms atomically and blocks overlapping holds', async () => {
    const booking = await http
      .post('/api/hotel-bookings')
      .set(as(GUEST))
      .send({
        hotelId,
        checkIn,
        checkOut,
        rooms: [
          { roomId: room101, guests: [{ firstName: 'Mona', lastName: 'Ali' }] },
          {
            roomId: room102,
            guests: [
              { firstName: 'Omar', lastName: 'Ali' },
              { firstName: 'Sara', lastName: 'Ali', age: 10 },
            ],
          },
        ],
      })
      .expect(201);

    expect(booking.body.status).toBe(HotelBookingStatus.HELD);
    expect(booking.body.rooms).toHaveLength(2);
    expect(booking.body.nights).toBe(2);
    expect(booking.body.totalAmountCents).toBe(72000);
    expect(booking.body.holdActive).toBe(true);
    firstBookingId = booking.body.id;

    await http
      .post('/api/hotel-bookings')
      .set(as(GUEST_TWO))
      .send({
        hotelId,
        checkIn,
        checkOut,
        rooms: [{ roomId: room101, guests: [{ firstName: 'Other', lastName: 'Guest' }] }],
      })
      .expect(409);

    const calendar = await http
      .get(`/api/hotels/${hotelId}/availability`)
      .query({ from: checkIn, to: checkOut })
      .expect(200);
    const room = calendar.body.rooms.find((item: { roomId: string }) => item.roomId === room101);
    expect(room.days[0].status).toBe('held');
  });

  it('prevents a double booking when two guests race for the same room', async () => {
    const raceDates = { in: isoDate(50), out: isoDate(52) };
    const payload = (guest: string) => ({
      hotelId,
      checkIn: raceDates.in,
      checkOut: raceDates.out,
      rooms: [{ roomId: room101, guests: [{ firstName: guest, lastName: 'Race' }] }],
    });

    const [first, second] = await Promise.all([
      http.post('/api/hotel-bookings').set(as(GUEST)).send(payload('First')),
      http.post('/api/hotel-bookings').set(as(GUEST_TWO)).send(payload('Second')),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const winner = first.status === 201 ? first : second;
    await http
      .post(`/api/hotel-bookings/${winner.body.id}/cancel`)
      .set(as(first.status === 201 ? GUEST : GUEST_TWO))
      .send({})
      .expect(200);
  });

  it('accepts policies and confirms after payment verification', async () => {
    await http
      .post(`/api/hotel-bookings/${firstBookingId}/accept-policies`)
      .set(as(GUEST))
      .expect(200);

    const confirmed = await http
      .post(`/api/hotel-bookings/${firstBookingId}/confirm`)
      .set(internal())
      .send({ paymentId: 'pi_e2e_123' })
      .expect(200);

    expect(confirmed.body.status).toBe(HotelBookingStatus.CONFIRMED);
    expect(confirmed.body.holdActive).toBe(false);
    expect(confirmed.body.paymentId).toBe('pi_e2e_123');

    const history = await http
      .get('/api/hotel-bookings')
      .set(as(GUEST))
      .query({ status: 'CONFIRMED' })
      .expect(200);
    expect(history.body.total).toBe(1);

    const moderatorList = await http
      .get(`/api/hotels/${hotelId}/reservations`)
      .set(as(MODERATOR, 'HOTEL_MODERATOR'))
      .expect(200);
    expect(moderatorList.body.total).toBe(2);
    expect(
      moderatorList.body.items.some(
        (item: { status: string; reference: string }) =>
          item.status === HotelBookingStatus.CONFIRMED && /^HB-/.test(item.reference),
      ),
    ).toBe(true);
  });

  it('quotes and performs a tiered cancellation, then records the refund', async () => {
    const quote = await http
      .get(`/api/hotel-bookings/${firstBookingId}/cancellation-quote`)
      .set(as(GUEST))
      .expect(200);
    expect(quote.body.daysBeforeCheckIn).toBe(8);
    expect(quote.body.refundPercent).toBe(50);
    expect(quote.body.refundAmountCents).toBe(36000);

    const cancelled = await http
      .post(`/api/hotel-bookings/${firstBookingId}/cancel`)
      .set(as(GUEST))
      .send({ reason: 'Plans changed' })
      .expect(200);

    expect(cancelled.body.status).toBe(HotelBookingStatus.CANCELLED);
    expect(cancelled.body.cancellation.refund.amountCents).toBe(36000);
    expect(cancelled.body.cancellation.refund.status).toBe('PENDING');

    const refunded = await http
      .patch(`/api/hotel-bookings/${firstBookingId}/refund`)
      .set(internal())
      .send({ status: 'REFUNDED', providerRefundId: 're_e2e_123' })
      .expect(200);
    expect(refunded.body.cancellation.refund.status).toBe('REFUNDED');

    const available = await http
      .get(`/api/hotels/${hotelId}/rooms/available`)
      .query({ checkIn, checkOut })
      .expect(200);
    expect(available.body.rooms.map((room: { id: string }) => room.id)).toEqual(
      expect.arrayContaining([room101, room102]),
    );
  });

  it('blocks dates and refuses reservations overlapping a moderator block', async () => {
    const blockIn = isoDate(30);
    const blockOut = isoDate(31);

    const block = await http
      .post(`/api/hotels/${hotelId}/rooms/${room102}/availability`)
      .set(as(MODERATOR, 'HOTEL_MODERATOR'))
      .send({ startDate: blockIn, endDate: blockOut, reason: 'Maintenance' })
      .expect(201);

    await http
      .post('/api/hotel-bookings')
      .set(as(GUEST))
      .send({
        hotelId,
        checkIn: blockIn,
        checkOut: isoDate(32),
        rooms: [{ roomId: room102, guests: [{ firstName: 'Blocked', lastName: 'Guest' }] }],
      })
      .expect(409);

    await http
      .delete(`/api/hotels/${hotelId}/rooms/${room102}/availability/${block.body.id}`)
      .set(as(MODERATOR, 'HOTEL_MODERATOR'))
      .expect(200);

    await http
      .post('/api/hotel-bookings')
      .set(as(GUEST))
      .send({
        hotelId,
        checkIn: blockIn,
        checkOut: isoDate(32),
        rooms: [{ roomId: room102, guests: [{ firstName: 'Unblocked', lastName: 'Guest' }] }],
      })
      .expect(201);
  });

  it('expires an unpaid hold and releases its nights', async () => {
    const holdIn = isoDate(40);
    const holdOut = isoDate(42);

    const hold = await http
      .post('/api/hotel-bookings')
      .set(as(GUEST))
      .send({
        hotelId,
        checkIn: holdIn,
        checkOut: holdOut,
        rooms: [{ roomId: room102, guests: [{ firstName: 'Late', lastName: 'Payer' }] }],
      })
      .expect(201);

    await bookingModel.updateOne(
      { _id: hold.body.id },
      { $set: { holdExpiresAt: new Date(Date.now() - 60_000) } },
    );

    const maintenance = await http
      .post('/api/hotel-bookings/maintenance/run')
      .set(internal())
      .expect(200);
    expect(maintenance.body.expiredHolds).toBeGreaterThanOrEqual(1);

    const expired = await http
      .get(`/api/hotel-bookings/${hold.body.id}`)
      .set(as(GUEST))
      .expect(200);
    expect(expired.body.status).toBe(HotelBookingStatus.EXPIRED);

    const available = await http
      .get(`/api/hotels/${hotelId}/rooms/available`)
      .query({ checkIn: holdIn, checkOut: holdOut })
      .expect(200);
    expect(available.body.rooms.map((room: { id: string }) => room.id)).toContain(room102);
  });

  it('reviews a completed stay once, recalculates the average, and supports replies', async () => {
    const completed = await http
      .post('/api/hotel-bookings')
      .set(as(GUEST_TWO))
      .send({
        hotelId,
        checkIn: isoDate(20),
        checkOut: isoDate(22),
        rooms: [{ roomId: room101, guests: [{ firstName: 'Review', lastName: 'Guest' }] }],
      })
      .expect(201);

    await http
      .post(`/api/hotel-bookings/${completed.body.id}/accept-policies`)
      .set(as(GUEST_TWO))
      .expect(200);
    await http
      .post(`/api/hotel-bookings/${completed.body.id}/confirm`)
      .set(internal())
      .send({ paymentId: 'pi_e2e_review' })
      .expect(200);

    await bookingModel.updateOne(
      { _id: completed.body.id },
      { $set: { status: HotelBookingStatus.COMPLETED, completedAt: new Date() } },
    );

    const review = await http
      .post(`/api/hotel-bookings/${completed.body.id}/review`)
      .set(as(GUEST_TWO))
      .send({ rating: 5, title: 'Excellent', comment: 'A wonderful stay with a great view.' })
      .expect(201);

    expect(review.body.rating).toBe(5);
    expect(review.body.bookingId).toBe(completed.body.id);

    await http
      .post(`/api/hotel-bookings/${completed.body.id}/review`)
      .set(as(GUEST_TWO))
      .send({ rating: 1, comment: 'Trying to review the same reservation twice.' })
      .expect(409);

    let hotel = await http.get(`/api/hotels/${hotelId}`).expect(200);
    expect(hotel.body.averageRating).toBe(5);
    expect(hotel.body.reviewCount).toBe(1);

    await http
      .patch(`/api/reviews/${review.body.id}`)
      .set(as(GUEST_TWO))
      .send({ rating: 4 })
      .expect(200);

    hotel = await http.get(`/api/hotels/${hotelId}`).expect(200);
    expect(hotel.body.averageRating).toBe(4);

    const reply = await http
      .post(`/api/reviews/${review.body.id}/reply`)
      .set(as(MODERATOR, 'HOTEL_MODERATOR'))
      .send({ body: 'Thank you for staying with us.' })
      .expect(201);
    expect(reply.body.moderatorReply.body).toBe('Thank you for staying with us.');

    const publicList = await http.get(`/api/hotels/${hotelId}/reviews`).expect(200);
    expect(publicList.body.total).toBe(1);
  });

  it('hides a review as an administrator and excludes it from the average', async () => {
    const stored = await hotelModel.findById(hotelId).exec();
    const reviews = await http.get(`/api/hotels/${hotelId}/reviews`).expect(200);
    const reviewId = reviews.body.items[0].id;
    expect(stored?.reviewCount).toBe(1);

    await http
      .patch(`/api/reviews/${reviewId}/visibility`)
      .set(as(ADMIN, 'ADMIN'))
      .send({ hidden: true, reason: 'Policy violation' })
      .expect(200);

    const hotel = await http.get(`/api/hotels/${hotelId}`).expect(200);
    expect(hotel.body.averageRating).toBe(0);
    expect(hotel.body.reviewCount).toBe(0);

    const publicList = await http.get(`/api/hotels/${hotelId}/reviews`).expect(200);
    expect(publicList.body.total).toBe(0);
  });

  it('completes past confirmed stays through the maintenance job', async () => {
    const upcoming = await http
      .post('/api/hotel-bookings')
      .set(as(GUEST))
      .send({
        hotelId,
        checkIn: isoDate(60),
        checkOut: isoDate(62),
        rooms: [{ roomId: room102, guests: [{ firstName: 'Past', lastName: 'Guest' }] }],
      })
      .expect(201);

    await http
      .post(`/api/hotel-bookings/${upcoming.body.id}/accept-policies`)
      .set(as(GUEST))
      .expect(200);
    await http
      .post(`/api/hotel-bookings/${upcoming.body.id}/confirm`)
      .set(internal())
      .send({ paymentId: 'pi_e2e_complete' })
      .expect(200);

    // Simulate the stay having ended: the completion job only moves CONFIRMED
    // reservations whose check-out date is already behind us.
    await bookingModel.updateOne(
      { _id: upcoming.body.id },
      {
        $set: {
          status: HotelBookingStatus.CONFIRMED,
          checkIn: isoDate(-5),
          checkOut: isoDate(-3),
          holdExpiresAt: null,
        },
      },
    );

    const maintenance = await http
      .post('/api/hotel-bookings/maintenance/run')
      .set(internal())
      .expect(200);
    expect(maintenance.body.completedStays).toBeGreaterThanOrEqual(1);

    const completed = await http
      .get(`/api/hotel-bookings/${upcoming.body.id}`)
      .set(as(GUEST))
      .expect(200);
    expect(completed.body.status).toBe(HotelBookingStatus.COMPLETED);
    expect(completed.body.canReview).toBe(true);
  });

  it('keeps the room and booking collections internally consistent', async () => {
    const profile = await http.get(`/api/hotels/${hotelId}`).expect(200);
    expect(profile.body.rooms).toHaveLength(2);
    expect(await roomModel.countDocuments({ hotelId })).toBe(2);
    expect(await bookingModel.countDocuments({ hotelId })).toBeGreaterThanOrEqual(4);
  });
});
