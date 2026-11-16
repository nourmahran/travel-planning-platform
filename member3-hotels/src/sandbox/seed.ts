import 'dotenv/config';
import { connect, connection, Types } from 'mongoose';
import {
  Hotel,
  HotelSchema,
  defaultHotelPolicies,
} from '../hotels/schemas/hotel.schema';
import { Room, RoomSchema } from '../hotels/schemas/room.schema';
import { envString } from '../shared/utils/env.util';

/**
 * Seeds two demo hotels with rooms so the module can be tested in Swagger
 * before Member 2's full reference-data seed exists.
 *
 * Idempotent: run it as often as you like.
 */

const DEMO_USER_ID = '66a1b2c3d4e5f60718293a01';
const DEMO_MODERATOR_CAIRO = '66a1b2c3d4e5f60718293a02';
const DEMO_MODERATOR_ALEXANDRIA = '66a1b2c3d4e5f60718293a03';
const DEMO_ADMIN_ID = '66a1b2c3d4e5f60718293a04';

interface DemoHotel {
  name: string;
  description: string;
  city: string;
  country: string;
  address: string;
  starRating: number;
  moderatorId: Types.ObjectId;
  amenities: string[];
  images: Array<{ url: string; caption?: string }>;
  rooms: Array<{
    roomNumber: string;
    name: string;
    description: string;
    bedType: 'single' | 'double' | 'queen' | 'king' | 'twin' | 'sofa_bed';
    bedCount: number;
    maxAdults: number;
    maxChildren: number;
    basePricePerNightCents: number;
    sizeSqm: number;
    floor: number;
  }>;
}

const DEMO_HOTELS: DemoHotel[] = [
  {
    name: 'Grand Nile Demo Hotel',
    description:
      'A demo five-star hotel on the Nile corniche used to exercise the hotels module in Swagger. It has rooms with different occupancy and price so search filtering and multi-room reservations can be demonstrated.',
    city: 'Cairo',
    country: 'Egypt',
    address: '12 Corniche El Nil, Cairo',
    starRating: 5,
    moderatorId: new Types.ObjectId(DEMO_MODERATOR_CAIRO),
    amenities: ['wifi', 'pool', 'spa', 'parking', 'breakfast'],
    images: [
      { url: 'https://images.unsplash.com/photo-1566073771259-6a8506099945', caption: 'Exterior' },
    ],
    rooms: [
      {
        roomNumber: '101',
        name: 'Deluxe Double Room',
        description: 'Double room with Nile view.',
        bedType: 'queen',
        bedCount: 1,
        maxAdults: 2,
        maxChildren: 1,
        basePricePerNightCents: 12000,
        sizeSqm: 28,
        floor: 1,
      },
      {
        roomNumber: '102',
        name: 'Family Suite',
        description: 'Two connected sleeping areas for a family.',
        bedType: 'king',
        bedCount: 2,
        maxAdults: 4,
        maxChildren: 2,
        basePricePerNightCents: 24000,
        sizeSqm: 55,
        floor: 1,
      },
      {
        roomNumber: '201',
        name: 'Standard Twin Room',
        description: 'Two single beds, city view.',
        bedType: 'twin',
        bedCount: 2,
        maxAdults: 2,
        maxChildren: 0,
        basePricePerNightCents: 9000,
        sizeSqm: 22,
        floor: 2,
      },
    ],
  },
  {
    name: 'Azure Bay Demo Resort',
    description:
      'A demo four-star beach resort used to exercise hotel search sorting and rating filters. Prices and room capacities differ from the Cairo demo hotel.',
    city: 'Alexandria',
    country: 'Egypt',
    address: '45 El Geish Road, Alexandria',
    starRating: 4,
    moderatorId: new Types.ObjectId(DEMO_MODERATOR_ALEXANDRIA),
    amenities: ['wifi', 'beach', 'pool', 'parking'],
    images: [
      { url: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4', caption: 'Beach' },
    ],
    rooms: [
      {
        roomNumber: 'A1',
        name: 'Sea View Double',
        description: 'Double room facing the Mediterranean.',
        bedType: 'double',
        bedCount: 1,
        maxAdults: 2,
        maxChildren: 1,
        basePricePerNightCents: 15000,
        sizeSqm: 26,
        floor: 1,
      },
      {
        roomNumber: 'A2',
        name: 'Beach Villa',
        description: 'Standalone villa with a private terrace.',
        bedType: 'king',
        bedCount: 1,
        maxAdults: 3,
        maxChildren: 2,
        basePricePerNightCents: 30000,
        sizeSqm: 70,
        floor: 0,
      },
    ],
  },
];

async function main(): Promise<void> {
  const uri = envString('MONGODB_URI', '');
  if (!uri) {
    throw new Error('MONGODB_URI is required. Copy .env.example to .env first.');
  }

  await connect(uri);
  const HotelModel = connection.model(Hotel.name, HotelSchema);
  const RoomModel = connection.model(Room.name, RoomSchema);
  await Promise.all([HotelModel.init(), RoomModel.init()]);

  const summary: Array<Record<string, unknown>> = [];

  for (const demo of DEMO_HOTELS) {
    const hotel = await HotelModel.findOneAndUpdate(
      {
        name: demo.name,
        'location.city': demo.city,
        'location.country': demo.country,
      },
      {
        $set: {
          description: demo.description,
          location: {
            city: demo.city,
            country: demo.country,
            address: demo.address,
            latitude: null,
            longitude: null,
          },
          amenities: demo.amenities,
          images: demo.images,
          starRating: demo.starRating,
          isActive: true,
          moderatorId: demo.moderatorId,
          policies: defaultHotelPolicies(),
        },
        $setOnInsert: { averageRating: 0, reviewCount: 0 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
    );
    if (!hotel) {
      throw new Error(`Could not seed hotel ${demo.name}.`);
    }

    const roomIds: string[] = [];
    for (const room of demo.rooms) {
      const saved = await RoomModel.findOneAndUpdate(
        { hotelId: hotel._id, roomNumber: room.roomNumber },
        {
          $set: {
            name: room.name,
            description: room.description,
            bedType: room.bedType,
            bedCount: room.bedCount,
            maxAdults: room.maxAdults,
            maxChildren: room.maxChildren,
            basePricePerNightCents: room.basePricePerNightCents,
            currency: (process.env.PLATFORM_CURRENCY ?? 'USD').toUpperCase(),
            sizeSqm: room.sizeSqm,
            floor: room.floor,
            amenities: ['wifi', 'tv', 'air_conditioning'],
            images: [],
            isActive: true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
      );
      if (saved) {
        roomIds.push(saved._id.toString());
      }
    }

    summary.push({
      hotelId: hotel._id.toString(),
      name: hotel.name,
      city: hotel.location.city,
      moderatorId: hotel.moderatorId?.toString(),
      roomIds,
    });
  }

  console.log('\nDemo data seeded successfully.\n');
  console.log(JSON.stringify({ summary, demoUserIds: {
    guest: DEMO_USER_ID,
    admin: DEMO_ADMIN_ID,
    cairoModerator: DEMO_MODERATOR_CAIRO,
    alexandriaModerator: DEMO_MODERATOR_ALEXANDRIA,
  } }, null, 2));
  console.log('\nSandbox headers (AUTH_DEV_MODE=true):');
  console.log(`  guest:      x-user-id: ${DEMO_USER_ID}       x-user-role: USER`);
  console.log(`  moderator:  x-user-id: ${DEMO_MODERATOR_CAIRO}  x-user-role: HOTEL_MODERATOR`);
  console.log(`  admin:      x-user-id: ${DEMO_ADMIN_ID}       x-user-role: ADMIN`);
  console.log('\nNext: npm run start:dev, open /docs, and follow README.md "Example flow (curl)".\n');

  await connection.close();
}

main().catch(async (error) => {
  console.error(error);
  await connection.close().catch(() => undefined);
  process.exitCode = 1;
});
