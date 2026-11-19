# Final readiness report (Milestone 1 - Backend & API)

Generated 2026-11-19 16:17 UTC.

## Numbers

| Item | Result |
|---|---|
| Mandatory requirements (workbook) | 104 |
| - backend-verified | 91 |
| - partial (documented gaps) | 5 |
| - frontend only (Milestone 2) | 8 |
| - not black-box tested | 0 |
| - failing | 0 |
| Bonus requirements verified | 11 / 11 (+ cloud deployment: not done) |
| PDF section 8 endpoints documented in Swagger | 122 / 122 |
| Black-box API checks passed | 700 / 700 |
| Production build (npm run build) | passed |
| Lint (npm run lint) | 0 errors, 22 warnings (pre-existing style warnings) |
| Jest unit + integration suite (Node 24.22) | 564 / 564 passed in 72 suites |
| Community test suite (npm run test:community) | 28 / 28 passed |
| Concurrency checks (last seat, overbooking, same room, multi-room, duplicate webhooks, simultaneous cancels) | all passed |
| __fixes | FLT-05: time and seat-count edits of booked flights were always rejected (validated DTOs carry undefined keys); only sent fields count now.,ACC-15: flights of a deactivated airline could still be booked; hold/booking now reject inactive airlines (outbound and return).,GEN-07: admin suspensions, reactivations, provider (de)activation, moderator creation and password resets are now written to the audit log.,ITN-12 / GEN-08: activity image upload always returned 404 (the transaction locked a non-existent standalone activity); uploaded images are now also shown in the itinerary detail.,HTL-08: moderator calendar now shows the reservation reference for booked/held nights (hidden from the public).,HTL-23: review text is optional and limited to 1000 characters (was required, up to 2000).,ITN-21: minDays > maxDays is rejected instead of silently returning nothing.,ACC-02: booking (not login) is blocked until the email is verified.,ACC-07: reset email contains a single-use link; a newer request invalidates the older link.,GEN-01-B: moderator invitations are emailed (temporary password never emailed).,Security: admin account search escaped against regex injection / ReDoS.,Swagger: @nestjs/swagger CLI plugin documents every DTO (hotel endpoints had no request fields); shadowed duplicate activity-image routes hidden.,Error responses: hotel date-validation errors return 400 instead of 409. |

## Failing checks

None.

## Partial / unverified requirements

- **HTL-01** (Partial): Hotel city/country are free text; they are not validated against the seeded city list (GEN-12).
- **HTL-04** (Partial): Rooms are bookable by default and moderators block date ranges (HTL-06); explicit "bookable date ranges" are not modelled as such.
- **HTL-20** (Partial): Reservations are listed with status and date filters; the Upcoming/Past/Cancelled grouping is left to the client (flights return the three groups).
- **GEN-11** (Partial): Lifecycle is enforced, but hotel reservations name the states HELD/CONFIRMED/COMPLETED/EXPIRED/CANCELLED instead of "Pending Payment" etc., and both modules also allow cancelling an unpaid hold (an extra Pending -> Cancelled transition).
- **ACC-19** (Partial): Cookies are httpOnly and SameSite=Lax; the Secure flag is set only when NODE_ENV=production (local http testing).

## Bugs found and fixed in this verification

- FLT-05: time and seat-count edits of booked flights were always rejected (validated DTOs carry undefined keys); only sent fields count now.
- ACC-15: flights of a deactivated airline could still be booked; hold/booking now reject inactive airlines (outbound and return).
- GEN-07: admin suspensions, reactivations, provider (de)activation, moderator creation and password resets are now written to the audit log.
- ITN-12 / GEN-08: activity image upload always returned 404 (the transaction locked a non-existent standalone activity); uploaded images are now also shown in the itinerary detail.
- HTL-08: moderator calendar now shows the reservation reference for booked/held nights (hidden from the public).
- HTL-23: review text is optional and limited to 1000 characters (was required, up to 2000).
- ITN-21: minDays > maxDays is rejected instead of silently returning nothing.
- ACC-02: booking (not login) is blocked until the email is verified.
- ACC-07: reset email contains a single-use link; a newer request invalidates the older link.
- GEN-01-B: moderator invitations are emailed (temporary password never emailed).
- Security: admin account search escaped against regex injection / ReDoS.
- Swagger: @nestjs/swagger CLI plugin documents every DTO (hotel endpoints had no request fields); shadowed duplicate activity-image routes hidden.
- Error responses: hotel date-validation errors return 400 instead of 409.

## Verdict

All backend acceptance checks executed in this run pass. The remaining items are documented partial deviations, user-interface requirements that belong to Milestone 2, and bonuses that need external setup (SMTP inbox, cloud deployment).

**READY FOR MILESTONE 1 SUBMISSION (backend)** - the frontend and integration requirements are Milestone 2.
