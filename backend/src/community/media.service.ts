import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import sharp from 'sharp';
import { ContentService } from './content.service';
import { CommunityStore } from './store';
import {
  Actor,
  IMAGE_LIMITS,
  MAX_IMAGE_BYTES,
  MediaTarget,
  objectId,
} from './types';

@Injectable()
export class MediaService {
  constructor(
    private readonly store: CommunityStore,
    private readonly content: ContentService,
  ) {}

  async validateImage(file: Express.Multer.File) {
    if (!file.buffer?.length || file.buffer.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException(
        'Each image must be non-empty and at most 5 MB',
      );
    }
    try {
      const image = sharp(file.buffer, {
        failOn: 'warning',
        limitInputPixels: 40000000,
      });
      const metadata = await image.metadata();
      const jpeg = metadata.format === 'jpeg';
      const png = metadata.format === 'png';
      const mimeType = jpeg ? ('image/jpeg' as const) : ('image/png' as const);
      if ((!jpeg && !png) || file.mimetype !== mimeType) {
        throw new Error('Wrong image format');
      }
      if (
        (jpeg && !/\.jpe?g$/i.test(file.originalname)) ||
        (png && !/\.png$/i.test(file.originalname))
      ) {
        throw new Error('Wrong image extension');
      }
      const data = await image.rotate().toBuffer();
      if (data.length > MAX_IMAGE_BYTES)
        throw new Error('Decoded image exceeds the storage limit');
      return { data, mimeType, size: data.length };
    } catch {
      throw new BadRequestException(
        'Upload a valid JPG or PNG image, at most 5 MB and 40 megapixels',
      );
    }
  }

  async add(
    actor: Actor,
    type: MediaTarget,
    id: string,
    files: Express.Multer.File[],
  ) {
    if (!files?.length)
      throw new BadRequestException(
        'At least one image is required in the images field',
      );
    if (files.length > IMAGE_LIMITS[type])
      throw new BadRequestException('Too many images for this content');
    await this.content.mediaTarget(type, id, actor, true);
    const images: {
      data: Buffer;
      mimeType: 'image/jpeg' | 'image/png';
      size: number;
    }[] = [];
    for (const file of files) images.push(await this.validateImage(file));
    return this.store.transaction(async (session) => {
      await this.content.mediaTarget(type, id, actor, true, session);
      const count = await this.store.media
        .countDocuments({ targetType: type, targetId: objectId(id) })
        .session(session);
      if (count + images.length > IMAGE_LIMITS[type]) {
        throw new BadRequestException(
          'Maximum ' +
            IMAGE_LIMITS[type] +
            ' image(s) allowed for this content',
        );
      }
      const saved = await this.store.media.create(
        images.map((image) => ({
          ...image,
          targetType: type,
          targetId: objectId(id),
          uploaderId: objectId(actor.id),
        })),
        { session, ordered: true },
      );
      return saved.map((image) => ({
        id: image._id,
        url: '/api/media/' + image._id.toString(),
        mimeType: image.mimeType,
        size: image.size,
      }));
    });
  }

  async remove(actor: Actor, type: MediaTarget, id: string, imageId: string) {
    return this.store.transaction(async (session) => {
      await this.content.mediaTarget(type, id, actor, true, session);
      const result = await this.store.media.deleteOne(
        { _id: objectId(imageId), targetType: type, targetId: objectId(id) },
        { session },
      );
      if (!result.deletedCount)
        throw new NotFoundException('Image not found on this content');
      return { deleted: true };
    });
  }

  async read(id: string, actor?: Actor) {
    const image = await this.store.media.findById(id).select('+data');
    if (!image) throw new NotFoundException('Image not found');
    await this.content.mediaTarget(
      image.targetType,
      image.targetId.toString(),
      actor,
    );
    return { data: image.data, mimeType: image.mimeType };
  }
}
