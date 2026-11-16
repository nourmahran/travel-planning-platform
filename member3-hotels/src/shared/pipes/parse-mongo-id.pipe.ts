import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { Types } from 'mongoose';
import { isObjectIdString } from '../auth/dev-auth';

/** Validates a route `:id` and converts it to an ObjectId. */
@Injectable()
export class ParseMongoIdPipe implements PipeTransform<string, Types.ObjectId> {
  transform(value: string): Types.ObjectId {
    if (!isObjectIdString(value)) {
      throw new BadRequestException('The identifier must be a valid MongoDB ObjectId.');
    }
    return new Types.ObjectId(value);
  }
}
