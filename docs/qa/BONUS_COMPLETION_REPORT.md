# Bonus completion report

Generated 2026-11-19 16:33 UTC.

| ID | Bonus | Status | Checks passed | Implementation and evidence |
|---|---|---|---|---|
| ACC-02 | The system shall send a verification link by email after registration and block booking until the email is verified. | Verified | 4/4 | Verification link on registration (hashed, single-use, 24 h); booking (flight hold/booking, hotel reservation) blocked until verified; resend endpoint. Real SMTP delivery not tested here (no SMTP server configured); emails captured in tests. |
| ACC-07 | The system shall allow a user who forgot their password to request a reset link by email; the link expires after 30 minutes, is single-use, is invalid... | Verified | 2/2 | Reset link + code by email, 30 min, single-use, invalidated by a newer request, same reply for unknown emails, clears lockout and revokes sessions. |
| GEN-01-B | The system shall also send the GEN-01 notifications (plus moderator invitations) by email via SMTP, using a test inbox in development. | Verified | 3/3 | Outbox job emails each new in-app notification once (per-user opt-out) and moderator invitations (temporary password never emailed). Uses the SMTP server from .env; a development test inbox (Ethereal/Mailtrap) must be configured to see real emails. |
| FLT-27 | The system shall allow a registered user to change a Confirmed flight booking's date or flight (same route and cabin), paying any fare difference via ... | Verified | 7/7 | Same-route change with Stripe payment of a higher fare (bookingType flight_change) or refund of a lower fare; verified end to end with Stripe test mode. |
| FLT-28 | The system shall allow seat selection. | Verified | 7/7 | Numbered seat map and PATCH seat; concurrent picks serialised. |
| HTL-26 | The system shall allow a hotel moderator to reply to a review. | Verified | 5/5 | Hotel moderator reply on reviews of their own hotel. |
| ITN-27 | The system shall allow booked flights and hotels to be linked to itinerary days, feeding the budget. | Verified | 8/8 | Link confirmed flight/hotel bookings to itinerary days; amounts feed the budget. |
| ITN-28 | The system shall allow a user to export or print an itinerary as PDF. | Verified | 5/5 | PDF export of an itinerary. |
| BLG-13 | The system shall allow an author to attach an itinerary to a post. | Verified | 6/6 | Attach / detach an own public itinerary to a post. |
| BON-01 | The system shall provide an admin analytics dashboard showing bookings and revenue per provider over a selected period. | Verified | 3/3 | Admin analytics of bookings and verified revenue per provider for a period. |
| BON-02 | The system shall allow a registered user to save hotels and public itineraries to a favourites list and view it. | Verified | 8/8 | Favourites for active hotels and public itineraries. |
| Cloud deployment | Deploy frontend and backend to a cloud platform | **Not done** | - | Requires the Milestone 2 frontend; the PDF evaluates this bonus only on a fully working deployed frontend + backend. |

## Remaining blockers

- **Email delivery**: the email bonuses are implemented and tested with a captured mail transport. To demonstrate real delivery, set `SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/MAIL_FROM` in `backend/.env` to a development test inbox (e.g. Ethereal or Mailtrap). Without SMTP the email text is printed in the server log (development only).
- **Cloud deployment**: needs the frontend (Milestone 2).
