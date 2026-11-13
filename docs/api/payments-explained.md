# Payments explained: study guide

For: Fares (Member 4), to prepare for the evaluation discussion.
Requirements: PAY-01 (payment), PAY-02 (policies), PAY-03 (refunds), PAY-04 (one currency), GEN-11 (booking lifecycle).

---

## 1. The payment flow as a story

1. **The user books.** The flight or hotel module creates a booking with status `PendingPayment` and `holdExpiresAt = now + 10 minutes` (FLT-22 / HTL-18). Seats or rooms are held.
2. **The user reads the policies.** `GET /api/bookings/flight/:id/policies` returns the airline's cancellation tiers and baggage rules (a hotel returns tiers plus check-in and check-out times).
3. **The user accepts.** `POST /api/bookings/flight/:id/accept-policies` with `{ "accepted": true }`. We store `policiesAcceptedAt` and a **snapshot** copy of the policies on the booking.
4. **The user starts paying.** `POST /api/payments` with `{ bookingType, bookingId }`. We check the booking: it's yours, it's `PendingPayment`, the hold is still active, policies are accepted, the currency is right, and it isn't paid yet. Then we ask Stripe to create a **PaymentIntent** for the amount stored in the database. We save a `Payment` record (status `Pending`) and return the `clientSecret`.
5. **The browser pays.** The frontend gives the `clientSecret` to Stripe Elements. The card number goes **straight from the browser to Stripe**. In Swagger there's no card form, so `POST /api/dev/payments/:id/confirm` with `pm_card_visa` (a Stripe test token) does the same thing.
6. **Stripe tells us the result.** Stripe sends a signed `payment_intent.succeeded` event to `POST /api/payments/webhook`. We verify the signature, mark the payment `Succeeded`, and move the booking `PendingPayment → Confirmed`. Only now is the booking confirmed. A `payment.succeeded` event is emitted, so the booking module can make the e-ticket or reference and notify the user.
7. **If the card is declined.** Stripe sends `payment_intent.payment_failed`. The payment becomes `Failed` with a short message, and the booking stays `PendingPayment`. The user calls `POST /api/payments/:id/retry` and tries again while the hold lasts.
8. **If time runs out.** The expiry job moves the booking to `Expired`, releases the seats and calls `cancelForExpiredBooking`, which cancels the PaymentIntent at Stripe so it can't be paid any more.
9. **If the user cancels later.** The booking module sets `Cancelled`. Then `issueRefund` calculates the refund from the **snapshot** tiers and sends it through the Stripe Refunds API. The status (`Pending`, `Refunded` or `Failed`) is shown on the booking, and the user gets an in-app notification. `GET /api/refunds/:id` shows it.

---

## 2. What each file does

### `backend/src/common/booking/` (shared with the whole team)
| File | What it does |
|---|---|
| `booking-status.enum.ts` | The 5 statuses of GEN-11 |
| `booking-type.enum.ts` | `flight` / `hotel` |
| `booking-transitions.ts` | The table of allowed status changes; `assertTransition`, `allowedFromStatuses` |
| `platform-currency.ts` | Reads `PLATFORM_CURRENCY`, rejects other currencies (PAY-04) |
| `money.ts` | Converts between dollars and cents; percentage of an amount, in whole cents |
| `booking-hold.ts` | Reads the 10-minute hold duration |

### `backend/src/payments/`
| File | What it does |
|---|---|
| `gateway/booking-gateway.interface.ts` | The contract the flight and hotel modules implement |
| `gateway/booking-gateway.registry.ts` | Finds the right gateway for `flight` or `hotel`; 503 if not wired yet |
| `gateway/notification.port.ts` | How we send in-app notifications (logger for now) |
| `stripe/stripe.provider.ts` | Creates the Stripe client; refuses live keys |
| `stripe/stripe.service.ts` | Small wrapper around Stripe calls (create, retrieve, cancel, refund, verify webhook) |
| `schemas/payment.schema.ts` | `payments` collection + indexes |
| `schemas/refund.schema.ts` | `refunds` collection + indexes |
| `schemas/processed-event.schema.ts` | Webhook event ids already handled (duplicate protection) |
| `refund-calculator.ts` | Pure functions: days remaining, tier selection, refund amount |
| `booking-access.ts` | Shared checks: owner (404), PendingPayment (409), hold active (410) |
| `payments.service.ts` | Create, retry, get, cancel on expiry, dev confirm |
| `payments.controller.ts` | `POST /api/payments`, `POST /api/payments/:id/retry`, `GET /api/payments/:id` |
| `refunds.service.ts` | Preview, issue, sync status from Stripe, find by booking |
| `refunds.controller.ts` | `GET /api/refunds/:id` |
| `webhook.service.ts` | Signature check, run-once logic, the event handlers |
| `webhook.controller.ts` | `POST /api/payments/webhook` |
| `dev-payments.controller.ts` / `dev-payments.module.ts` | Dev-only confirm endpoint for Swagger demos |
| `events.ts` | Names and payloads of domain events |
| `auth/*` | Temporary login check until the auth module is merged |
| `payments.config.ts` | `/api` prefix, dev-flag helpers |
| `swagger.ts` | Helper to document error responses |
| `__tests__/*` | Unit tests, fake gateway, fake Stripe, fake Mongo model |

### `backend/src/policies/`
| File | What it does |
|---|---|
| `policies.service.ts` | Get policies (live, or the snapshot once accepted), accept (stores timestamp + snapshot) |
| `policies.controller.ts` | `GET /api/bookings/:type/:id/policies`, `POST /api/bookings/:type/:id/accept-policies` |

---

## 3. Discussion questions: short answers

**Why is the booking confirmed only by the webhook?**
The client can't be trusted: it could fake a "payment done" request or close the tab mid-payment. The webhook comes from Stripe and is signed with a secret only Stripe and our server know, so it's real proof the money was taken.
→ `webhook.service.ts`, `onPaymentSucceeded()`; the dev endpoint (`payments.service.ts`, `devConfirm()`) deliberately does **not** confirm the booking.

**How does signature verification work, and why does it need the raw body?**
Stripe computes an HMAC-SHA256 of `timestamp + "." + exact request body` using the webhook secret (`whsec_...`) and puts it in the `stripe-signature` header. We compute the same HMAC and compare. The timestamp also blocks old, replayed requests. It needs the **raw bytes**: if Express parses the JSON and we turn it back into a string, spaces or key order can change, and the HMAC no longer matches.
→ `main.ts` (`rawBody: true`), `webhook.controller.ts` (`req.rawBody`), `stripe.service.ts`, `constructWebhookEvent()`.

**How are duplicate webhooks prevented?**
Stripe may send the same event more than once. Before handling an event, we insert its id into `processed_stripe_events`, which has a **unique index** on `eventId`. A second insert fails with error 11000, and we just answer 200. If our handler crashes, we delete the row and return 500, so Stripe retries later.
→ `webhook.service.ts`, `process()`; `processed-event.schema.ts`.

**How are double payments prevented?**
Four layers:
- (a) An open PaymentIntent is reused instead of creating a new one.
- (b) Stripe idempotency keys (`pi:type:bookingId:attempt`) make two parallel requests get the same PaymentIntent.
- (c) We refuse to pay a booking that already has a Succeeded payment (409).
- (d) A **partial unique index** in MongoDB allows only one `Succeeded` payment per booking. If a second charge still succeeds somehow, the webhook refunds it automatically.

→ `payments.service.ts`, `createPayment()` / `startNewPaymentIntent()`; `payment.schema.ts` (`one_succeeded_payment_per_booking`); `webhook.service.ts`, `refundDuplicateCharge()`.

**What happens if payment succeeds after the hold expired?**
The seats were already released, so we can't confirm. `gateway.confirm()` only changes `PendingPayment → Confirmed`, so it returns `false` for an `Expired` booking. The webhook then issues a **100% refund** with reason `LatePayment` and emits `payment.late_refunded`. The expiry job also cancels open PaymentIntents, so this case is rare.
→ `webhook.service.ts`, `onPaymentSucceeded()`; `payments.service.ts`, `cancelForExpiredBooking()`.

**What is the tier rule, and what are "days remaining"?**
Each tier is (`daysBefore`, `refundPercent`). We pick the tier with the **highest `daysBefore` that is still ≤ days remaining**. If none fits, the refund is 0%. Example with tiers 30→100%, 7→50%, 0→0%: 40 days → 100%, 29 → 50%, 6 → 0%.
Days remaining: flights count **full 24-hour periods** until departure (6 days 23 hours = 6, never rounded up). Hotels count **calendar days** until the check-in date (stays have no time of day). Provider cancellations (FLT-06) and late payments are always 100%.
→ `refund-calculator.ts`, `daysRemaining()`, `selectRefundPercent()`, `calculateRefund()`.

**Why do refunds use the policy snapshot?**
The user agreed to specific rules when paying. If the moderator later changes "50% refund" to "0% refund", that must not affect people who already booked. So we store a copy of the policies when they're accepted, and refunds read that copy.
→ `policies.service.ts`, `acceptPolicies()`; `refunds.service.ts`, `resolveTiers()`.

**Why are amounts stored in cents?**
Computers store decimals like 0.1 inaccurately (`0.1 + 0.2 = 0.30000000000000004`). Money math on whole numbers of cents is exact. Stripe also expects amounts in the smallest unit (cents).
→ `common/booking/money.ts`; the `amount` fields in `payment.schema.ts` and `refund.schema.ts`.

**Why one platform currency?**
PAY-04 requires it. One currency means prices, payments and refunds always match, with no exchange-rate differences between paying and refunding. Currency conversion exists only for itinerary budgets (ITN-18) and never touches bookings.
→ `common/booking/platform-currency.ts`; check 5 in `payments.service.ts`, `assertPayable()`.

**Why does card data never reach our server?**
The browser sends the card straight to Stripe (Stripe Elements). We only create PaymentIntents and read their status. That keeps us out of PCI card-data rules and means a leak of our database can't expose cards. We store only the Stripe payment id, amount, currency and status (PAY-01). The `clientSecret` is returned to the user but never saved.
→ `stripe.service.ts` (no card fields anywhere); `payment.schema.ts`.

**Why return 404 instead of 403 for someone else's booking?**
403 would confirm that the booking exists. 404 reveals nothing.
→ `booking-access.ts`, `loadOwnedBooking()`.

---

## 4. Demo in Swagger (after Part 2 wires real bookings)

1. In a terminal: `stripe listen --forward-to localhost:3000/api/payments/webhook`
2. `GET /api/bookings/flight/{id}/policies` → `POST .../accept-policies` with `{ "accepted": true }`
3. `POST /api/payments` with `{ "bookingType": "flight", "bookingId": "{id}" }` → copy `paymentId`
4. `POST /api/dev/payments/{paymentId}/confirm` with `{ "testPaymentMethod": "pm_card_visa" }`
5. `GET /api/payments/{paymentId}` → `Succeeded`; the booking is now `Confirmed`
6. Failure demo: use `pm_card_chargeDeclined` in step 4 → payment `Failed` → `POST /api/payments/{paymentId}/retry` → confirm again with `pm_card_visa`

Until auth is merged, add the header `x-dev-user-id: <user ObjectId>` (dev mode only).
