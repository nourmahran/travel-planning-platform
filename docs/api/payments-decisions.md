# Payments: decisions log (Part 1)

Places where the repo differed from `CLAUDE-part1-independent.md`, or where the instructions left a choice open. Each entry says what I found, what I chose, and why.

## Repository and setup

1. **No NestJS app on `develop`.** Found: `develop` and `feature/PAY-01-payments-part1` only had the empty skeleton (`backend/frontend/docs/...`). The NestJS setup (config, Mongoose, Swagger, ValidationPipe, global error filter) was only on Nour's unmerged `feature/member2-backend-setup` branch. Chose: fast-forwarded my branch onto that setup commit (`be21a44`). My branch had no commits, so nothing was rewritten. Why: Part 1 can't be built or tested without a NestJS app, and redoing the setup would conflict with Nour's work. The PR diff will shrink once Nour's branch is merged into `develop`.
2. **Branch name.** Found: the branch already existed as `feature/PAY-01-payments-part1` (local and remote), not `feature/PAY-01-stripe-payments`. Chose: kept the existing branch.
3. **Folder layout.** Found: the repo CLAUDE.md suggests `src/modules/<feature>`, but no `modules/` folder exists yet, and the Part 1 file names the exact folders I own. Chose: `src/payments`, `src/policies`, `src/common/booking`, as listed in the Part 1 file. Why: those are the folders the team agreed I own, and other members import from those paths.
4. **`.env.example` location.** Found: Nour moved it to the repo root (`/.env.example`). There is no `backend/.env.example`. Chose: added my variable names to the existing root file, so there's one source.
5. **`docs/` folder.** Found: it didn't exist after the restructure. Chose: created `docs/api/` at the repo root (the location the repo CLAUDE.md describes).
6. **No global `/api` prefix.** Found: `main.ts` has no `setGlobalPrefix('api')`, and Swagger UI is served at `/api`. Chose: one constant `API_PREFIX = 'api'` in `payments.config.ts`, used by all my controllers, so the routes match the spec (`/api/payments`, ...). If a global prefix is added, set it to `''`.
7. **Lint baseline.** Found: `npm run lint` already failed on `main.ts:45` (`bootstrap();`, a floating promise) before my changes. My rules allow editing `main.ts` only for `rawBody`, so I didn't fix it. All my folders lint clean (`npx oxlint --type-aware src/common/booking src/payments src/policies`). Reported to the setup owner in the integration guide.
8. **Swagger cookie auth.** Found: `DocumentBuilder` has no `.addCookieAuth()`. Chose: still put `@ApiCookieAuth()` on authenticated routes, as the spec asks, and asked the setup owner to add `.addCookieAuth('access_token')`.

## Auth (not merged yet)

9. **Placeholder auth.** No auth module exists. Chose: `payments/auth/` contains `@CurrentUser()` and `PaymentsAuthGuard` (`TODO(part2)`). The guard accepts `req.user` set by a future JWT guard (`id`, `_id` or `sub`, plus `role`). **Dev only:** when `ENABLE_DEV_PAYMENT_ENDPOINTS=true` and `NODE_ENV !== 'production'`, it also accepts an `x-dev-user-id: <ObjectId>` header (and `x-dev-user-role: ADMIN`) so the routes can be tried in Swagger before auth exists. It's never active in production. Unit tests cover that. Remove it in Part 2. **Update (Part 2):** replaced by the auth module (ACC-04 / ACC-19). The global `JwtAuthGuard` sets `req.user`; payments uses its `@CurrentUser()`, the webhook uses its `@Public()`, admins are `UserRole.ADMIN` (`'admin'`). `PaymentsAuthGuard` and the `x-dev-user-id` header were removed.
10. **Webhook must stay public.** Marked with `SetMetadata('isPublic', true)`, the most common key for a `@Public()` decorator. Asked the auth owner to confirm the key.

## Payments (PAY-01)

11. **Signature of `assertPlatformCurrency`.** The spec shows one argument. Chose `assertPlatformCurrency(code, platformCurrency)`, because the helper can't know the configured currency otherwise.
12. **Zero-decimal currencies.** The money helpers assume 2 decimals (`* 100`). `getPlatformCurrency` rejects zero-decimal currencies (JPY, KRW, ...) instead of silently charging 100× too much.
13. **`toMinorUnits` rounding.** It uses `Math.round(Number((amount * 100).toFixed(6)))` instead of only `Math.round(amount * 100)`. Why: `1.005 * 100 = 100.49999…` in floating point, so plain rounding gives 100 cents instead of 101.
14. **Missing `holdExpiresAt`** on a PendingPayment booking is treated as expired (410). It fails safe.
15. **Idempotency key attempt number.** Chose `attempt = (number of Payment records for the booking) + 1`. Two parallel `POST /api/payments` requests compute the same key, so Stripe returns the same PaymentIntent. The second insert hits the unique index on `stripePaymentIntentId`, and we return the existing record. Covered by a test.
16. **Never replace a PaymentIntent that might be charging.** If the open PaymentIntent is `processing`, `requires_capture` or `succeeded`, create and retry return 409 "A payment for this booking is already being processed" instead of cancelling it.
17. **Dev confirm endpoint registration.** The controller list is decided when the app module loads, before `.env` is read. Chose: a dynamic `DevPaymentsModule.register()` that awaits `ConfigModule.envVariablesLoaded` and adds the controller only when enabled. A runtime guard (`DevPaymentsEnabledGuard`) returns 404 if it's ever reached while disabled. Starting with `NODE_ENV=production` and `ENABLE_DEV_PAYMENT_ENDPOINTS=true` throws at startup.
18. **Declined test cards in the dev endpoint.** Stripe throws a card error on decline. The dev endpoint returns 200 with the PaymentIntent status (`requires_payment_method`), and the `payment_intent.payment_failed` webhook marks the payment Failed. A decline is an expected test outcome, not a 502.
19. **Stripe API version.** Not pinned. The SDK default for `stripe@23.1.0` is used.

## Webhook

20. **Success redelivery after a crash.** The spec says to return early if the payment is already Succeeded. That would leave the booking PendingPayment forever if an earlier delivery crashed after marking the payment but before confirming the booking. Chose: always call the conditional `gateway.confirm()`. If it returns false, look at the booking: Confirmed, Completed or Cancelled means already done, so do nothing. Otherwise it's a late payment, so refund 100%. This stays idempotent. Covered by a test.
21. **Duplicate charge.** If a second PaymentIntent for an already-paid booking succeeds, the partial unique index refuses to mark it Succeeded. The webhook then refunds that charge in full directly through Stripe, marks the payment Cancelled and stores the Stripe refund id in `Payment.duplicateRefundId`. It isn't stored in `refunds`, because that collection allows one refund per booking (whole-booking cancellations).
22. **Order of work.** Task 10 (refunds) was built before Task 9 (webhook), because the webhook's late-payment path calls `RefundsService`. Task 11's events file was added with Task 8 because every service emits events.

## Refunds (PAY-03)

23. **Refund base amount.** The refund is computed on the amount that was **actually charged** (the Succeeded Payment's `amount`, in cents), not on `booking.totalAmount`. They are normally equal, and this way we can never refund more than was paid.
24. **Refund only after cancellation.** `issueRefund` throws 409 unless the booking is `Cancelled` (or `Expired`, for late payments). This matches "call issueRefund after setting status Cancelled" and prevents refunding a still-active booking.
25. **Status updates never go backwards.** A Refunded or Failed status is never overwritten by a later "pending" result. Updates are conditional on the status we read.
26. **Webhook before id saved.** Refunds are created with `metadata.refundId`. If Stripe's `refund.updated` arrives before we saved `stripeRefundId`, the record is found by that metadata id.
27. **Failed refunds are not retried automatically** in Part 1. They stay `Failed` with a message, and the user is notified. A retry job or admin action could be added in Part 2 if the team wants one.
28. **`previewRefund` and departure.** For user cancellations, `cancellable=false` when `startsAt <= now`. For a hotel, `startsAt` is check-in at UTC midnight, so cancelling is allowed until the day before check-in (HTL-21 "before check-in date").

## Days remaining (refund tiers)

29. **Flights:** full 24-hour periods, `floor((departure − now) / 24h)`. It never rounds up, so a user can't get a better tier because of the time of day. **Hotels:** calendar days between today's UTC date and the check-in UTC date, because stays are date-based. Both are explained in a JSDoc in `refund-calculator.ts`.

## Testing

30. **No database in unit tests.** Adding `mongodb-memory-server` would need team approval (new dependency). Chose: a small in-memory `FakeModel` in `__tests__/fake-model.ts` that supports the filters and updates we use, **including unique and partial-unique indexes that throw error 11000**, so the race and duplicate logic is really exercised. A wiring test (`payments-flow.spec.ts`) boots the real modules, guards, DTO validation and error filter over HTTP, with only MongoDB and Stripe replaced.
31. **Real signature algorithm.** `webhook.spec.ts` signs payloads with Stripe's real `generateTestHeaderString` and sends them through a Nest app created with `rawBody: true`. It checks valid (200), unsigned (400) and tampered (400) requests.
