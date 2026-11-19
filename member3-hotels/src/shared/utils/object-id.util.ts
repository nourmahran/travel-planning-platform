import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { isObjectIdString } from '../auth/dev-auth';

export function toObjectId(value: string | Types.ObjectId, field = 'id'): Types.ObjectId {
  if (value instanceof Types.ObjectId) {
    return value;
  }
  if (!isObjectIdString(value)) {
    throw new BadRequestException(`${field} must be a valid MongoDB ObjectId.`);
  }
  return new Types.ObjectId(value);
}
