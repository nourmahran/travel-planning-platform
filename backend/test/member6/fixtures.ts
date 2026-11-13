import { CommunityStore } from '../../src/community/store';
import { objectId, Role } from '../../src/community/types';

export const ids = {
  eyad: '507f1f77bcf86cd799439001',
  sara: '507f1f77bcf86cd799439002',
  admin: '507f1f77bcf86cd799439003',
  hotelModerator: '507f1f77bcf86cd799439004',
  airlineModerator: '507f1f77bcf86cd799439005',
  hotel: '507f1f77bcf86cd799439101',
  otherHotel: '507f1f77bcf86cd799439102',
  airline: '507f1f77bcf86cd799439103',
  publicItinerary: '507f1f77bcf86cd799439201',
  privateItinerary: '507f1f77bcf86cd799439202',
  activity: '507f1f77bcf86cd799439203',
  privateActivity: '507f1f77bcf86cd799439204',
  review: '507f1f77bcf86cd799439301',
  otherReview: '507f1f77bcf86cd799439302',
};

export async function seedFixtures(store: CommunityStore) {
  const now = new Date();
  await store.connection.collection('users').insertMany(
    [
      { _id: objectId(ids.eyad), name: 'Eyad El Safty', role: Role.User },
      { _id: objectId(ids.sara), name: 'Sara Ahmed', role: Role.User },
      {
        _id: objectId(ids.admin),
        name: 'Demo Administrator',
        role: Role.Admin,
      },
      {
        _id: objectId(ids.hotelModerator),
        name: 'Hotel Moderator',
        role: Role.HotelModerator,
        assignedHotelId: objectId(ids.hotel),
      },
      {
        _id: objectId(ids.airlineModerator),
        name: 'Airline Moderator',
        role: Role.AirlineModerator,
        assignedAirlineId: objectId(ids.airline),
      },
    ].map((user) => ({
      ...user,
      status: 'active',
      createdAt: now,
      email: user._id.toString() + '@example.test',
      passwordHash: 'fixture-only-no-password-login',
    })),
  );
  await store.connection.collection('hotels').insertMany([
    {
      _id: objectId(ids.hotel),
      name: 'Nile Hotel',
      active: true,
      ratingCount: 2,
      averageRating: 3,
    },
    { _id: objectId(ids.otherHotel), name: 'Other Hotel', active: true },
  ]);
  await store.connection.collection('airlines').insertOne({
    _id: objectId(ids.airline),
    name: 'Demo Airline',
    active: true,
  });
  await store.connection.collection('itineraries').insertMany([
    {
      _id: objectId(ids.publicItinerary),
      title: 'Aswan weekend',
      visibility: 'Public',
      authorId: objectId(ids.eyad),
      countries: ['EG'],
      startDate: now,
      createdAt: now,
      updatedAt: now,
      hidden: false,
    },
    {
      _id: objectId(ids.privateItinerary),
      title: 'Private plans',
      visibility: 'Private',
      authorId: objectId(ids.eyad),
      createdAt: now,
      updatedAt: now,
      hidden: false,
    },
  ]);
  await store.connection.collection('activities').insertMany([
    {
      _id: objectId(ids.activity),
      itineraryId: objectId(ids.publicItinerary),
      name: 'Nile trip',
    },
    {
      _id: objectId(ids.privateActivity),
      itineraryId: objectId(ids.privateItinerary),
      name: 'Private visit',
    },
  ]);
  await store.connection.collection('reviews').insertMany([
    {
      _id: objectId(ids.review),
      authorId: objectId(ids.eyad),
      hotelId: objectId(ids.hotel),
      rating: 5,
      body: 'Great stay',
      hidden: false,
    },
    {
      _id: objectId(ids.otherReview),
      authorId: objectId(ids.sara),
      hotelId: objectId(ids.hotel),
      rating: 1,
      body: 'Needs work',
      hidden: false,
    },
  ]);
  for (const name of ['itinerary_days', 'budgets', 'transport_costs']) {
    await store.connection
      .collection(name)
      .insertOne({ itineraryId: objectId(ids.publicItinerary) });
  }
}
