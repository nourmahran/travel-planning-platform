# Itineraries, budgets and currency API

Member 5's module: itinerary planning (ITN-01 … ITN-26). All routes are served
without an `/api` prefix; Swagger UI is mounted at `/api`.

- Base URL: `http://localhost:3000`
- Content type: `application/json`
- SwiftUI-style camelCase bodies; ids are 24-character Mongo ObjectIds.

## 1. Authentication

There is no login on this branch yet (Member 1 owns it). Protected routes use a
temporary development guard:

| Item | Value |
|---|---|
| Header | `x-dev-user-id: <24-hex ObjectId>` |
| Enabled when | `ENABLE_DEV_AUTH=true` **and** `NODE_ENV` is not `production` |
| Missing/invalid header | `401 Unauthorized` |
| Delete on merge | the whole guard, replaced by Member 1's cookie guard |

Public routes (search, public detail, cities, currency conversion) need no
header. The guard resolves the caller id only; every service re-checks ownership
against the stored `ownerId`.

## 2. Endpoints

| # | Method | Path | Auth | Responsibility |
|---|---|---|---|---|
| 1 | POST | `/itineraries` | yes | ITN-01 create |
| 2 | GET | `/itineraries` | yes | ITN-01 list own, paginated |
| 3 | GET | `/itineraries/:id` | yes | ITN-01, ITN-03 detail |
| 4 | PATCH | `/itineraries/:id` | yes | ITN-01, ITN-20 edit, publish |
| 5 | DELETE | `/itineraries/:id` | yes | ITN-01 delete |
| 6 | POST | `/itineraries/:id/clone` | yes | ITN-21, ITN-22 clone |
| 7 | GET | `/itineraries/:id/budget-summary` | yes | ITN-14, ITN-18 totals |
| 8 | GET | `/itineraries/:id/hotels` | yes | ITN-25 stays per city |
| 9 | GET | `/itineraries/:id/flights` | yes | ITN-26 flight options |
| 10 | POST | `/itineraries/:itineraryId/days` | yes | ITN-05 add day |
| 11 | PATCH | `/itineraries/:itineraryId/days/reorder` | yes | ITN-07 reorder |
| 12 | PATCH | `/itineraries/:itineraryId/days/:dayId` | yes | ITN-05 change city |
| 13 | DELETE | `/itineraries/:itineraryId/days/:dayId` | yes | ITN-05 delete day |
| 14 | POST | `/itineraries/:itineraryId/days/:dayId/activities` | yes | ITN-10 add activity |
| 15 | PATCH | `/activities/:activityId` | yes | ITN-10, ITN-11 edit |
| 16 | DELETE | `/activities/:activityId` | yes | ITN-10 delete |
| 17 | POST | `/activities/:activityId/images` | yes | ITN-12 add image |
| 18 | DELETE | `/activities/:activityId/images/:imageId` | yes | ITN-12 remove image |
| 19 | POST | `/itineraries/:itineraryId/days/:dayId/budgets` | yes | ITN-14 add budget entry |
| 20 | PATCH | `/budgets/:budgetId` | yes | ITN-14 edit budget entry |
| 21 | DELETE | `/budgets/:budgetId` | yes | ITN-14 delete budget entry |
| 22 | POST | `/itineraries/:itineraryId/transport-costs` | yes | ITN-16 add cost |
| 23 | PATCH | `/transport-costs/:costId` | yes | ITN-16 edit cost |
| 24 | DELETE | `/transport-costs/:costId` | yes | ITN-16 delete cost |
| 25 | GET | `/itineraries/public/search` | no | ITN-20, ITN-21 search |
| 26 | GET | `/itineraries/public/:id` | no | ITN-21 public detail |
| 27 | GET | `/cities` | no | ITN-05 reference cities |
| 28 | GET | `/currency/convert` | no | ITN-18 conversion |

## 3. Itinerary

### Create

```json
POST /itineraries
{
  "title": "Cairo and Dubai",
  "countries": ["EG", "AE"],
  "startDate": "2026-12-01",
  "currency": "EGP"
}
```

| Field | Rule |
|---|---|
| `title` | trimmed, 1–100 characters |
| `countries` | 1–10 distinct ISO codes, must exist in `countries` |
| `startDate` | `YYYY-MM-DD`, a real calendar date |
| `currency` | optional 3-letter code, must be a display currency; defaults to the first country's currency |

New itineraries are `visibility: "private"`, `isHidden: false`, `cloneCount: 0`.
The response is the owner detail object.

### Detail response

```json
{
  "id": "…", "title": "Cairo and Dubai", "countries": ["EG", "AE"], "startDate": "2026-12-01",
  "currency": "EGP", "visibility": "private", "isHidden": false,
  "cloneCount": 0, "dayCount": 3, "updatedAt": "…", "createdAt": "…",
  "days": [
    {
      "id": "…", "dayNumber": 1, "date": "2026-12-01", "cityId": "cairo",
      "activities": [
        {
          "id": "…", "title": "Pyramids of Giza", "attractionId": "att-1",
          "startTime": "09:00", "durationMinutes": 180,
          "notes": "Tickets bought online.", "cost": 450,
          "images": [{ "id": "…", "url": "https://…", "mimeType": "image/png", "sizeBytes": 204800 }]
        }
      ],
      "budgets": [{ "id": "…", "category": "food", "amount": 200, "note": "Lunch" }]
    }
  ],
  "transportCosts": [
    { "id": "…", "fromCityId": "cairo", "toCityId": "dubai", "amount": 300, "date": "2026-12-02", "note": "Flight" }
  ],
  "clonedFrom": { "itineraryId": "…", "authorId": "…", "authorName": "Sara", "clonedAt": "…" }
}
```

`clonedFrom` is present only on a copy. `GET /itineraries` returns
`{ items: [summary], total, page, limit, totalPages }` where a summary is the
detail without `days`, `transportCosts`, `clonedFrom` and `createdAt`, plus
`dayCount`.

### Edit and delete

`PATCH /itineraries/:id` accepts any subset of `title`, `countries`,
`startDate`, `currency`, `visibility` (`private` | `public`). Changing
`startDate` or `countries` renumbers every day date from the new start and
re-validates that each day city still belongs to one of the countries (a city
outside them is a `400`). `DELETE` removes the itinerary and its subdocuments;
it answers `204`.

## 4. Days (ITN-05 … ITN-09)

| Route | Body | Rule |
|---|---|---|
| `POST …/days` | `{ "cityId": "cairo" }` | city must exist and belong to the itinerary countries; `dayNumber = n+1`; `date` derived from `startDate`; max 60 days |
| `PATCH …/days/reorder` | `{ "dayIds": ["…", "…"] }` | must list every day exactly once; dates are recalculated in the new order |
| `PATCH …/days/:dayId` | `{ "cityId": "dubai" }` | same city rule as create |
| `DELETE …/days/:dayId` | — | remaining days renumber to 1…n and their dates close the gap |

Every day response carries `id`, `dayNumber`, `date`, `cityId`, `activities`
and `budgets`. City names are resolved on read for the budget summary, public
detail and travel routes; the day itself stores only the reference id.

City groups (ITN-09) are computed, never stored: consecutive days in the same
city form one group, and the same city appearing twice forms two groups.

## 5. Activities and images (ITN-10 … ITN-13)

```json
POST /itineraries/:itineraryId/days/:dayId/activities
{
  "title": "Pyramids of Giza",
  "attractionId": "att-1",
  "startTime": "09:00",
  "durationMinutes": 180,
  "notes": "Tickets bought online.",
  "cost": 450
}
```

| Field | Rule |
|---|---|
| `title` | trimmed, 1–120 characters |
| `attractionId` | optional, 1–80 characters |
| `startTime` | optional `HH:mm`, 24-hour, `00:00`–`23:59` |
| `durationMinutes` | optional integer 1–1440 |
| `notes` | optional, up to 200 characters |
| `cost` | optional, ≥ 0, at most 2 decimals |

`PATCH /activities/:activityId` takes any subset; `DELETE` removes the activity
with its images. A day holds at most 20 activities.

Images are URL-only until Member 6's media service exists:

```json
POST /activities/:activityId/images
{ "url": "https://cdn.example.com/pyramids.png", "mimeType": "image/png", "sizeBytes": 204800 }
```

`url` is required and must be a URL of at most 2048 characters; `mimeType`
matches `type/subtype`; `sizeBytes` is a non-negative integer. An activity holds
at most **5** images (`400` when exceeded). Deleting an image removes only that
image.

## 6. Budgets and transport costs (ITN-14, ITN-16)

```json
POST /itineraries/:itineraryId/days/:dayId/budgets
{ "category": "food", "amount": 200, "note": "Lunch" }
```

- `category` is one of `food`, `accommodation`, `local_transport`, `activities`.
- `amount` is ≥ 0 with at most 2 decimals.
- `note` is optional, up to 200 characters.
- The day must belong to the itinerary.

```json
POST /itineraries/:itineraryId/transport-costs
{ "fromCityId": "cairo", "toCityId": "dubai", "amount": 300, "date": "2026-12-02", "note": "Flight" }
```

- Both cities must differ and must already appear in the itinerary days.
- `date` is optional `YYYY-MM-DD`; `note` up to 200 characters.

Edit and delete routes find the parent itinerary by the nested subdocument id, so
`/budgets/:budgetId` needs no itinerary id in the path. A foreign parent answers
`403`; an unknown subdocument answers `404`.

## 7. Budget summary (ITN-14, ITN-18)

```
GET /itineraries/:id/budget-summary?currency=USD
```

```json
{
  "itineraryId": "…", "currency": "USD", "sourceCurrency": "EGP",
  "rateDate": "2026-11-15", "rateSource": "cached",
  "totals": {
    "categories": { "food": 11.0, "accommodation": 33.0, "local_transport": 2.2, "activities": 9.9 },
    "transport": 22.0,
    "grandTotal": 78.1
  },
  "byDay": [ { "dayId": "…", "dayNumber": 1, "date": "…", "cityId": "cairo", "categories": { … }, "total": 20.0 } ],
  "byCityGroup": [ { "cityId": "cairo", "cityName": "Cairo", "countryCode": "EG", "fromDay": 1, "toDay": 2, "dateFrom": "…", "dateTo": "…", "categories": { … }, "total": 44.0 } ],
  "transportCosts": [ { "id": "…", "fromCityId": "cairo", "toCityId": "dubai", "date": "…", "amount": 300, "convertedAmount": 22.0 } ]
}
```

Rules:

1. Day totals add budget entries per category **and** each activity `cost` to
   `activities`, so an activity is never invisible in the budget.
2. Transport costs are a separate list plus one `totals.transport` line; they are
   **not** part of any day or city group, only of `grandTotal`.
3. City-group totals use the consecutive-day grouping of ITN-09.
4. Display currency: `?currency`, else the caller's `users.preferredCurrency`,
   else the itinerary currency. It must be a display currency.
5. Every figure is converted **once** from its source total, then rounded to 2
   decimals — never per entry, so no rounding drift.
6. `rateSource` is `same` (same currency, no FX call), `live`, `cached` or
   `stale`; `rateDate` is `null` when the currency is unchanged.

## 8. Exchange rates (ITN-18)

```
GET /currency/convert?amount=100&from=EGP&to=EUR
```

```json
{ "amount": 100, "from": "EGP", "to": "EUR", "rate": 0.0018, "convertedAmount": 0.18,
  "rateDate": "2026-11-15", "rateSource": "cached" }
```

- One `exchange_rates` document per UTC day, base USD, upserted on first use and
  served from Mongo afterwards.
- The client calls `GET /latest?base=USD` with a 5 s timeout and **one retry**.
  When it fails, the newest cached document is served as `stale`; when nothing
  is cached the route answers `503` rather than inventing a rate.
- Cross rates go through USD: `rate = rates[to] / rates[from]`.
- Both codes must be display currencies (the distinct `countries.currency`
  values), not Member 2's booking-side `PLATFORM_CURRENCY`.

| Env var | Meaning |
|---|---|
| `FX_RATES_API_BASE_URL` | defaults to `https://api.fxratesapi.com` |
| `FX_RATES_API_KEY` | optional; only sent when set |
| `FX_RATES_TIMEOUT_MS` | defaults to `5000` |

## 9. Public search, public detail, clone (ITN-20 … ITN-22)

```
GET /itineraries/public/search?q=cairo&country=EG&city=cairo&authorId=…&minDays=2&maxDays=10&sort=popular&page=1&limit=10
```

Only `visibility = "public"` and `isHidden != true` itineraries are ever matched.

| Query | Rule |
|---|---|
| `q` | case-insensitive title search, regex-escaped |
| `country` | 2-letter code in the itinerary `countries` |
| `city` | city id used by at least one day |
| `authorId` | owner id |
| `minDays` / `maxDays` | day-count bounds (0–60) |
| `sort` | `newest` (default, `updatedAt`) or `popular` (`cloneCount`) |
| `page` / `limit` | default 1 / 10, `limit` ≤ 100 |

Each item is the itinerary summary plus `author: { id, name }`. Names come from
`users.name` only — email and other fields never leave the database.

```
GET /itineraries/public/:id
```

Answers `200` with title, countries, startDate, days (city object + activities),
`author` and, for a copy, `originalAuthor`. Budget totals are **not** exposed.
Private and hidden itineraries answer `404`, not `403`.

```
POST /itineraries/:id/clone
{ "title": "My Egypt trip", "startDate": "2027-03-01" }
```

- Source must be public and not hidden, **or** owned by the caller.
- The copy is private, owned by the caller, `cloneCount: 0`, and every day,
  activity, image, budget and transport cost is rebuilt with new ids.
- `clonedFrom` records the original itinerary, author id and author name.
- `title` defaults to `Copy of <source title>`; `startDate` keeps the source
  dates unless given, when every day date is recalculated.
- The source's `cloneCount` is incremented by 1.

## 10. Hotels and flights (ITN-25, ITN-26)

```
GET /itineraries/:id/hotels?guests=2
GET /itineraries/:id/flights?passengers=1&limit=3
```

Hotels: one entry per city group with `checkIn = dateFrom`,
`checkOut = dateTo + 1 day` and `nights`. The data comes from the
`HotelSearchPort` contract with Member 3. Until that module lands the default
provider returns nothing and every group is `available: false` with a reason —
no hotel is ever fabricated. A provider error degrades the same way instead of
failing the itinerary.

Flights: one leg per change of city, dated on the arrival day, airports resolved
from the `airports` collection by `city_id` (at most 3 airports per city, every
pair searched). Each leg returns the cheapest cabins that can seat every
passenger, deduplicated by flight and limited to the cheapest few
(`price` per passenger, `totalPrice` for the whole party). Reasons instead of
guesses when a city has no airport or no flight matches.

## 11. Reference cities

```
GET /cities?country=EG&q=cai&page=1&limit=10
```

Read-only `{ city_id, name, country_code }` records sorted by name, `_id`
excluded, paginated. Used by the client when adding a day.

The seed (`npm run seed`) loads 8 countries, 8 cities and 8 airports. Only these
city ids are valid in a day: `cairo`, `dubai`, `london`, `new_york`, `paris`,
`tokyo`, `riyadh`, `frankfurt`; each has exactly one airport (`CAI`, `DXB`,
`LHR`, `JFK`, `CDG`, `HND`, `RUH`, `FRA`). Attractions: `att-1` … `att-8`, one
per city in that order (Cairo, Dubai, London, New York, Paris, Tokyo, Riyadh,
Frankfurt).

## 12. Status codes

| Code | When |
|---|---|
| `200` | read, edit or subdocument delete succeeded (`DELETE /itineraries/:id` is the only `204`) |
| `201` | created (itinerary, day, activity, budget, transport cost, image) |
| `204` | itinerary deleted |
| `400` | body/query validation failed, unknown reference code or city, bad `startDate`, 60-day cap, 20-activity cap, 5-image cap, transport city not in the itinerary, unsupported currency, rate missing for a code |
| `401` | `x-dev-user-id` missing, malformed, or the dev guard is disabled |
| `403` | the itinerary belongs to another user (owner routes only) |
| `404` | itinerary/subdocument/public itinerary not found (also covers another user's private itinerary on clone and public detail) |
| `503` | exchange rates unavailable: API failed and nothing is cached |

Validation is enforced twice on purpose: DTOs own the shape and Swagger docs,
services own the semantic rules (calendar dates, `HH:mm`, city membership,
category enum, currency membership), so direct service calls are testable.

## 13. Limits

| Limit | Value |
|---|---|
| title | 100 characters |
| activity title | 120 characters |
| note | 200 characters |
| days per itinerary | 60 |
| activities per day | 20 |
| images per activity | 5 |
| money | ≥ 0, at most 2 decimals |
| page size | 10 default, 100 max |
| countries per itinerary | 10 |
| airport pairs per leg | 3 × 3 |

These are the placeholder limits from the implementation plan; the reviewed
requirements workbook was not available, so nothing here is graded against it.

## 15. Responsibility coverage

The 25 responsibilities of the assignment, each with the test that proves it and
the Swagger route that exercises it. Suite names are under `backend/src/`.

| # | Responsibility | Test | Route |
|---|---|---|---|
| 1 | Itinerary creation, editing, deletion | `itineraries/itineraries.service.spec.ts` | 1, 4, 5 |
| 2 | Validate title, countries, start date | `itineraries/validation.spec.ts`, `itineraries.service.spec.ts` | 1 |
| 3 | Personal listing and details | `itineraries/itineraries.service.spec.ts` | 2, 3 |
| 4 | Day creation and management | `itineraries/days.service.spec.ts` | 10, 12 |
| 5 | Maximum 60 days per itinerary | `itineraries/days.service.spec.ts` | 10 |
| 6 | City selection from the reference dataset | `itineraries/days.service.spec.ts`, `reference-data` service | 27, 10 |
| 7 | Day deletion and automatic renumbering | `itineraries/days.service.spec.ts` | 13 |
| 8 | Day reordering and date recalculation | `itineraries/days.service.spec.ts`, `days-and-dates.spec.ts` | 11 |
| 9 | Group consecutive days by city | `itineraries/city-groups.spec.ts` | 7 |
| 10 | Activity creation, editing, deletion | `itineraries/activities.service.spec.ts` | 14, 15, 16 |
| 11 | Activity image management | `itineraries/activities.service.spec.ts` | 17, 18 |
| 12 | Daily budget entries | `itineraries/budgets.service.spec.ts` | 19, 20, 21 |
| 13 | Transport cost entries between cities | `itineraries/transport-costs.service.spec.ts` | 22, 23, 24 |
| 14 | Budgets by category, day, city group and itinerary | `itineraries/budget-summary.service.spec.ts` | 7 |
| 15 | Activity costs included in budgets | `itineraries/budget-totals.spec.ts`, `budget-summary.service.spec.ts` | 7 |
| 16 | Exchange-rate API integration | `currency/fxrates.client.spec.ts` | 28 |
| 17 | Cache rates once daily in MongoDB | `currency/exchange-rates.service.spec.ts` | 28 |
| 18 | Use cached rates when the API fails | `currency/exchange-rates.service.spec.ts` | 28 |
| 19 | Public/private visibility | `itineraries/itineraries.service.spec.ts`, `itineraries-public.service.spec.ts` | 4, 25, 26 |
| 20 | Public search and filtering | `itineraries/itineraries-public.service.spec.ts` | 25 |
| 21 | Clone into an independent private copy | `itineraries/itineraries.service.spec.ts` | 6 |
| 22 | Preserve original-author attribution | `itineraries/itineraries.service.spec.ts`, `itineraries-public.service.spec.ts` | 6, 26 |
| 23 | Hotel search by city group and dates | `itineraries/itinerary-hotels.service.spec.ts` | 8 |
| 24 | Flight search from destinations and dates | `itineraries/itinerary-flights.service.spec.ts` | 9 |
| 25 | Ownership restrictions on private itineraries | `itineraries/itineraries.service.spec.ts`, `itinerary-hotels/flights.service.spec.ts` | 3–24 |

Shared requirements:

| ID | Where |
|---|---|
| GEN-02 server-side validation | DTOs plus service rules; `validation.spec.ts` |
| GEN-03 destructive actions still authorized | edit/delete re-check the parent owner (`403`), tested in every subdocument suite |
| GEN-04 useful empty results | empty itinerary returns zeroed summary and `[]` lists; hotels/flights return `available: false` with a reason |
| GEN-05 lists paginated, page size 10 | `GET /itineraries`, `GET /itineraries/public/search`, `GET /cities` |
| GEN-13 backend-enforced rules | service-level tests call the service directly, bypassing DTOs |

## 16. Known gaps

- Member 1's login does not exist yet: every protected route is demonstrable
  only through `x-dev-user-id`.
- The live Swagger pass needs the shared `MONGODB_URI`, which this branch does
  not have. Route registration, the Swagger document itself and the security of
  every route are covered by `itineraries/itineraries.module.spec.ts`, which
  boots the module graph with a stubbed connection; the request/response pass
  over each route still has to be run against the shared database.
- Images are URLs; the upload and size rules belong to Member 6.
- `isHidden` is written by nobody yet; Member 6's moderation sets it.
- Hotels return an honest empty answer until Member 3's module lands.
- Airline names are not joined into flight options; only `airlineId` is returned.
- Currency conversion is display-only; bookings stay in `PLATFORM_CURRENCY`.
