import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConsumes,
  ApiCookieAuth,
  ApiOperation,
  ApiProduces,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { Access, CommunityGuard, CurrentActor } from './auth';
import { AuditService } from './audit.service';
import { ImagesBody, UploadImages } from './blog.controller';
import { ContentService } from './content.service';
import {
  AuditQueryDto,
  ConfirmDto,
  CreateReportDto,
  HideContentDto,
  PageDto,
  ReportsQueryDto,
  ResolveReportDto,
} from './dto/community.dto';
import { ApiErrors, ObjectIdPipe } from './http';
import { MediaService } from './media.service';
import { NotificationsService } from './notifications.service';
import { ReportsService } from './reports.service';
import { ContentType, MediaTarget, ModerationAction } from './types';
import type { Actor } from './types';

@Public()
@ApiTags('Shared media')
@ApiErrors()
@UseGuards(CommunityGuard)
@Access('media')
@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get('media/:id')
  @Access('optional')
  @ApiProduces('image/png', 'image/jpeg')
  @ApiOperation({
    summary:
      'GEN-08 Read an image, enforcing the parent content visibility on every request',
  })
  async read(
    @Param('id', ObjectIdPipe) id: string,
    @CurrentActor() actor: Actor | undefined,
    @Res() response: Response,
  ) {
    const image = await this.media.read(id, actor);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.type(image.mimeType).send(image.data);
  }

  @Post('media/:targetType/:targetId/images')
  @ApiCookieAuth('session')
  @ApiSecurity('csrf')
  @ApiConsumes('multipart/form-data')
  @ImagesBody()
  @UploadImages()
  @ApiOperation({
    summary:
      'GEN-08 Shared upload for posts, activities, hotels (5 images) and airlines (1 logo)',
  })
  upload(
    @CurrentActor() actor: Actor,
    @Param('targetType', new ParseEnumPipe(MediaTarget)) type: MediaTarget,
    @Param('targetId', ObjectIdPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.media.add(actor, type, id, files);
  }

  @Delete('media/:targetType/:targetId/images/:imageId')
  @ApiCookieAuth('session')
  @ApiSecurity('csrf')
  @ApiOperation({
    summary:
      'GEN-03, GEN-08 Remove an image after ownership/provider authorization and confirmation',
  })
  remove(
    @CurrentActor() actor: Actor,
    @Param('targetType', new ParseEnumPipe(MediaTarget)) type: MediaTarget,
    @Param('targetId', ObjectIdPipe) id: string,
    @Param('imageId', ObjectIdPipe) imageId: string,
    @Body() _dto: ConfirmDto,
  ) {
    return this.media.remove(actor, type, id, imageId);
  }

  @Post('activities/:id/images')
  @ApiCookieAuth('session')
  @ApiSecurity('csrf')
  @ApiConsumes('multipart/form-data')
  @ImagesBody()
  @UploadImages()
  @ApiOperation({
    summary: 'ITN-12, GEN-08 Upload images to an activity in your itinerary',
  })
  activityUpload(
    @CurrentActor() actor: Actor,
    @Param('id', ObjectIdPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.media.add(actor, MediaTarget.Activity, id, files);
  }

  @Delete('activities/:id/images/:imageId')
  @ApiCookieAuth('session')
  @ApiSecurity('csrf')
  @ApiOperation({
    summary: 'ITN-12 Remove an activity image after confirmation',
  })
  activityRemove(
    @CurrentActor() actor: Actor,
    @Param('id', ObjectIdPipe) id: string,
    @Param('imageId', ObjectIdPipe) imageId: string,
    @Body() _dto: ConfirmDto,
  ) {
    return this.media.remove(actor, MediaTarget.Activity, id, imageId);
  }
}

@Public()
@ApiTags('Reports')
@ApiErrors()
@ApiCookieAuth('session')
@ApiSecurity('csrf')
@UseGuards(CommunityGuard)
@Access('user')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @ApiOperation({
    summary:
      'GEN-09 Report a visible post, comment, review or public itinerary once, with a reason',
  })
  create(@CurrentActor() actor: Actor, @Body() dto: CreateReportDto) {
    return this.reports.create(actor, dto);
  }
}

@Public()
@ApiTags('Administration: moderation and audit')
@ApiErrors()
@ApiCookieAuth('session')
@UseGuards(CommunityGuard)
@Access('admin')
@Controller('admin')
export class ModerationController {
  constructor(
    private readonly reports: ReportsService,
    private readonly content: ContentService,
    private readonly audit: AuditService,
  ) {}

  @Get('reports')
  @ApiOperation({
    summary: 'GEN-09, GEN-10 List open reports by default, 10 per page',
  })
  list(@Query() dto: ReportsQueryDto) {
    return this.reports.list(dto);
  }

  @Patch('reports/:id')
  @ApiSecurity('csrf')
  @ApiOperation({
    summary:
      'GEN-10 Dismiss, hide or delete; hide/delete also resolve other open reports on that item',
  })
  resolve(
    @CurrentActor() actor: Actor,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.reports.resolve(actor, id, dto);
  }

  @Get('content/:type/:id')
  @ApiOperation({ summary: 'GEN-10 Inspect reported or hidden content' })
  read(
    @CurrentActor() actor: Actor,
    @Param('type', new ParseEnumPipe(ContentType)) type: ContentType,
    @Param('id', ObjectIdPipe) id: string,
  ) {
    return this.content.readable(type, id, actor);
  }

  @Patch('content/:type/:id/hide')
  @ApiSecurity('csrf')
  @ApiOperation({
    summary:
      'GEN-10 Hide content directly, even when it has no reports; confirm=true required',
  })
  hide(
    @CurrentActor() actor: Actor,
    @Param('type', new ParseEnumPipe(ContentType)) type: ContentType,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: HideContentDto,
  ) {
    return this.reports.direct(
      actor,
      type,
      id,
      ModerationAction.Hide,
      dto.note,
    );
  }

  @Delete('content/:type/:id')
  @ApiSecurity('csrf')
  @ApiOperation({
    summary:
      'GEN-10 Delete content directly after confirmation, with an atomic audit record',
  })
  remove(
    @CurrentActor() actor: Actor,
    @Param('type', new ParseEnumPipe(ContentType)) type: ContentType,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: HideContentDto,
  ) {
    return this.reports.direct(
      actor,
      type,
      id,
      ModerationAction.Delete,
      dto.note,
    );
  }

  @Get('audit-logs')
  @ApiOperation({
    summary: 'GEN-07 Read administrator audit logs, newest first, 10 per page',
  })
  logs(@Query() dto: AuditQueryDto) {
    return this.audit.list(dto);
  }
}

@Public()
@ApiTags('Notifications')
@ApiErrors()
@ApiCookieAuth('session')
@UseGuards(CommunityGuard)
@Access('authenticated')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'GEN-01 List your own notifications, newest first, 10 per page',
  })
  list(@CurrentActor() actor: Actor, @Query() dto: PageDto) {
    return this.notifications.list(actor.id, dto.page);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'GEN-01 Count your unread notifications' })
  count(@CurrentActor() actor: Actor) {
    return this.notifications.unreadCount(actor.id);
  }

  @Patch('read-all')
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'GEN-01 Mark all your notifications as read' })
  readAll(@CurrentActor() actor: Actor) {
    return this.notifications.markAllRead(actor.id);
  }

  @Patch(':id/read')
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'GEN-01 Mark one of your notifications as read' })
  read(@CurrentActor() actor: Actor, @Param('id', ObjectIdPipe) id: string) {
    return this.notifications.markRead(actor.id, id);
  }
}
