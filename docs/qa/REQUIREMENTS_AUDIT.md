# Requirements audit

Generated 2026-11-19 16:17 UTC from the official workbook (`Final_ SP1_Reviewed_Requirements.xlsx`, 104 mandatory + 11 bonus rows) and the black-box API run in `backend/test/qa` (700 checks, 700 passed).

**Status meanings.** *Verified*: every black-box check for the requirement passed against the running backend. *Partial*: works, with the documented gap. *Frontend (Milestone 2)*: user-interface behaviour; the backend part is noted. *Not black-box tested*: implemented, covered only by unit tests or not exercised over HTTP.

## Mandatory (104)

| ID | Module | Requirement (first sentence) | Status | Checks passed | Notes |
|---|---|---|---|---|---|
| ACC-01 | Accounts & Admin | The system shall allow a guest to register by entering name, unique email, password and a mandatory terms-and-privacy consent checkbox | Verified | 12/12 |  |
| ACC-04 | Accounts & Admin | The system shall allow a registered user, admin or moderator to log in with email and password and land on their role's home page | Verified | 5/5 |  |
| ACC-05 | Accounts & Admin | After 5 consecutive failed login attempts, the system shall lock the account for 15 minutes and show a lockout message | Verified | 4/4 |  |
| ACC-06 | Accounts & Admin | The system shall allow a logged-in user to log out, which clears the authentication cookies and revokes the refresh token on the server | Verified | 6/6 |  |
| ACC-07a | Accounts & Admin | The system shall allow an admin to reset a user's or moderator's password to a temporary password | Verified | 7/7 |  |
| ACC-08 | Accounts & Admin | The system shall allow a logged-in user to change their password by entering the current password and a new one that meets the rules. | Verified | 6/6 |  |
| ACC-09 | Accounts & Admin | The system shall allow any logged-in user to edit name, phone number and preferred currency, saving only if all fields pass validation. | Verified | 6/6 |  |
| ACC-10 | Accounts & Admin | The system shall send a guest who attempts a restricted action (book, review, post) to login and return them to that action afterwards. | Frontend (Milestone 2) | 6/6 | Redirect to login and back is a frontend flow; backend returns 401 for guests on restricted actions (verified). |
| ACC-11 | Accounts & Admin | The system shall restrict access to bookings and private itineraries to their owner, except that admins may view all bookings (ACC-17) and moderators ... | Verified | 17/17 |  |
| ACC-12 | Accounts & Admin | The system shall allow a registered user to deactivate their own account after confirmation | Verified | 7/7 |  |
| ACC-13 | Accounts & Admin | The system shall allow an admin to create a hotel or airline moderator account (name, email, role) linked to exactly one hotel or airline, with a temp... | Verified | 8/8 |  |
| ACC-14 | Accounts & Admin | The system shall allow an admin to view a paginated list of all accounts (name, email, role, status, registration date) and to search by name or email... | Verified | 6/6 |  |
| ACC-15 | Accounts & Admin | The system shall allow an admin to suspend and reactivate a moderator account (a suspended moderator cannot log in) and, separately, to deactivate and... | Verified | 17/17 |  |
| ACC-16 | Accounts & Admin | The system shall allow an admin to suspend and reactivate registered users (for example, for abusive content) | Verified | 5/5 |  |
| ACC-17 | Accounts & Admin | The system shall allow an admin to view a read-only list of all flight and hotel bookings (reference, user, provider, dates, amount, status), filterab... | Verified | 5/5 |  |
| FLT-01 | Flights | The system shall allow an admin to create an airline profile and an airline moderator to edit their airline's profile (name, code, logo). | Verified | 10/10 |  |
| FLT-02 | Flights | The system shall provide a predefined, read-only list of airports (IATA code, name, city, country, IANA time zone) loaded at setup | Verified | 7/7 |  |
| FLT-03 | Flights | The system shall allow an airline moderator to create a flight with flight number, departure and arrival airports, and departure and arrival date-time... | Verified | 11/11 |  |
| FLT-04 | Flights | The system shall allow an airline moderator to define cabin categories per flight from the fixed set {Economy, Premium Economy, Business, First}, each... | Verified | 9/9 |  |
| FLT-05 | Flights | The system shall allow an airline moderator to edit departure/arrival times, cabin prices and cabin seat counts of their own Scheduled flights | Verified | 14/14 |  |
| FLT-06 | Flights | The system shall allow an airline moderator to cancel a Scheduled flight after confirmation | Verified | 9/9 |  |
| FLT-08 | Flights | The system shall allow an airline moderator to define a price per extra bag (>0) and a maximum number of extra bags per passenger (>=0) | Verified | 4/4 |  |
| FLT-09 | Flights | The system shall allow an airline moderator to define cancellation tiers, each with a unique days-before-departure threshold (integer >=0) and a refun... | Verified | 7/7 |  |
| FLT-11 | Flights | The system shall allow a guest or registered user to search flights by selecting a departure airport, arrival airport, departure date (local date at t... | Verified | 5/5 |  |
| FLT-12 | Flights | The system shall support: (a) round-trip search returning outbound and return options, booked as one booking with two segments, one payment and one re... | Verified | 7/7 |  |
| FLT-15 | Flights | The system shall allow a guest or registered user to filter flight results by an inclusive minimum and maximum price while preserving the other search... | Verified | 4/4 |  |
| FLT-17 | Flights | The system shall provide a flight details page showing airline, flight number, airports, local departure and arrival times, duration, each cabin categ... | Verified | 5/5 |  |
| FLT-19 | Flights | The system shall allow a registered user, during booking, to enter each passenger's full name, date of birth and passport/ID number and optionally add... | Verified | 7/7 |  |
| FLT-21 | Flights | The system shall show a booking summary (flight, passengers, baggage, total) before payment. | Verified | 2/2 |  |
| FLT-22 | Flights | When a user proceeds to payment, the system shall atomically reserve the requested seats only if enough remain, creating a booking in Pending Payment ... | Verified | 12/12 |  |
| FLT-23 | Flights | After successful payment, the system shall set the flight booking to Confirmed, convert the held seats into booked seats, generate a unique booking re... | Verified | 7/7 |  |
| FLT-25 | Flights | The system shall allow a registered user to view their flight bookings grouped as Upcoming, Past and Cancelled, showing reference, flight, date, passe... | Verified | 5/5 |  |
| FLT-26 | Flights | The system shall allow a registered user to cancel their own Confirmed flight booking any time before departure, after viewing the refund amount compu... | Verified | 8/8 |  |
| FLT-29 | Flights | The system shall allow an airline moderator to view, per flight, its bookings (reference, passenger names, cabin, seats and status: Confirmed or Cance... | Verified | 8/8 |  |
| HTL-01 | Hotels | The system shall allow an admin to create a hotel profile and a hotel moderator to edit their hotel's profile (name, address, city and country, descri... | Partial | 8/8 | Hotel city/country are free text; they are not validated against the seeded city list (GEN-12). |
| HTL-02 | Hotels | The system shall provide a hotel details page showing the hotel profile, photos, amenities, check-in and check-out times, cancellation policy, average... | Verified | 3/3 |  |
| HTL-03 | Hotels | The system shall allow a hotel moderator to add a room (an individually bookable unit) with a room number/name unique within the hotel, type, number o... | Verified | 6/6 |  |
| HTL-04 | Hotels | The system shall allow a hotel moderator to define non-overlapping date ranges when a room is bookable. | Partial | 1/1 | Rooms are bookable by default and moderators block date ranges (HTL-06); explicit "bookable date ranges" are not modelled as such. |
| HTL-05 | Hotels | The system shall allow a hotel moderator to edit a room's beds, occupancy, price and availability | Verified | 4/4 |  |
| HTL-06 | Hotels | The system shall allow a hotel moderator to block date ranges for a room and to deactivate or delete a room | Verified | 7/7 |  |
| HTL-08 | Hotels | The system shall allow a hotel moderator to view each room's status for a chosen date range as Available, Booked (with reservation reference) or Block... | Verified | 6/6 |  |
| HTL-09 | Hotels | The system shall allow a hotel moderator to set the hotel's standard check-in and check-out times, shown on the hotel page and the booking summary. | Verified | 3/3 |  |
| HTL-10 | Hotels | The system shall allow a hotel moderator to define cancellation tiers, each with a unique days-before-check-in threshold (integer >=0) and a refund pe... | Verified | 2/2 |  |
| HTL-11 | Hotels | The system shall allow a guest or registered user to search hotels by city or country, check-in date, check-out date, number of guests and number of r... | Verified | 6/6 |  |
| HTL-12 | Hotels | The system shall allow a guest or registered user to filter hotel results by an inclusive minimum and maximum price per night (price of the cheapest q... | Verified | 4/4 |  |
| HTL-15 | Hotels | The system shall allow a guest or registered user to view all of a hotel's rooms that are free for the searched dates, showing type, beds, maximum occ... | Verified | 3/3 |  |
| HTL-16 | Hotels | The system shall allow a registered user to book one or more available rooms in the same hotel for the same dates in one reservation, assigning adults... | Verified | 5/5 |  |
| HTL-17 | Hotels | After successful payment, the system shall set the reservation (all its rooms) to Confirmed, generate a unique booking reference, show a confirmation ... | Verified | 2/2 |  |
| HTL-18 | Hotels | When a user proceeds to payment, the system shall hold all selected rooms together for 10 minutes as one Pending Payment reservation | Verified | 11/11 |  |
| HTL-20 | Hotels | The system shall allow a registered user to view their hotel reservations grouped as Upcoming, Past and Cancelled, showing reference, hotel, rooms, da... | Partial | 5/5 | Reservations are listed with status and date filters; the Upcoming/Past/Cancelled grouping is left to the client (flights return the three groups). |
| HTL-21 | Hotels | The system shall allow a registered user to cancel their own Confirmed reservation as a whole before the check-in date, after viewing the refund compu... | Verified | 6/6 |  |
| HTL-22 | Hotels | The system shall allow a hotel moderator to view reservations for their hotel (guest, dates, status). | Verified | 4/4 |  |
| HTL-23 | Hotels | A Confirmed reservation becomes Completed once its check-out date has passed | Verified | 14/14 |  |
| HTL-24 | Hotels | The system shall allow a guest or registered user to view a hotel's average rating, number of ratings and reviews (newest first, paginated). | Verified | 2/2 |  |
| PAY-01 | Payments & Policies | The system shall allow a registered user to pay for a Pending Payment flight booking or hotel reservation within its hold period using Stripe in test ... | Verified | 28/28 |  |
| PAY-02 | Payments & Policies | Before payment, the system shall show the provider's policies (airline: cancellation and baggage policies; hotel: cancellation policy and check-in/che... | Verified | 13/13 |  |
| PAY-03 | Payments & Policies | For every cancellation with a positive refund amount (user cancellations per the provider's tiers; provider-initiated cancellations at 100%), the syst... | Verified | 8/8 |  |
| ITN-01 | Itineraries | The system shall allow a registered user to create an itinerary with a required title (max 100 characters), one or more countries selected from a pred... | Verified | 13/13 |  |
| ITN-03 | Itineraries | The system shall allow a user to list their itineraries (title, countries, start date, days and visibility), most recently updated first, and open any... | Verified | 4/4 |  |
| ITN-05 | Itineraries | The system shall allow a user to add days to their itinerary and edit each day's city (selected from the predefined city list shared with hotels and a... | Verified | 6/6 |  |
| ITN-07 | Itineraries | The system shall allow a user to delete a day after confirmation | Verified | 3/3 |  |
| ITN-08 | Itineraries | The system shall allow a user to move a day to a new position, with days renumbered and dates and groupings recalculated. | Verified | 4/4 |  |
| ITN-09 | Itineraries | The system shall require each itinerary day to have a city and shall display consecutive days in the same city as a group, with the group's day count ... | Verified | 2/2 |  |
| ITN-10 | Itineraries | The system shall allow a user to add, edit and delete activities for an itinerary day, including name, description, optional time and optional cost. | Verified | 7/7 |  |
| ITN-12 | Itineraries | The system shall allow a user to attach images to and remove images from an activity under the shared media-upload rule (GEN-08). | Verified | 6/6 |  |
| ITN-14 | Itineraries | The system shall allow a user to add, edit and delete non-negative budget entries for each day across food, accommodation, in-city transport and activ... | Verified | 12/12 |  |
| ITN-16 | Itineraries | The system shall allow a user to add, edit and delete a transport cost entry (mode, from-city, to-city, amount, currency, day). | Verified | 6/6 |  |
| ITN-18 | Itineraries | The system shall convert all itinerary budget amounts to the user's preferred currency (from the supported currency list) using exchange rates fetched... | Verified | 7/7 |  |
| ITN-20 | Itineraries | The system shall allow a user to set an itinerary's visibility to Public or Private | Verified | 4/4 |  |
| ITN-21 | Itineraries | The system shall allow a guest or registered user to search public itineraries by keyword matching title, country or city; filter results by duration ... | Verified | 16/16 |  |
| ITN-25 | Itineraries | The system shall allow a user to pick a city group in their itinerary and view hotels available for that group's dates (check-in = date of the group's... | Verified | 3/3 |  |
| ITN-26 | Itineraries | The system shall allow a user to search one-way or round-trip flights from a chosen origin airport to any airport in the city of the itinerary's first... | Verified | 4/4 |  |
| BLG-01 | Blog | The system shall allow a registered user to create a post with a required title and body, optional tags and images, and save it as Draft or Publish | Verified | 7/7 |  |
| BLG-02 | Blog | The system shall allow a guest or registered user to browse a paginated list of published posts filterable by tag, and open a post page showing title,... | Verified | 6/6 |  |
| BLG-03 | Blog | The system shall allow a user to list their own posts, including drafts, with title, status, date, like count and comment count. | Verified | 3/3 |  |
| BLG-04 | Blog | The system shall allow an author to edit and delete their own posts. | Verified | 6/6 |  |
| BLG-05 | Blog | The system shall allow a user to comment on a published post (non-empty, max 500 characters), shown in chronological order. | Verified | 7/7 |  |
| BLG-06 | Blog | The system shall allow a user to like a post once and remove the like, showing the like count. | Verified | 6/6 |  |
| BLG-07 | Blog | The system shall allow a user to edit and delete their own comments. | Verified | 4/4 |  |
| BLG-08 | Blog | The system shall allow an author to add up to 5 tags (max 30 characters each) to a post and edit them later | Verified | 4/4 |  |
| BLG-09 | Blog | The system shall allow a guest or registered user to search published posts by keyword in title, tags or author name, showing title, author, date and ... | Verified | 3/3 |  |
| BLG-10 | Blog | The system shall allow an author to attach images to a post under the shared media-upload rule (GEN-08) and remove them. | Verified | 5/5 |  |
| BLG-12 | Blog | The system shall provide a public author page showing the author's name, join date, published posts and public itineraries. | Verified | 3/3 |  |
| GEN-01 | Cross-cutting | The system shall show in-app notifications (unread count, notification list, mark as read) for booking confirmation, cancellation and refund, flight s... | Verified | 7/7 |  |
| GEN-02 | Cross-cutting | The system shall show field-level validation messages on all forms. | Frontend (Milestone 2) | 0/0 | Field-level messages are frontend; backend returns per-field validation messages (verified 400 responses). |
| GEN-03 | Cross-cutting | The system shall ask for confirmation before destructive actions (delete, cancel). | Frontend (Milestone 2) | 1/1 | Confirmation dialogs are frontend; backend requires confirm:true on deletes (verified). |
| GEN-04 | Cross-cutting | The system shall show friendly empty states when a list or search has no results. | Frontend (Milestone 2) | 0/0 | Empty states are frontend; backend returns empty lists (verified). |
| GEN-05 | Cross-cutting | The system shall paginate every list longer than 10 rows (page size 10). | Verified | 2/2 |  |
| GEN-06 | Cross-cutting | The system shall show flight times in each airport's local time zone. | Verified | 2/2 |  |
| GEN-07 | Cross-cutting | The system shall keep an audit log of admin actions (suspensions, deletions). | Verified | 5/5 |  |
| GEN-08 | Cross-cutting | The system shall accept image uploads in JPG or PNG format, up to 5 MB each, with up to 5 images per post, activity or hotel and 1 logo per airline, s... | Verified | 8/8 |  |
| GEN-09 | Cross-cutting | The system shall allow a registered user to report a post, comment, review or itinerary with a reason, at most once per item. | Verified | 7/7 |  |
| GEN-10 | Cross-cutting | The system shall allow an admin to view the list of open reports and resolve each by dismissing it, hiding the content or deleting it, and to hide or ... | Verified | 12/12 |  |
| GEN-11 | Cross-cutting | Flight bookings and hotel reservations shall follow the lifecycle Pending Payment -> Confirmed -> Completed, with Pending Payment -> Expired (hold tim... | Partial | 1/1 | Lifecycle is enforced, but hotel reservations name the states HELD/CONFIRMED/COMPLETED/EXPIRED/CANCELLED instead of "Pending Payment" etc., and both modules also allow cancelling an unpaid hold (an extra Pending -> Cancelled transition). |
| FLT-30 | Flights | Flights shall have a status of Scheduled, Cancelled or Departed | Verified | 3/3 |  |
| ACC-18 | Accounts & Admin | Admin accounts shall be created by seeding at setup; there is no admin self-registration. | Verified | 3/3 |  |
| PAY-04 | Payments & Policies | All flight and hotel prices, payments and refunds shall use a single platform currency. | Verified | 1/1 |  |
| GEN-12 | Cross-cutting | The system shall seed reference data at setup: airports, cities, countries and supported currencies. | Verified | 6/6 |  |
| GEN-13 | Cross-cutting | All validation, business rules and authorisation shall be enforced by the backend regardless of frontend checks, and passwords shall be stored only as... | Verified | 15/15 |  |
| ACC-19 | Cross-cutting | The system shall not store authentication tokens or user credentials in localStorage, sessionStorage or any other JavaScript-accessible storage | Partial | 9/9 | Cookies are httpOnly and SameSite=Lax; the Secure flag is set only when NODE_ENV=production (local http testing). |
| GEN-14 | Cross-cutting | The system shall provide a clear and organized information architecture, with logically grouped content, balanced spacing, correctly structured menus,... | Frontend (Milestone 2) | 0/0 | User interface (Milestone 2). |
| GEN-15 | Cross-cutting | The system shall provide an intuitive, easy-to-learn interface with clearly visible actions, understandable labels, and efficient workflows that minim... | Frontend (Milestone 2) | 0/0 | User interface (Milestone 2). |
| GEN-16 | Cross-cutting | The system shall provide clear feedback for user actions, including loading, success, and error states | Frontend (Milestone 2) | 0/0 | User interface (Milestone 2). |
| GEN-17 | Cross-cutting | The system shall maintain a consistent color palette, typography, spacing, alignment, and component styling across all pages | Frontend (Milestone 2) | 0/0 | User interface (Milestone 2). |

## Bonus (11)

| ID | Module | Requirement (first sentence) | Status | Checks passed | Notes |
|---|---|---|---|---|---|
| ACC-02 | Accounts & Admin | The system shall send a verification link by email after registration and block booking until the email is verified. | Verified | 4/4 | Verification link on registration (hashed, single-use, 24 h); booking (flight hold/booking, hotel reservation) blocked until verified; resend endpoint. Real SMTP delivery not tested here (no SMTP server configured); emails captured in tests. |
| ACC-07 | Accounts & Admin | The system shall allow a user who forgot their password to request a reset link by email; the link expires after 30 minutes, is single-use, is invalid... | Verified | 2/2 | Reset link + code by email, 30 min, single-use, invalidated by a newer request, same reply for unknown emails, clears lockout and revokes sessions. |
| GEN-01-B | Cross-cutting | The system shall also send the GEN-01 notifications (plus moderator invitations) by email via SMTP, using a test inbox in development. | Verified | 3/3 | Outbox job emails each new in-app notification once (per-user opt-out) and moderator invitations (temporary password never emailed). Uses the SMTP server from .env; a development test inbox (Ethereal/Mailtrap) must be configured to see real emails. |
| FLT-27 | Flights | The system shall allow a registered user to change a Confirmed flight booking's date or flight (same route and cabin), paying any fare difference via ... | Verified | 7/7 | Same-route change with Stripe payment of a higher fare (bookingType flight_change) or refund of a lower fare; verified end to end with Stripe test mode. |
| FLT-28 | Flights | The system shall allow seat selection. | Verified | 7/7 | Numbered seat map and PATCH seat; concurrent picks serialised. |
| HTL-26 | Hotels | The system shall allow a hotel moderator to reply to a review. | Verified | 5/5 | Hotel moderator reply on reviews of their own hotel. |
| ITN-27 | Itineraries | The system shall allow booked flights and hotels to be linked to itinerary days, feeding the budget. | Verified | 8/8 | Link confirmed flight/hotel bookings to itinerary days; amounts feed the budget. |
| ITN-28 | Itineraries | The system shall allow a user to export or print an itinerary as PDF. | Verified | 5/5 | PDF export of an itinerary. |
| BLG-13 | Blog | The system shall allow an author to attach an itinerary to a post. | Verified | 6/6 | Attach / detach an own public itinerary to a post. |
| BON-01 | Accounts & Admin | The system shall provide an admin analytics dashboard showing bookings and revenue per provider over a selected period. | Verified | 3/3 | Admin analytics of bookings and verified revenue per provider for a period. |
| BON-02 | Cross-cutting | The system shall allow a registered user to save hotels and public itineraries to a favourites list and view it. | Verified | 8/8 | Favourites for active hotels and public itineraries. |

