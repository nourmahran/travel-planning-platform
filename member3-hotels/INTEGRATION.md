# Integration guide — Hotels module (Member 3)

This module is written to be dropped into the team backend without taking ownership of authentication,
payments, notifications or the team `AppModule`. This document lists the exact points of contact and
what to replace.

---

## 1. What to copy

| From this project | Into the team backend |
| --- | --- |
| `src/hotels/**` | `src/hotels/**` (keep the folder structure) |
| `src/shared/auth/**` | replace/merge with Member 1's auth; the contract below must survive |
| `src/shared/dto/pagination-query.dto.ts` | merge into the team's shared pagination (or keep) |
| `src/shared/utils/**` | merge into the team's shared utilities (names are unique) |
| `src/shared/constants.ts` | merge the hotel constants; do not duplicate `UserRole` if Member 1 already has one |
| `src/shared/pipes`, `src/shared/validation` | merge into the team's shared folder |
| `test/hotels.e2e-spec.ts` | optional: keep as the module's integration test |

Do **not** copy `src/sandbox` into the team app. It exists only to run this module standalone.

If the team uses different import aliases or a `src/modules/...` layout, update the relative imports in
`src/hotels/**`; everything inside the module is relative.

---

## 2. AppModule wiring (Member 2)

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { HotelsModule } from './hotels/hotels.module';

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI!),
    ScheduleModule.forRoot(), // exactly once in the whole app
    HotelsModule,
    // ...flights, payments, itineraries...
  ],
})
export class AppModule {}
```

`HotelsModule` registers its own schemas and controllers, and exports `HotelsService`,
`AvailabilityService`, `RoomsService`, `HotelBookingsService` and `ReviewsService` for other modules.
It has **no** dependency on `ConfigModule`: configuration is read lazily from `process.env` by
`src/shared/utils/env.util.ts`, so `.env` loading order does not matter.

### Global HTTP concerns

The sandbox applies these in `src/sandbox/main.ts`; the team `main.ts` should already have them:

- global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform`;
- the team's global exception filter (the module throws standard Nest `HttpException`s);
- Swagger document setup (the module's controllers are annotated with `@ApiOperation`, `@ApiTags`,
  `@ApiOkResponse`, etc.).

### Environment variables

| Variable | Required | Default | Owner / meaning |
| --- | --- | --- | --- |
| `MONGODB_URI` | yes | — | Member 1/2; must point to a replica set (Atlas is fine) |
| `PLATFORM_CURRENCY` | recommended | `USD` | Member 4 (PAY-18); all hotel prices use this currency |
| `AUTH_DEV_MODE` | sandbox only | `false` | Must be `false` in the team app |
| `INTERNAL_API_KEY` | recommended | empty | Shared secret for Member 4 → hotel internal endpoints |
| `HOTEL_HOLD_MINUTES` | no | `10` | Requirement fixes the hold at 10 minutes |
| `REQUIRE_POLICY_ACCEPTANCE` | no | `true` | Blocks confirmation until policies are accepted |
| `ENABLE_HOTEL_JOBS` | no | `true` | Enables hold-expiry/completion cron jobs |

---

## 3. Authentication (Member 1)

The module only needs this contract on each request:

```ts
interface AuthUser {
  id: string;                                  // 24-hex user ObjectId
  role: 'USER' | 'HOTEL_MODERATOR' | 'ADMIN';
  email?: string;
}
// available as req.user
```

Controllers use `@UseGuards(AuthGuard | OptionalAuthGuard | RolesGuard)` and
`@CurrentUser() user: AuthUser`. `RolesGuard` reads `@Roles(...)` metadata.

To integrate:

1. Replace the bodies of `src/shared/auth/auth.guard.ts` and `optional` with Member 1's session guard
   (httpOnly cookie / bearer token), keeping the class names and `req.user` assignment.
2. Keep `RolesGuard` or replace it with Member 1's role guard; the role names must match.
3. Delete or ignore `readDevUser` (`dev-auth.ts`) and set `AUTH_DEV_MODE=false`. The dev headers must
   never work in production.
4. `InternalApiKeyGuard` is separate: it accepts `x-internal-api-key: $INTERNAL_API_KEY` or an
   administrator session. Member 4 should call internal endpoints with the key, not a user session.

Authorization rules already enforced by the service layer:

- A hotel moderator can manage only the hotel where `hotel.moderatorId === user.id`.
- `isActive` and `moderatorId` are administrator-only fields.
- A guest can see only their own reservations; the assigned moderator and admins can also see them.
- Only the guest of a `COMPLETED` reservation can review it, once.
- A moderator can reply only to reviews of their assigned hotel.

---

## 4. Payments (Member 4)

The hotels module **never talks to Stripe**. It exposes two things: a port to call and internal
endpoints for payment state changes.

### 4.1 Bind the payment port

`src/hotels/integrations/payment-gateway.port.ts` defines:

```ts
interface PaymentGatewayPort {
  refundHotelBooking(request: HotelRefundRequest): Promise<HotelRefundResult>;
  cancelPaymentIntent(request: { paymentIntentId: string; bookingId: string }): Promise<void>;
}
```

Replace the default binding in `src/hotels/integrations/integrations.module.ts`:

```ts
@Module({
  imports: [PaymentsModule], // Member 4's module
  providers: [
    { provide: PAYMENT_GATEWAY, useExisting: PaymentsService },
    { provide: HOTEL_NOTIFICATION_SERVICE, useClass: NotificationsService }, // Member 6
  ],
  exports: [PAYMENT_GATEWAY, HOTEL_NOTIFICATION_SERVICE],
})
export class HotelIntegrationsModule {}
```

`PaymentsService` must implement the two methods (or provide an adapter class). The default
`LoggingPaymentGateway` returns `PENDING` and does not move money — replace it before demoing refunds.

### 4.2 Booking handshake

| Step | Who calls | Endpoint / method | Notes |
| --- | --- | --- | --- |
| 1. Create hold | Frontend → hotels | `POST /api/hotel-bookings` | Returns `HELD`, `holdExpiresAt`, `totalAmountCents`, `currency` |
| 2. Show summary and policies | Frontend → hotels | `GET /api/hotel-bookings/:id` | `policySnapshot` is immutable |
| 3. Accept policies | Frontend / Member 4 | `POST /api/hotel-bookings/:id/accept-policies` | Stores `policiesAcceptedAt` (PAY-02) |
| 4. Create PaymentIntent | Member 4 | — | Use `totalAmountCents` and `currency` from the booking |
| 5. Record PaymentIntent | Member 4 | `POST /api/hotel-bookings/:id/payment-intent` | Lets the expiry job cancel it if the hold lapses |
| 6. Stripe webhook verifies payment | Member 4 | `POST /api/hotel-bookings/:id/confirm` | Idempotent; requires policy acceptance; internal key |
| 7. Refund (if cancelled) | Member 4 | `refundHotelBooking(...)` via the port | Amount/percent already computed by hotels |
| 8. Refund webhook | Member 4 | `PATCH /api/hotel-bookings/:id/refund` | `PENDING` / `REFUNDED` / `FAILED` + provider id |

Important details:

- Confirmation fails with `409` if the 10-minute hold has expired. The booking then becomes `EXPIRED`
  and the locks are released; the guest must start a new booking.
- `POST /confirm` returns the booking and is idempotent for an already `CONFIRMED` booking.
- The cancellation response already contains `cancellation.refund.amountCents`,
  `refund.percent` and `refund.status`. Member 4 can read those instead of recomputing.
- Provider-initiated cancellations must use `HotelBookingsService.cancelByProvider(id, reason)` (or
  `POST /cancel` as an administrator), which forces a 100% refund (PAY-16).
- If Member 4 needs to refund outside a cancellation, it should use the amount returned by
  `GET /api/hotel-bookings/:id/cancellation-quote`.
- Never update `status` directly in MongoDB. Use the service/endpoints so locks and refunds stay
  consistent.

### 4.3 Suggested TypeScript interface in Member 4

```ts
// payments.service.ts
async refundHotelBooking(req: HotelRefundRequest): Promise<HotelRefundResult> {
  const refund = await this.stripe.refunds.create({
    payment_intent: req.paymentId ?? undefined,
    amount: req.amountCents,
    reason: 'requested_by_customer',
    metadata: { bookingId: req.bookingId, reference: req.bookingReference },
  });
  return { status: 'PENDING', providerRefundId: refund.id };
}
```

Then send the final status to `PATCH /api/hotel-bookings/:id/refund` when Stripe reports it.

---

## 5. Notifications (Member 6)

`NotificationPort.send()` receives:

```ts
{
  userId: string;
  type:
    | 'HOTEL_BOOKING_CONFIRMED'
    | 'HOTEL_BOOKING_CANCELLED'
    | 'HOTEL_BOOKING_EXPIRED'
    | 'HOTEL_STAY_COMPLETED'
    | 'HOTEL_REVIEW_RECEIVED';
  title: string;
  message: string;
  data?: Record<string, string>;
}
```

Replace `LoggingNotificationService` with Member 6's notification service, or map the call to the
team's notification API. Notification failures are caught and logged by the hotels module; they never
fail a booking or review.

### Review moderation

- `PATCH /api/reviews/:id/visibility` with `{ hidden: boolean, reason?: string }` (admin) hides or
  restores a review and recalculates the hotel average. Member 6 can call
  `ReviewsService.setVisibility()` directly from its report-resolution flow.
- `DELETE /api/reviews/:id` is a soft delete for the author/admin; the row stays so the reservation
  cannot be reviewed twice.

---

## 6. Administration (Member 1)

- `HotelBookingsService.searchAll(user, query)` implements ACC-17 booking inspection (admin only,
  filters by hotel/user/reference/status/date).
- `HotelsService.setProviderActive(id, active, user)` implements ACC-15 hotel deactivation. A
  deactivated hotel disappears from search and cannot be booked, while existing confirmed bookings
  remain valid.
- `HotelsService.assertCanManage()` and `canManage()` are exported helpers if Member 1 needs the same
  ownership rule in admin screens.

---

## 7. Database collections and indexes

The module creates these collections (names are fixed):

| Collection | Purpose | Key indexes |
| --- | --- | --- |
| `hotels` | profiles, policies, rating cache | unique `{ name, location.city, location.country }`, `location.city`, `moderatorId`, `averageRating` |
| `rooms` | physical rooms | unique `{ hotelId, roomNumber }`, `{ hotelId, isActive, basePricePerNightCents }` |
| `room_availability_blocks` | moderator blocked ranges | `{ roomId, startDate, endDate }`, `{ hotelId, startDate }` |
| `room_night_locks` | concurrency guard, one row per room/night | **unique `{ roomId, date }`**, `bookingId`, `sourceId`, `expiresAt` |
| `hotel_bookings` | reservations + guest lists + refunds | `reference` unique, `userId`, `hotelId`, `{ status, holdExpiresAt }` |
| `reviews` | one review per booking | `bookingId` unique, `{ hotelId, createdAt }`, `{ hotelId, rating }` |

Member 2 does not need to register these schemas anywhere else: `HotelsModule` does it. Index creation
is handled by Mongoose (`autoIndex`, enabled by default). On a shared Atlas cluster, indexes will be
created on first boot; if the team disables `autoIndex` in production, run `syncIndexes()` once during
deployment.

Do not create foreign-key constraints: references are plain `ObjectId`s and ownership is validated in
the services. This keeps the hotels module independent of the users module.

---

## 8. Transactions and local MongoDB

All multi-document writes use `runInTransaction()` (`src/shared/utils/transaction.util.ts`), which
requires a **replica set**. MongoDB Atlas is a replica set. If a developer runs a local `mongod`, start
it with `--replSet rs0` and run `rs.initiate()` once, or use the included
`mongodb-memory-server` e2e test.

If a transaction cannot start (standalone MongoDB), booking creation fails rather than risking a
double booking. This is intentional.

---

## 9. Background jobs

`HotelBookingsService` registers two cron jobs through `@nestjs/schedule`:

- every minute: expire stale holds and release their night locks (and cancel PaymentIntents);
- every hour: mark past `CONFIRMED` stays as `COMPLETED`, notify guests, and purge old locks.

`ScheduleModule.forRoot()` must be imported exactly once in the team `AppModule`. Set
`ENABLE_HOTEL_JOBS=false` to disable them (for example in tests) and use
`POST /api/hotel-bookings/maintenance/run` with the internal key instead.

---

## 10. Integration checklist

- [ ] `HotelsModule` imported in `AppModule`; `ScheduleModule.forRoot()` present once.
- [ ] `MONGODB_URI` points to a replica set and the database is reachable.
- [ ] Real auth guard assigns `req.user = { id, role }` and `AUTH_DEV_MODE=false`.
- [ ] `PAYMENT_GATEWAY` bound to Member 4's refund implementation.
- [ ] `HOTEL_NOTIFICATION_SERVICE` bound to Member 6's notifications (optional but recommended).
- [ ] `INTERNAL_API_KEY` set for Member 4 → hotels calls.
- [ ] `PLATFORM_CURRENCY` equals Member 4's currency.
- [ ] Team Swagger document includes the hotels controllers.
- [ ] `npm run typecheck`, `npm test`, `npm run test:e2e` pass in this project.
- [ ] Seed/demo data is not shipped to production; use the team's seed instead.

---

## 11. Known boundaries

- Image upload is not implemented: the API accepts validated URLs. Member 6's media service can
  upload first and pass the URL.
- There is no hotel deletion endpoint; administrators deactivate hotels (ACC-15), preserving booking
  history.
- Reviews are hotel-level only; there is no per-room review in the requirements.
- A guest may hold only as many reservations as the inventory allows; there is no per-user cap beyond
  the 10-minute expiry.
- Email/push delivery and Stripe calls are intentionally outside this module.
