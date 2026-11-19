import {
  DynamicModule,
  Module,
  ModuleMetadata,
  Provider,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CommunityGuard,
  CommunityIdentity,
  CommunitySessionsService,
  MongoSessionIdentity,
} from './auth';
import { AuditService } from './audit.service';
import { BlogService } from './blog.service';
import {
  CommentsController,
  DiscoveryController,
  PostsController,
} from './blog.controller';
import { ContentService } from './content.service';
import { MediaService } from './media.service';
import { NotificationsService } from './notifications.service';
import { ReportsService } from './reports.service';
import { communityModels } from './schemas/community.schemas';
import {
  MediaController,
  ModerationController,
  NotificationsController,
  ReportsController,
} from './shared.controller';
import { CommunityStore } from './store';
import { TeamBridge } from './team.bridge';

@Module({})
export class CommunityModule {
  static register(
    options: {
      imports?: ModuleMetadata['imports'];
      identityProvider?: Provider;
      bridgeProvider?: Provider;
    } = {},
  ): DynamicModule {
    return {
      module: CommunityModule,
      imports: [
        MongooseModule.forFeature(communityModels),
        ...(options.imports ?? []),
      ],
      controllers: [
        PostsController,
        CommentsController,
        DiscoveryController,
        MediaController,
        ReportsController,
        ModerationController,
        NotificationsController,
      ],
      providers: [
        CommunityStore,
        BlogService,
        ContentService,
        MediaService,
        NotificationsService,
        ReportsService,
        AuditService,
        CommunitySessionsService,
        CommunityGuard,
        options.bridgeProvider ?? TeamBridge,
        options.identityProvider ?? {
          provide: CommunityIdentity,
          useClass: MongoSessionIdentity,
        },
      ],
      exports: [
        CommunityStore,
        BlogService,
        ContentService,
        MediaService,
        NotificationsService,
        ReportsService,
        AuditService,
        CommunitySessionsService,
        CommunityIdentity,
        TeamBridge,
      ],
    };
  }
}
