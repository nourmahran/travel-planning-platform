/**
 * Which booking module a booking belongs to. Used in routes
 * (`/api/bookings/:type/:id/...`) and to pick the right adapter.
 */
export enum BookingType {
  FLIGHT = 'flight',
  HOTEL = 'hotel',
}
