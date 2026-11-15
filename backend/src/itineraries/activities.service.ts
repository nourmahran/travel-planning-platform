import { BadRequestException, Injectable } from '@nestjs/common';

import { ITINERARY_LIMITS } from './itinerary.constants';
import { ItinerariesService } from './itineraries.service';
import { AddImageDto } from './dto/add-image.dto';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import {
  imageList,
  requireActivity,
  requireDay,
  requireImage,
  type ActivitySubdocument,
} from './subdocuments';
import { toActivityResponse, toImageResponse } from './itinerary-detail';
import type { Activity, ActivityImage } from './schemas/itinerary.schema';
import { isClockTime, isMoney } from './validation';

@Injectable()
export class ActivitiesService {
  constructor(private readonly itineraries: ItinerariesService) {}

  async create(
    ownerId: string,
    itineraryId: string,
    dayId: string,
    dto: CreateActivityDto,
  ) {
    const itinerary = await this.itineraries.findOne(ownerId, itineraryId);
    const day = requireDay(itinerary, dayId);

    this.assertFields(dto);

    if (day.activities.length >= ITINERARY_LIMITS.maxActivitiesPerDay) {
      throw new BadRequestException(
        `A day can hold at most ${ITINERARY_LIMITS.maxActivitiesPerDay} activities`,
      );
    }

    day.activities.push({
      title: dto.title.trim(),
      attractionId: dto.attractionId,
      startTime: dto.startTime,
      durationMinutes: dto.durationMinutes,
      notes: dto.notes,
      cost: dto.cost,
      images: [],
    } as Activity);

    await itinerary.save();

    const activities = day.activities as unknown as ActivitySubdocument[];

    return toActivityResponse(activities[activities.length - 1]);
  }

  async update(
    ownerId: string,
    activityId: string,
    dto: UpdateActivityDto,
  ) {
    const itinerary = await this.itineraries.findOneByActivity(
      ownerId,
      activityId,
    );
    const { activity } = requireActivity(itinerary, activityId);

    this.assertFields(dto);

    if (dto.title !== undefined) {
      activity.title = dto.title.trim();
    }

    if (dto.attractionId !== undefined) {
      activity.attractionId = dto.attractionId;
    }

    if (dto.startTime !== undefined) {
      activity.startTime = dto.startTime === '' ? undefined : dto.startTime;
    }

    if (dto.durationMinutes !== undefined) {
      activity.durationMinutes = dto.durationMinutes;
    }

    if (dto.notes !== undefined) {
      activity.notes = dto.notes;
    }

    if (dto.cost !== undefined) {
      activity.cost = dto.cost;
    }

    await itinerary.save();

    return toActivityResponse(activity);
  }

  async remove(ownerId: string, activityId: string) {
    const itinerary = await this.itineraries.findOneByActivity(
      ownerId,
      activityId,
    );
    const { day, index } = requireActivity(itinerary, activityId);

    (day.activities as unknown as ActivitySubdocument[]).splice(index, 1);

    await itinerary.save();

    return { removedActivityId: activityId };
  }

  async addImage(ownerId: string, activityId: string, dto: AddImageDto) {
    const itinerary = await this.itineraries.findOneByActivity(
      ownerId,
      activityId,
    );
    const { activity } = requireActivity(itinerary, activityId);

    if (imageList(activity).length >= ITINERARY_LIMITS.maxImagesPerActivity) {
      throw new BadRequestException(
        `An activity can hold at most ${ITINERARY_LIMITS.maxImagesPerActivity} images`,
      );
    }

    activity.images.push({
      url: dto.url,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
    } as ActivityImage);

    await itinerary.save();

    const images = imageList(activity);

    return toImageResponse(images[images.length - 1]);
  }

  async removeImage(ownerId: string, activityId: string, imageId: string) {
    const itinerary = await this.itineraries.findOneByActivity(
      ownerId,
      activityId,
    );
    const { activity } = requireActivity(itinerary, activityId);
    const { images, index } = requireImage(activity, imageId);

    images.splice(index, 1);

    await itinerary.save();

    return { removedImageId: imageId };
  }

  private assertFields(dto: { startTime?: string; cost?: number }): void {
    if (
      dto.startTime !== undefined &&
      dto.startTime !== '' &&
      !isClockTime(dto.startTime)
    ) {
      throw new BadRequestException('startTime must be HH:mm in 24-hour time');
    }

    if (dto.cost !== undefined && !isMoney(dto.cost)) {
      throw new BadRequestException(
        'cost must be a non-negative amount with at most 2 decimals',
      );
    }
  }
}
