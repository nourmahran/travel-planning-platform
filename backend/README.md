# Travel Planning Platform API

NestJS, MongoDB and TypeScript backend for the Travel Planning and Booking Platform.

## Setup

From this directory, install dependencies and copy .env.example to .env. Set MONGODB_URI to a MongoDB Atlas connection string (the database must support transactions) and optionally set PORT (defaults to 3000). Keep .env private.

Run npm run seed to import the checked-in countries, cities, airports and attractions CSV files plus the configured supported currencies. Set SUPPORTED_CURRENCIES to a comma-separated list of ISO currency codes; PLATFORM_CURRENCY is always included (USD by default). The seeder inserts missing records and leaves existing records unchanged. Start the API with npm run start:dev. Swagger is available at http://localhost:3000/api.

## Backend routes

- /auth/register: create an account after password and consent validation.
- /airlines: airline management.
- /airports: read-only paginated airport search; supports q, country, page and limit. /airports/:code reads one airport and its IANA time zone.
- /flights: create, search (one-way and round-trip), inspect, update and cancel flights. Search supports cabin, passenger count, local departure date, price bounds, sorting and pagination.
- /bookings: create a temporary seat hold and cancel an unpaid booking. Holds expire after ten minutes. Booking confirmation is intentionally not exposed until payment is verified.

The API applies DTO validation globally and returns normalized HTTP errors. Scheduled jobs release expired seat holds and mark flights Departed. Use a replica-set MongoDB deployment for transactions.

## Checks

npm run build, npm run lint, and npm test -- --runInBand.

Booking history, ticket download and airline moderator routes require authenticated identity and role claims. Paid cancellation/refunds require the payment integration. See MEMBER2_HANDOFF.md for the current integration boundaries.
