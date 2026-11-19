# Travel Planning Platform API

NestJS, MongoDB and TypeScript backend for the Travel Planning and Booking Platform.

## Setup

From this directory, install dependencies and copy .env.example to .env. Set MONGODB_URI to a MongoDB Atlas connection string (the database must support transactions), JWT_SECRET, and the Stripe test-mode STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET; the app will not start without them. PORT is optional (defaults to 3000). Keep .env private.

Run npm run seed to import the checked-in countries, cities, airports and attractions CSV files plus the configured supported currencies. Set SUPPORTED_CURRENCIES to a comma-separated list of ISO currency codes; PLATFORM_CURRENCY is always included (USD by default). The seeder inserts missing records and leaves existing records unchanged. Start the API with npm run start:dev. Swagger is available at http://localhost:3000/api.

## Backend routes

Every REST route is served under `/api` (for example `POST /api/auth/register`), matching section 8 of the project description. Swagger UI lists them all at http://localhost:3000/api. Main groups:

- /api/auth, /api/users/me, /api/admin: accounts, sessions, moderators, suspension, reports and audit logs.
- /api/airlines, /api/airports, /api/flights: airline profiles and baggage/cancellation policies, airport lookup, flight inventory, cabins and search (`GET /api/flights/search`).
- /api/flight-bookings: seat holds (`POST /hold`), bookings, cancellation, e-tickets, flight changes and seat selection. Holds expire after ten minutes; bookings are confirmed only after verified payment.
- /api/hotels, /api/hotel-bookings, /api/reviews: hotels, rooms, availability, reservations and reviews.
- /api/bookings/:type/:id/policies, /api/payments, /api/refunds: policy acceptance, Stripe payments and refunds.
- /api/itineraries, /api/activities, /api/budgets, /api/transport-costs: itinerary planning and budgets.
- /api/posts, /api/comments, /api/tags, /api/authors, /api/reports, /api/notifications: blog and community.

The older unlisted /api/bookings flight routes still work for existing clients but are hidden from Swagger.

## Email bonuses (ACC-02, ACC-07, GEN-01-B)

- `GET /api/auth/verify-email?token=...` and `POST /api/auth/resend-verification`: registration emails a single-use link valid for 24 hours. Self-registered users cannot create flight or hotel bookings until the address is verified (seeded and admin-created accounts count as verified).
- `POST /api/auth/forgot-password` and `POST /api/auth/reset-password`: a single-use code valid for 30 minutes. Both requests answer the same way for unknown emails, and a reset signs the account out everywhere.
- Email notifications: a job runs every 30 seconds and emails each new in-app notification to its recipient. Users can turn this off with `PATCH /api/users/me {"emailNotifications": false}`.

Mail goes only to the SMTP server set in `.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`). Without `SMTP_HOST` nothing is sent; outside production the email text is printed in the server log so the flows can be tried from Swagger. For a demo, use a test inbox such as Ethereal or Mailtrap.

## Full API verification (test/qa)

`test/qa/run.cjs` starts the built backend against a private in-memory MongoDB replica set (seeded with the reference data), then exercises every module over HTTP like Swagger UI: valid and invalid requests, authentication, roles, ownership, duplicates, concurrency and Stripe test-mode payments (real PaymentIntents and refunds; webhooks are signed with a harness-only secret). The shared Atlas database is never touched. It needs a Stripe test key in `.env`.

```bash
npm run build
node test/qa/run.cjs
node test/qa/make-reports.cjs
```

Results go to `test/qa/results.json`; the reports are written to `docs/qa/`.

The API applies DTO validation globally and returns normalized HTTP errors. Scheduled jobs release expired seat holds and mark flights Departed. Use a replica-set MongoDB deployment for transactions.

## Checks

npm run build, npm run lint, and npm test -- --runInBand.

Booking history, ticket download and airline moderator routes require authenticated identity and role claims. Paid cancellation/refunds require the payment integration. See MEMBER2_HANDOFF.md for the current integration boundaries.

## Payments (Member 4: PAY-01 to PAY-04, GEN-11)

**Requires Node.js 24.9 or newer.** The tests use Jest with ESM; older Node versions fail with
"Must use import to load ES Module".

### Environment variables (values only in `.env`, never committed)
`STRIPE_SECRET_KEY` (test key, `sk_test_...`), `STRIPE_WEBHOOK_SECRET` (`whsec_...`),
`PLATFORM_CURRENCY` (default `usd`).

### Testing a payment from Swagger
1. Install the Stripe CLI and run `stripe login`.
2. In a second terminal: `stripe listen --forward-to localhost:3000/api/payments/webhook`
   and put the printed `whsec_...` value in `.env` as `STRIPE_WEBHOOK_SECRET`.
3. Log in with `POST /api/auth/login`. For every POST/PATCH/DELETE, also send the header
   `x-csrf-token` with the value of the `csrf_token` cookie.
4. Create a flight booking hold, then call
   `GET /api/bookings/flight/:id/policies` and `POST /api/bookings/flight/:id/accept-policies`.
5. `POST /api/payments` with the booking type and id.
6. Confirm the payment with a Stripe test card, either with the dev endpoint
   `POST /api/dev/payments/:id/confirm` or with the CLI:
   `stripe payment_intents confirm <pi_id> --payment-method pm_card_visa`
   (use `pm_card_chargeDeclined` to test a failed payment).
7. The webhook confirms the booking; `GET /api/payments/:id` shows the status.

More detail: `docs/api/payments-explained.md` and `docs/api/payments-integration.md`.
