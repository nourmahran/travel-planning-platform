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
- Airlines can define cancellation tiers and baggage rules matching Member 4's published policy shape. Internal booking acceptance stores an immutable snapshot during an active hold. FlightBookingGateway maps flight bookings, confirmation and expiry for Member 4's interface, and is exported from BookingsModule.

## Member 1 boundary

Member 1 registration from feature/ACC-01-user-registration is now present in this working tree: bcrypt password hashing, normalized unique emails, required terms/privacy consent and a safe response. Its imported tests were adjusted for this repository's Jest ESM setup. This is registration only; there is no login/session or verified identity/role guard yet. Never trust user or airline IDs from request bodies/query strings. Booking creation/cancellation, history, tickets and moderator routes must derive scope from authenticated claims before they are exposed.

## Member 4 boundary (flight adapter ready; registry wiring still needed)

Keep confirmation internal. The payment module must verify the provider signature, successful payment state, booking association, amount and currency, and persist a unique provider event/payment ID for idempotency before confirming. Do not call confirm from an unverified request. Member 4’s published PAY branch defines a BookingGateway contract with totalAmount, currency, accepted policy snapshots, conditional confirm and expiry. The flight adapter is present but is not registered with Member 4's registry because that module has not been integrated. Currency follows PLATFORM_CURRENCY (default usd) in the adapter.

Payment completion and departure/cancellation must be coordinated transactionally. A paid callback arriving after the hold deadline must not resurrect expired inventory: route it to Member 4 reconciliation/refund handling. Existing confirm is only an integration primitive, not a complete payment workflow.

Paid booking cancellation now rejects until refund integration is available. Unpaid cancellation restores seats transactionally. Flight cancellation with allocated seats remains blocked by the existing guard. The flight-side policy fields and acceptance snapshot are present. The flight adapter now implements the shared interface from Member 4's `feature/member-4` branch and is registered under `FLIGHT_BOOKING_ADAPTER`. It maps the flight module's existing stored status strings to the shared payment statuses. Confirmation uses the payment transaction and writes an in-app notification in that transaction. Member 4's Stripe payment/refund module has not been published or integrated, so webhook, refund and currency reconciliation remain open. No payment/refund events have been sent and no teammates have been messaged.

## Reviewed requirements and current progress

The reviewed requirements spreadsheet is `Final_ SP1_Reviewed_Requirements.xlsx` in the team Google Drive. Booking creation now validates age at departure: adults are 12+, children are 2–11 and pay full fare with a seat, and infants are under 2, pay 10% and occupy no seat. Each booking needs an adult and cannot have more infants than adults. Per-passenger extra bags and weights are validated against the selected cabin policy and included in the total. A single round-trip booking holds both flights transactionally with one reference; expiry and unpaid cancellation release both legs. Tickets include the return leg. Cancellation tiers need unique nonnegative thresholds; if no threshold applies the refund percentage is zero.

Added since the previous push: seat-count edits use a conditional atomic update and reject reductions below allocated seats. Schedule changes on flights with held/booked seats write confirmed-passenger in-app notification records in the same MongoDB transaction as the time change. Owner history grouping and a read-only cancellation refund preview are available internally. The preview chooses the highest eligible days-before tier, or zero if none applies. These owner-facing methods await authenticated routes.

Still open: flight/booking cancellation notifications, supported-currency seed data, public owner/moderator routes with Member 1 authentication, and paid cancellation/refunds with Member 4 payments. In-app notifications currently have no authenticated read endpoint. The schedule update and notifications require MongoDB transactions.

## Setup and API documentation

The backend README and backend/.env.example now describe local setup. `npm run seed` exposes the existing idempotent CSV seeder. No live seeding was run because it writes to the configured MongoDB database.

## Operational notes

MongoDB must support transactions (Atlas/replica set). Cleanup catches up on the next scheduled tick after restart; normal inventory-release delay is up to 15 seconds plus job processing. Legacy Pending rows without holdExpiresAt are not automatically expired; review/backfill them deliberately. Unique references on old rows likewise need an explicit migration if required. No shared Atlas data was modified by this work.

Validation uses mocked database unit/regression tests and actual PDF generation; a real replica-set concurrency test and authenticated HTTP/payment end-to-end tests remain outstanding. Member 1’s registration files were integrated in the earlier pushed commit. Member 4’s branch was reviewed only. Unrelated untracked root files were untouched.
