# Hotels module — Member 3

NestJS + MongoDB backend module for the **Travel Planning and Booking Platform**, Milestone 1.
It implements hotel profiles, individually bookable rooms, availability blocks, the availability
calendar, concurrency-safe multi-room reservations with 10-minute holds, cancellation policies,
reservation history, automatic completion, and hotel reviews.

Everything that belongs to another member (authentication, Stripe, notifications, the team's
`AppModule`) is represented by a small, replaceable port or a development guard. See
[`INTEGRATION.md`](./INTEGRATION.md).

---

## 1. What is included

| Area | Requirements | Implemented in |
| --- | --- | --- |
| Hotel profile, images, amenities, star rating | HTL-01, HTL-02 | `hotels.service.ts`, `hotel.schema.ts` |
| Individually bookable rooms, occupancy, beds, prices | HTL-03, HTL-05 | `rooms.service.ts`, `room.schema.ts` |
| Moderator blocked date ranges | HTL-04, HTL-06 | `rooms.service.ts`, `room-availability.schema.ts` |
| Availability calendar (available / blocked / held / booked) | HTL-08 | `availability.service.ts`, `rooms.service.ts` |
| Check-in/out rules and cancellation tiers | HTL-09, HTL-10 | `hotel.schema.ts`, `refund-policy.util.ts` |
| Search by destination, dates, guests, rooms + filters/sort/pagination | HTL-11, HTL-12 | `hotels.service.ts` |
| Rooms available for the whole stay | HTL-15 | `rooms.service.ts` |
| Atomic 10-minute hold, one or more rooms, all-or-nothing | HTL-16, HTL-18 | `hotel-bookings.service.ts`, `availability.service.ts` |
| Payment-verified confirmation | HTL-19 (PAY integration) | `hotel-bookings.service.ts` |
| Reservation history and details | HTL-20 | `hotel-bookings.service.ts` |
| Cancellation with tiered refunds | HTL-21 (PAY integration) | `hotel-bookings.service.ts`, `refund-policy.util.ts` |
| Automatic `COMPLETED` after check-out, moderator reservation list | HTL-22 | `hotel-bookings.service.ts` |
| One review per completed reservation, edit/delete, average rating | HTL-23, HTL-24 | `reviews.service.ts`, `review.schema.ts` |
| Optional hotel reply to a review | HTL-26 (bonus) | `reviews.service.ts` |

Conventions that apply to the whole module:

- **Money** is stored and returned as **integer minor units** (cents) named `...Cents`. The single
  platform currency comes from `PLATFORM_CURRENCY` (fallback `USD`).
- **Stay dates** are `YYYY-MM-DD` calendar strings. Check-out is exclusive: a stay
  `2026-12-01 → 2026-12-03` occupies the nights `2026-12-01` and `2026-12-02`.
- **Pagination** defaults to page size **10** (`GEN-05`), max 50.
- Every list returns `{ items, page, limit, total, totalPages }`; empty results return
  `items: []` and `total: 0`, never `null`.
- Responses expose `id`, never `_id`, and never leak Mongoose internals.

---

## 2. Quick start (standalone sandbox)

Requirements: Node.js 20+, npm, and a MongoDB **replica set** (MongoDB Atlas is a replica set by
default). Transactions are required and will not work on a standalone `mongod`.

```bash
cd member3-hotels
npm install

# Windows PowerShell: use npm.cmd if npm.ps1 is blocked by the execution policy
copy .env.example .env
# edit .env and set MONGODB_URI

npm run seed:demo      # optional: two demo hotels, five rooms, demo ids
npm run start:dev      # http://localhost:3000/docs
```

Swagger UI: `http://localhost:3000/docs` · OpenAPI JSON: `http://localhost:3000/docs-json`
Health check: `GET /api/health`

### Sandbox authentication

`AUTH_DEV_MODE=true` enables the development guard. Send:

```
x-user-id:   24-hex MongoDB ObjectId
x-user-role: USER | HOTEL_MODERATOR | ADMIN
```

Demo identifiers created by `npm run seed:demo`:

| Role | `x-user-id` | Manages |
| --- | --- | --- |
| Guest | `66a1b2c3d4e5f60718293a01` | — |
| Hotel moderator | `66a1b2c3d4e5f60718293a02` | Grand Nile Demo Hotel (Cairo) |
| Hotel moderator | `66a1b2c3d4e5f60718293a03` | Azure Bay Demo Resort (Alexandria) |
| Administrator | `66a1b2c3d4e5f60718293a04` | all hotels |

Set `AUTH_DEV_MODE=false` when Member 1's real session guard is merged; the module only relies on
`req.user = { id, role }`.

Internal endpoints (payment confirmation/refund/maintenance) accept
`x-internal-api-key: $INTERNAL_API_KEY` or an administrator.

---

## 3. API

Base URL in the sandbox: `http://localhost:3000`. All routes are also documented in Swagger with
request/response schemas.

### Hotels and rooms

| Method | Path | Access | Requirement |
| --- | --- | --- | --- |
| `POST` | `/api/hotels` | hotel moderator / admin | HTL-01 |
| `PATCH` | `/api/hotels/:id` | assigned moderator / admin | HTL-01 |
| `GET` | `/api/hotels/:id` | public (extra data for owner/admin) | HTL-02 |
| `GET` | `/api/hotels/search` | public | HTL-11, HTL-12 |
| `PUT` | `/api/hotels/:id/policies` | assigned moderator / admin | HTL-09, HTL-10 |
| `GET` | `/api/hotels/:id/availability` | public (extra data for owner/admin) | HTL-08 |
| `GET` | `/api/hotels/:id/reservations` | assigned moderator / admin | HTL-22 |
| `POST` | `/api/hotels/:id/rooms` | assigned moderator / admin | HTL-03 |
| `GET` | `/api/hotels/:id/rooms` | public | extra (room list) |
| `PATCH` | `/api/hotels/:id/rooms/:roomId` | assigned moderator / admin | HTL-05 |
| `DELETE` | `/api/hotels/:id/rooms/:roomId` | assigned moderator / admin | HTL-06 |
| `GET` | `/api/hotels/:id/rooms/available?checkIn&checkOut&guests` | public | HTL-15 |
| `GET` | `/api/hotels/:id/rooms/:roomId/availability` | assigned moderator / admin | HTL-04 |
| `POST` | `/api/hotels/:id/rooms/:roomId/availability` | assigned moderator / admin | HTL-04 |
| `PATCH` | `/api/hotels/:id/rooms/:roomId/availability/:blockId` | assigned moderator / admin | HTL-05, HTL-06 |
| `DELETE` | `/api/hotels/:id/rooms/:roomId/availability/:blockId` | assigned moderator / admin | HTL-06 |

### Reservations and reviews

| Method | Path | Access | Requirement |
| --- | --- | --- | --- |
| `POST` | `/api/hotel-bookings` | authenticated guest | HTL-16, HTL-18 |
| `GET` | `/api/hotel-bookings` | authenticated guest | HTL-20 |
| `GET` | `/api/hotel-bookings/:id` | guest / assigned moderator / admin | HTL-20 |
| `GET` | `/api/hotel-bookings/:id/cancellation-quote` | guest / admin | HTL-21 |
| `POST` | `/api/hotel-bookings/:id/accept-policies` | guest | PAY-02 support |
| `POST` | `/api/hotel-bookings/:id/cancel` | guest / admin | HTL-21 |
| `POST` | `/api/hotel-bookings/:id/review` | guest of a completed stay | HTL-23 |
| `PATCH` | `/api/reviews/:id` | review author | HTL-23 |
| `DELETE` | `/api/reviews/:id` | review author / admin | HTL-23 |
| `GET` | `/api/hotels/:id/reviews` | public | HTL-24 |
| `POST` | `/api/reviews/:id/reply` | assigned moderator / admin | HTL-26 (bonus) |
| `PATCH` | `/api/reviews/:id/visibility` | admin | Member 6 moderation |

Internal (Member 4 or administrator):

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/hotel-bookings/:id/payment-intent` | Record the Stripe PaymentIntent id |
| `POST` | `/api/hotel-bookings/:id/confirm` | Confirm after payment verification (idempotent) |
| `PATCH` | `/api/hotel-bookings/:id/refund` | Update refund status from Stripe (`PENDING/REFUNDED/FAILED`) |
| `POST` | `/api/hotel-bookings/maintenance/run` | Run hold expiry, stay completion and lock cleanup now |

These extra endpoints exist because Member 3 owns the hotel inventory and booking state, while
Member 4 owns Stripe. They are documented in Swagger and are safe to keep behind the internal key.

---

## 4. Booking lifecycle

```
POST /api/hotel-bookings
        │  transaction: insert booking + one lock per room per night
        ▼
      HELD  ── 10 minutes ──► EXPIRED  (locks released, PaymentIntent cancelled)
        │
        │ POST accept-policies        (PAY-02)
        │ POST confirm                (after Stripe verification)
        ▼
   CONFIRMED ── check-out date passed ──► COMPLETED ──► review (once)
        │
        │ POST cancel (guest/admin) or cancelByProvider()
        ▼
   CANCELLED  (tiered refund; refund status updated by Member 4)
```

**No double booking.** `room_night_locks` has a unique index on `{ roomId, date }`. Two concurrent
requests can both pass the availability read, but only one can insert the night lock. The losing
transaction is rolled back, so a multi-room reservation is all-or-nothing (HTL-16/HTL-18).
Moderator blocks use the same collection (`kind=BLOCK`) so “block dates” and “book dates” are
mutually exclusive too.

**Price snapshot.** Each booked room stores its nightly price and the booking stores the policy
snapshot (check-in/out times and cancellation tiers) at creation time. Later edits to a room price
or hotel policy never change an existing reservation or refund.

**Cancellation tiers.** Tiers are sorted by `minDaysBeforeCheckIn` descending; the first tier whose
threshold is met applies. A `0`-day tier is mandatory. The refund percentage is applied to the
reservation total and stored as an integer amount in minor units.

**Completed stays.** A cron job runs every hour (and immediately through the maintenance endpoint)
and moves `CONFIRMED` reservations whose `checkOut` is before today to `COMPLETED`. Only then does
`canReview` become true.

---

## 5. Example flow (curl)

```bash
# 1. Create a hotel as the Cairo moderator
curl -X POST http://localhost:3000/api/hotels \
  -H "Content-Type: application/json" \
  -H "x-user-id: 66a1b2c3d4e5f60718293a02" \
  -H "x-user-role: HOTEL_MODERATOR" \
  -d '{"name":"Nile View","description":"A small hotel used to test the module end to end.","location":{"city":"Cairo","country":"Egypt","address":"12 Corniche El Nil"},"starRating":4}'

# 2. Add a room (price in cents)
curl -X POST http://localhost:3000/api/hotels/<hotelId>/rooms \
  -H "Content-Type: application/json" \
  -H "x-user-id: 66a1b2c3d4e5f60718293a02" \
  -H "x-user-role: HOTEL_MODERATOR" \
  -d '{"roomNumber":"101","name":"Double","bedType":"queen","bedCount":1,"maxAdults":2,"maxChildren":1,"basePricePerNightCents":12000}'

# 3. Hold the room for two nights as a guest
curl -X POST http://localhost:3000/api/hotel-bookings \
  -H "Content-Type: application/json" \
  -H "x-user-id: 66a1b2c3d4e5f60718293a01" \
  -H "x-user-role: USER" \
  -d '{"hotelId":"<hotelId>","checkIn":"2026-12-01","checkOut":"2026-12-03","rooms":[{"roomId":"<roomId>","guests":[{"firstName":"Mona","lastName":"Ali"}]}]}'

# 4. Accept policies (needed before confirmation by default)
curl -X POST http://localhost:3000/api/hotel-bookings/<bookingId>/accept-policies \
  -H "x-user-id: 66a1b2c3d4e5f60718293a01" -H "x-user-role: USER"

# 5. Member 4 confirms after Stripe verification
curl -X POST http://localhost:3000/api/hotel-bookings/<bookingId>/confirm \
  -H "Content-Type: application/json" \
  -H "x-internal-api-key: $INTERNAL_API_KEY" \
  -d '{"paymentId":"pi_test_123"}'
```

A complete automated version of this flow lives in `test/hotels.e2e-spec.ts`.

---

## 6. Tests

```bash
npm test          # unit tests (domain rules, dates, refund tiers)
npm run test:e2e  # full API lifecycle against an in-memory MongoDB replica set
npm run typecheck
npm run build
```

The e2e suite starts `mongodb-memory-server` (first run downloads a MongoDB binary), boots the real
Nest module, and verifies: hotel/room creation and permissions, search, multi-room atomic holds,
a two-guest race for the same room (`201` + `409`), policy acceptance, payment-verified
confirmation, cancellation quote/refund, blocked dates, hold expiry and lock release, automatic
completion of past stays, review eligibility, edit/reply/moderation and average-rating recalculation.

---

## 7. Project layout

```
src/
  hotels/                  ← the copyable module
    domain/                pure functions + unit tests (pricing, refunds, occupancy, room selection)
    dto/                   request DTOs and documented response DTOs
    integrations/          PaymentGatewayPort + NotificationPort and logging defaults
    mappers/               document → API response mappers
    schemas/               Mongoose schemas
    availability.service.ts
    hotel-bookings.service.ts
    hotels.service.ts
    reviews.service.ts
    rooms.service.ts
    hotels.module.ts
  shared/                  auth contract, pagination, date/money/object-id/transaction utilities
  sandbox/                 runnable demo AppModule, Swagger bootstrap, exception filter, seed
test/                      end-to-end lifecycle test + Jest config
```

`src/hotels` plus `src/shared` are what you copy into the team backend; `src/sandbox` is only for
running this module before the team `AppModule` exists.

---

## 8. Assumptions and boundaries

- Authentication, user profiles, Stripe, email notifications and the shared error envelope belong to
  other members. The module consumes `req.user`, a payment port and a notification port.
- Image upload/storage is not implemented; images are validated URLs supplied by the caller
  (`GEN-08` media service is Member 6's).
- Hotel moderators manage exactly one hotel. Administrator assignment/deactivation is enforced in
  the service (`isActive` and `moderatorId` are admin-only fields).
- Money is never converted; all prices must use `PLATFORM_CURRENCY`.
- Local MongoDB must be a replica set for transactions; MongoDB Atlas works as-is.
