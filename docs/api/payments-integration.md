# Payments integration guide (for Members 2 and 3)

From: Fares (Member 4: payments, policies, refunds)
Covers: PAY-01, PAY-02, PAY-03, PAY-04, GEN-11
Code: `backend/src/payments/`, `backend/src/policies/`, `backend/src/common/booking/`

This explains what your flight-booking (Member 2) and hotel-booking (Member 3) code needs so that payments and refunds work with it. The payments module never imports your code. It talks to bookings only through one small interface, `BookingGateway`.

---

## 1. Shared things to import

```ts
import {
  BookingStatus,        // PendingPayment | Confirmed | Completed | Expired | Cancelled
  BookingType,          // 'flight' | 'hotel'
  assertTransition,     // throws 409 for a transition GEN-11 does not allow
  allowedFromStatuses,  // use inside conditional DB updates
  getPlatformCurrency,  // reads PLATFORM_CURRENCY (default 'usd')
  getBookingHoldMinutes,// reads BOOKING_HOLD_MINUTES (default 10, FLT-22 / HTL-18)
} from '../common/booking';
```

Allowed transitions (GEN-11). Nothing else is allowed:

| From | To |
|---|---|
| PendingPayment | Confirmed (payment succeeded), Expired (10-minute hold timed out) |
| Confirmed | Completed, Cancelled (by the user or the provider) |

Please use `BookingStatus` for your `status` field instead of making your own enum, so we all use the same names.

---

## 2. Fields your booking schema needs

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId | owner |
| `status` | `BookingStatus` | starts as `PendingPayment` |
| `totalAmount` | number | **major units** in the platform currency (e.g. `250.5`) |
| `currency` | string | `getPlatformCurrency(config)`, e.g. `'usd'` (PAY-04) |
| `holdExpiresAt` | Date | `now + getBookingHoldMinutes(config)` minutes |
| `policiesAcceptedAt` | Date \| null | set by my code through the gateway (PAY-02) |
| `policySnapshot` | `Mixed` | the exact policies the user accepted (set by my code) |
| start time | Date | flight: **outbound** departure (UTC instant); hotel: check-in date (UTC midnight) |
| `reference` | string \| null | booking reference |

Why `policySnapshot`: refunds must use the cancellation tiers the user agreed to, even if the moderator edits them later.

---

## 3. The `BookingGateway` you implement (or that I write in Part 2 using your services)

File: `backend/src/payments/gateway/booking-gateway.interface.ts`

```ts
export interface BookingGateway {
  readonly type: BookingType;
  findById(bookingId: string): Promise<PayableBooking | null>;
  getProviderPolicies(bookingId: string): Promise<ProviderPolicies>;
  savePolicyAcceptance(bookingId: string, snapshot: ProviderPolicies, acceptedAt: Date): Promise<void>;
  confirm(bookingId: string): Promise<boolean>; // ONLY PendingPayment -> Confirmed
  expire(bookingId: string): Promise<boolean>;  // ONLY PendingPayment -> Expired, releases inventory
}
```

`ProviderPolicies` looks like this:

- Flight: `{ kind: 'flight', cancellationTiers: [{ daysBefore, refundPercent }], baggage: { freeBagsPerPassenger, maxWeightKgPerBag, extraBagPrice, maxExtraBagsPerPassenger } }`
- Hotel: `{ kind: 'hotel', cancellationTiers: [...], checkInTime: 'HH:mm', checkOutTime: 'HH:mm' }`

### `confirm` and `expire` MUST be conditional updates

The webhook and the expiry job can run at the same moment. Only a conditional update is safe:

```ts
async confirm(id: string): Promise<boolean> {
  const res = await this.bookingModel.findOneAndUpdate(
    { _id: id, status: BookingStatus.PendingPayment },
    { $set: { status: BookingStatus.Confirmed, reference: generateRef() /* + e-ticket for flights */ } },
    { returnDocument: 'after' },
  );
  return res !== null; // false = it was not PendingPayment anymore (for example already Expired)
}
```

`expire` works the same way (`PendingPayment` → `Expired`). Release the seats or rooms **only if** the update matched, so inventory is never released twice.

When `confirm` returns `false` because the booking already expired, my webhook refunds the payment 100% (a late payment). You don't need to handle that case.

### Registering the gateway

```ts
@Injectable()
export class FlightBookingGateway implements BookingGateway, OnModuleInit {
  readonly type = BookingType.Flight;
  constructor(private readonly registry: BookingGatewayRegistry /* , your model/service */) {}
  onModuleInit() { this.registry.register(this); }
  // ...the methods above
}
```

Import `PaymentsModule` in your module to get `BookingGatewayRegistry`. Until a gateway is registered, my endpoints return **503 "Booking type not wired yet"** for that type. That's expected.

---

## 4. Cancelling a booking (FLT-26, HTL-21, FLT-06)

Inject `RefundsService` (exported by `PaymentsModule`).

1. **Before** the user confirms the cancellation, show the amount:
   ```ts
   const preview = await refundsService.previewRefund(type, bookingId, userId);
   // { percent, amount, currency, daysRemaining, cancellable, message? }
   // cancellable = false after departure (flight) or on/after the check-in date (hotel)
   ```
2. Set the booking status to `Cancelled` with a conditional update (`{ _id, status: 'Confirmed' }`) and release inventory.
3. **After** that, issue the refund:
   ```ts
   const refund = await refundsService.issueRefund(type, bookingId, RefundReason.UserCancellation);
   // RefundReason.ProviderCancellation for FLT-06 (airline cancels the flight) -> always 100%
   // returns null when the refund amount is 0
   ```
   `issueRefund` **does not throw if Stripe fails**. It saves the refund as `Failed` and notifies the user, so your cancellation still succeeds. It does throw 409 if the booking is not `Cancelled` yet or was never paid. Calling it twice is safe (it returns the same refund).

For booking details (PAY-03: show the refund status), use `refundsService.findLatestByBooking(type, bookingId)`.

The frontend can also read it directly: `GET /api/bookings/:type/:id/refund` returns the latest refund of the booking (amount, percent, reason, status `Pending` / `Refunded` / `Failed`). Only the booking owner or an admin can read it; anyone else, or a booking without a refund, gets 404.

Round trips (FLT-12a) are one booking: pass the **outbound** departure as the start time.

---

## 5. Hold-expiry cron job (FLT-22, HTL-18)

When your job moves a booking to `Expired`, also cancel its Stripe PaymentIntents:

```ts
if (await gateway.expire(bookingId)) {
  await paymentsService.cancelForExpiredBooking(type, bookingId); // safe to call many times
}
```

If you don't call it, nothing breaks: `PaymentExpirySweeper` (in payments) runs every minute, finds open payments (`Pending` / `Failed`) whose booking is `Expired`, `Cancelled` or deleted, and cancels their PaymentIntents. Calling it yourself just cancels them right away instead of up to a minute later.

---

## 6. Events you can listen to

```ts
import { OnEvent } from '@nestjs/event-emitter';
import { PaymentEvents, PaymentSucceededEvent } from '../payments/events';

@OnEvent(PaymentEvents.Succeeded)
async onPaid(e: PaymentSucceededEvent) { /* e-ticket, "booking confirmed" notification, ... */ }
```

| Event | When |
|---|---|
| `payment.succeeded` | the booking was just moved to Confirmed |
| `payment.failed` | the card was declined; the booking stays PendingPayment and the user can retry |
| `payment.late_refunded` | the payment arrived after the hold expired; refunded 100% |
| `refund.created` | a refund was created (status Pending, Refunded or Failed) |
| `refund.status_changed` | Stripe reported a new refund status |

Amounts in event payloads are in **minor units** (cents).

---

## 7. Currency (PAY-04)

All flight and hotel prices, payments and refunds use **one platform currency** (`PLATFORM_CURRENCY`). Booking prices are **never converted**. The itinerary currency conversion (ITN-18, FXRatesAPI) is display-only and does not touch booking prices. If a booking's `currency` is not the platform currency, payment is rejected with 400.

---

## 8. Setup each member needs

`PaymentsModule` refuses to start without Stripe **test** keys. Add these to your `backend/.env` (ask Fares for the shared test keys, or create your own Stripe test account):

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PLATFORM_CURRENCY=usd
BOOKING_HOLD_MINUTES=10
ENABLE_DEV_PAYMENT_ENDPOINTS=true
```

A live key (`sk_live_...`) is refused on purpose.

---

## 9. Requests to the setup/auth owners

- **Auth:** done. Payments uses the auth module's global `JwtAuthGuard` (`req.user`), its `@CurrentUser()` and `@Public()` (Stripe webhook). Admin checks use `UserRole.ADMIN`.
- **`main.ts`:** I only added `rawBody: true` (needed for webhook signatures). The Swagger builder has no `.addCookieAuth()` yet, so `@ApiCookieAuth()` shows no lock icon. Please add `.addCookieAuth('access_token')`.
- **Global prefix:** there is no `app.setGlobalPrefix('api')`. My routes put `api/` in front through one constant (`API_PREFIX` in `payments.config.ts`). If a global prefix is added, tell me and I'll set it to `''`.
- **Lint:** `npm run lint` currently fails on `main.ts:45` (`bootstrap();` should be `void bootstrap();`). That line existed before my changes.
