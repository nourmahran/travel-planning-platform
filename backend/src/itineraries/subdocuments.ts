import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import type {
  Activity,
  ActivityImage,
  Day,
} from './schemas/itinerary.schema';

export type DaySubdocument = Day & { _id: Types.ObjectId };
export type ActivitySubdocument = Activity & { _id: Types.ObjectId };
export type ImageSubdocument = ActivityImage & { _id: Types.ObjectId };

/**
 * Embedded subdocuments are plain arrays in the schema; Mongoose assigns an
 * _id to each one. These helpers keep that cast in a single place.
 */
export function dayList(itinerary: { days: Day[] }): DaySubdocument[] {
  return itinerary.days as unknown as DaySubdocument[];
}

export function requireDay(
  itinerary: { days: Day[] },
  dayId: string,
): DaySubdocument {
  const day = dayList(itinerary).find((candidate) => String(candidate._id) === dayId);

  if (!day) {
    throw new NotFoundException('Day not found');
  }

  return day;
}

export type ActivityLocation = {
  day: DaySubdocument;
  activity: ActivitySubdocument;
  index: number;
};

/** Finds the day that holds an activity, wherever it sits in the itinerary. */
export function requireActivity(
  itinerary: { days: Day[] },
  activityId: string,
): ActivityLocation {
  for (const day of dayList(itinerary)) {
    const activities = (day.activities ?? []) as unknown as ActivitySubdocument[];
    const index = activities.findIndex(
      (candidate) => String(candidate._id) === activityId,
    );

    if (index !== -1) {
      return { day, activity: activities[index], index };
    }
  }

  throw new NotFoundException('Activity not found');
}

export function requireImage(
  activity: ActivitySubdocument,
  imageId: string,
): { images: ImageSubdocument[]; index: number } {
  const images = (activity.images ?? []) as unknown as ImageSubdocument[];
  const index = images.findIndex((candidate) => String(candidate._id) === imageId);

  if (index === -1) {
    throw new NotFoundException('Image not found');
  }

  return { images, index };
}

export function imageList(activity: ActivitySubdocument): ImageSubdocument[] {
  return (activity.images ?? []) as unknown as ImageSubdocument[];
}
