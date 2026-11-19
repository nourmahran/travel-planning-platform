import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ClientSession, isObjectIdOrHexString } from 'mongoose';
import { AuditQueryDto } from './dto/community.dto';
import { CommunityStore } from './store';
import { Actor, objectId, PAGE_SIZE, pageResult, Role } from './types';

export interface AuditInput {
  action: string;
  targetType: string;
  targetId: string;
  details?: {
    reportId?: string;
    note?: string;
    previousStatus?: string;
    nextStatus?: string;
  };
}

@Injectable()
export class AuditService {
  constructor(private readonly store: CommunityStore) {}

  async record(actor: Actor, input: AuditInput, session?: ClientSession) {
    if (actor.role !== Role.Admin)
      throw new ForbiddenException('Administrator access is required');
    if (
      !isObjectIdOrHexString(actor.id) ||
      !isObjectIdOrHexString(input.targetId) ||
      !/^[a-z._-]{1,100}$/.test(input.action) ||
      !/^[a-z_-]{1,50}$/.test(input.targetType)
    ) {
      throw new BadRequestException('Invalid audit data');
    }
    const [entry] = await this.store.audits.create(
      [
        {
          actorId: objectId(actor.id),
          action: input.action,
          targetType: input.targetType,
          targetId: objectId(input.targetId),
          details: input.details ?? {},
        },
      ],
      { session },
    );
    return entry;
  }

  async list(dto: AuditQueryDto) {
    const filter: Record<string, unknown> = {};
    if (dto.actorId) filter.actorId = objectId(dto.actorId);
    if (dto.action) filter.action = dto.action;
    const total = await this.store.audits.countDocuments(filter);
    const items = await this.store.audits
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((dto.page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean();
    return pageResult(items, total, dto.page);
  }
}
