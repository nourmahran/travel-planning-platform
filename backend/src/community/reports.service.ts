import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { AuditService } from './audit.service';
import { ContentService } from './content.service';
import {
  CreateReportDto,
  ReportsQueryDto,
  ResolveReportDto,
} from './dto/community.dto';
import { CommunityStore } from './store';
import {
  Actor,
  ContentType,
  ModerationAction,
  objectId,
  PAGE_SIZE,
  pageResult,
  ReportStatus,
} from './types';

@Injectable()
export class ReportsService {
  constructor(
    private readonly store: CommunityStore,
    private readonly content: ContentService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: Actor, dto: CreateReportDto) {
    try {
      return await this.store.transaction(async (session) => {
        await this.content.publicTarget(dto.targetType, dto.targetId, session);
        const filter = {
          reporterId: objectId(actor.id),
          targetType: dto.targetType,
          targetId: objectId(dto.targetId),
        };
        if (await this.store.reports.exists(filter).session(session)) {
          throw new ConflictException('You have already reported this item');
        }
        const [report] = await this.store.reports.create(
          [{ ...filter, reason: dto.reason }],
          { session },
        );
        return report;
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('You have already reported this item');
      }
      throw error;
    }
  }

  async list(dto: ReportsQueryDto) {
    const filter: Record<string, unknown> = { status: dto.status };
    if (dto.targetType) filter.targetType = dto.targetType;
    const total = await this.store.reports.countDocuments(filter);
    const items = await this.store.reports
      .find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .skip((dto.page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean();
    return pageResult(items, total, dto.page);
  }

  async resolve(actor: Actor, reportId: string, dto: ResolveReportDto) {
    return this.store.transaction(async (session) => {
      const report = await this.store.reports
        .findById(reportId)
        .session(session);
      if (!report) throw new NotFoundException('Report not found');
      if (report.status !== ReportStatus.Open)
        throw new ConflictException('Report has already been resolved');
      if (dto.action === ModerationAction.Dismiss) {
        const result = await this.store.reports
          .findOneAndUpdate(
            { _id: report._id, status: ReportStatus.Open },
            {
              $set: {
                status: ReportStatus.Dismissed,
                resolvedBy: objectId(actor.id),
                resolvedAt: new Date(),
                resolutionNote: dto.note ?? '',
              },
            },
            { returnDocument: 'after', session },
          )
          .lean();
        if (!result)
          throw new ConflictException('Report has already been resolved');
        await this.audit.record(
          actor,
          {
            action: 'report.dismissed',
            targetType: report.targetType,
            targetId: report.targetId.toString(),
            details: { reportId, note: dto.note },
          },
          session,
        );
        return result;
      }
      await this.moderate(
        actor,
        report.targetType,
        report.targetId.toString(),
        dto.action,
        dto.note,
        session,
        reportId,
      );
      return this.store.reports.findById(reportId).session(session).lean();
    });
  }

  async direct(
    actor: Actor,
    type: ContentType,
    id: string,
    action: ModerationAction.Hide | ModerationAction.Delete,
    note?: string,
  ) {
    return this.store.transaction(async (session) => {
      await this.moderate(actor, type, id, action, note, session);
      return { targetType: type, targetId: id, action };
    });
  }

  private async moderate(
    actor: Actor,
    type: ContentType,
    id: string,
    action: ModerationAction.Hide | ModerationAction.Delete,
    note: string | undefined,
    session: ClientSession,
    reportId?: string,
  ) {
    await this.content.lock(type, id, session);
    const status =
      action === ModerationAction.Hide
        ? ReportStatus.Hidden
        : ReportStatus.Deleted;
    await this.store.reports.updateMany(
      { targetType: type, targetId: objectId(id), status: ReportStatus.Open },
      {
        $set: {
          status,
          resolvedBy: objectId(actor.id),
          resolvedAt: new Date(),
          resolutionNote: note ?? '',
        },
      },
      { session },
    );
    if (action === ModerationAction.Hide)
      await this.content.hide(type, id, session);
    else await this.content.remove(type, id, actor, session);
    await this.audit.record(
      actor,
      {
        action:
          action === ModerationAction.Hide
            ? 'content.hidden'
            : 'content.deleted',
        targetType: type,
        targetId: id,
        details: { reportId, note },
      },
      session,
    );
  }
}
