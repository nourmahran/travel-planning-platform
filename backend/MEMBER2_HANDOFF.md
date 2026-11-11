# Member 2 implementation and integration boundary

## Implemented in this continuation

- ScheduleModule enabled. Every 15 seconds, unpaid holds whose ten-minute deadline has passed transition to Expired and return inventory in one MongoDB transaction. Conditional state updates prevent duplicate restoration across workers/cancellation. Failed releases stay retryable; failures are logged. No TTL deletion removes booking history.
- Confirmation checks the hold deadline both before and during its conditional update. The public confirmation endpoint remains disabled.
- Scheduled flights become Departed when their UTC departure time passes; cancelled flights are excluded.
- Price bounds apply to the same cabin as seat availability and cabin class. price_asc/price_desc sort by the cheapest eligible per-seat cabin fare, before pagination, on both round-trip legs. The default remains departure ordering.
- New bookings receive immutable UUID references with a sparse unique index. Existing bookings are not modified; internal exports fall back to the booking ID.
- Internal generateTicket(id, userId) returns a PDF Buffer only for confirmed/completed bookings belonging to the supplied user. Uses the current flight details. Standard PDF font currently covers Latin text; a licensed Unicode font is needed for full multilingual passenger names. No public download route yet.
- Internal listForAirline and streaming exportPassengers restrict queries to the specified airline's flight. CSV includes confirmed/completed passengers, quotes fields and neutralizes spreadsheet formulas. No public moderator routes yet.
- Read-only airport APIs provide paginated search by name/IATA code/country and GET /airports/:code with its IANA time zone. Airport search validates pagination and escapes regular-expression input.

## Member 1 boundary

Member 1 registration from feature/ACC-01-user-registration is now present in this working tree: bcrypt password hashing, normalized unique emails, required terms/privacy consent and a safe response. Its imported tests were adjusted for this repository's Jest ESM setup. This is registration only; there is no login/session or verified identity/role guard yet. Never trust user or airline IDs from request bodies/query strings. Booking creation/cancellation, history, tickets and moderator routes must derive scope from authenticated claims before they are exposed.

## Member 4 boundary (published interface reviewed; adapter still needed)

Keep confirmation internal. The payment adapter must verify the provider signature, successful payment state, booking association, amount and currency, and persist a unique provider event/payment ID for idempotency before confirming. Do not call confirm from an unverified request. Member 4’s published PAY branch defines a BookingGateway contract with totalAmount, currency, accepted policy snapshots, conditional confirm and expiry. This branch does not yet implement/register the flight adapter. Currency must follow the shared platform-currency configuration when that adapter is added.

Payment completion and departure/cancellation must be coordinated transactionally. A paid callback arriving after the hold deadline must not resurrect expired inventory: route it to Member 4 reconciliation/refund handling. Existing confirm is only an integration primitive, not a complete payment workflow.

Paid booking cancellation now rejects until refund integration is available. Unpaid cancellation restores seats transactionally. Flight cancellation with allocated seats remains blocked by the existing guard. Member 4’s published contract expects the accepted cancellation policy snapshot and baggage rules on each payable booking. The flight-side policy fields and acceptance adapter still need to be implemented against that contract before their payment module is merged. No payment/refund events have been sent and no teammates have been messaged.

## Still requires the original specification

The available chat lists requirement IDs but omits age boundaries, child/infant fare ratios, infant seat/adult accompaniment rules, baggage limits, cancellation tiers, and GEN-06/GEN-12 acceptance criteria. These business rules were not invented. Airline policy fields/pricing, schedule-change notification delivery, and their acceptance tests remain unfinished pending that specification and notification ownership. Current bookings continue the existing one-seat/full-cabin-fare-per-passenger behavior.

## Setup and API documentation

The backend README and backend/.env.example now describe local setup. `npm run seed` exposes the existing idempotent CSV seeder. No live seeding was run because it writes to the configured MongoDB database.

## Operational notes

MongoDB must support transactions (Atlas/replica set). Cleanup catches up on the next scheduled tick after restart; normal inventory-release delay is up to 15 seconds plus job processing. Legacy Pending rows without holdExpiresAt are not automatically expired; review/backfill them deliberately. Unique references on old rows likewise need an explicit migration if required. No shared Atlas data was modified by this work.

Validation uses mocked database unit/regression tests and actual PDF generation; a real replica-set concurrency test and authenticated HTTP/payment end-to-end tests remain outstanding. Existing lint findings were fixed: handle startup rejection, copy cabin fields explicitly, and mark the intentionally unused test variable. Member 1’s registration files were integrated into the working tree from the published feature branch; no commit, push, or Git merge was performed. Member 4’s branch was reviewed only. Unrelated untracked root files were untouched.
