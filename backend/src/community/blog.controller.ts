import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Public } from '../auth/decorators/public.decorator';
import { Access, CommunityGuard, CurrentActor } from './auth';
import { BlogService } from './blog.service';
import {
  AuthorQueryDto,
  CommentDto,
  ConfirmDto,
  CreatePostDto,
  MinePostsDto,
  PageDto,
  SearchPostsDto,
  TagParamDto,
  UpdatePostDto,
} from './dto/community.dto';
import { ApiErrors, ObjectIdPipe } from './http';
import { MediaService } from './media.service';
import { MAX_IMAGE_BYTES, MediaTarget } from './types';
import type { Actor } from './types';

export const UploadImages = () =>
  UseInterceptors(
    FilesInterceptor('images', 5, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_BYTES, files: 5, fields: 0 },
    }),
  );
export const ImagesBody = () =>
  ApiBody({
    schema: {
      type: 'object',
      required: ['images'],
      properties: {
        images: {
          type: 'array',
          maxItems: 5,
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  });

@Public()
@ApiTags('Blog')
@ApiErrors()
@UseGuards(CommunityGuard)
@Access('optional')
@Controller('posts')
export class PostsController {
  constructor(
    private readonly blog: BlogService,
    private readonly media: MediaService,
  ) {}

  @Post()
  @Access('user')
  @ApiCookieAuth('session')
  @ApiSecurity('csrf')
  @ApiOperation({
    summary:
      'BLG-01 Create a Draft or Published post; upload images through the image endpoint',
  })
  create(@CurrentActor() actor: Actor, @Body() dto: CreatePostDto) {
    return this.blog.create(actor, dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'BLG-02, BLG-09 Search public posts; score = likes + visible comments, newest breaks ties',
  })
  list(@Query() dto: SearchPostsDto) {
    return this.blog.list(dto);
  }

  @Get('mine')
  @Access('user')
  @ApiCookieAuth('session')
  @ApiOperation({
    summary:
      'BLG-03 List your own posts, including drafts and hidden posts, 10 per page',
  })
  mine(@CurrentActor() actor: Actor, @Query() dto: MinePostsDto) {
    return this.blog.mine(actor, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'BLG-02 View a post with images, counts and the first comments page',
  })
  detail(@Param('id', ObjectIdPipe) id: string, @CurrentActor() actor?: Actor) {
    return this.blog.detail(id, actor);
  }

  @Patch(':id')
  @Access('user')
  @ApiCookieAuth('session')
  @ApiSecurity('csrf')
  @ApiOperation({
    summary:
      'BLG-04, BLG-08 Edit your own post; authors cannot unhide moderated content',
  })
  update(
    @CurrentActor() actor: Actor,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.blog.update(actor, id, dto);
  }

  @Delete(':id')
  @Access('user')
  @ApiCookieAuth('session')
  @ApiSecurity('csrf')
  @ApiOperation({
    summary:
      'BLG-04, GEN-03 Delete your post and its comments, likes and images after confirmation',
  })
  remove(
    @CurrentActor() actor: Actor,
    @Param('id', ObjectIdPipe) id: string,
    @Body() _dto: ConfirmDto,
  ) {
    return this.blog.remove(actor, id);
  }

  @Get(':id/comments')
  @ApiOperation({
    summary: 'BLG-05 List comments in chronological order, 10 per page',
  })
  comments(
    @Param('id', ObjectIdPipe) id: string,
    @Query() dto: PageDto,
    @CurrentActor() actor?: Actor,
  ) {
    return this.blog.comments(id, dto.page, actor);
  }

  @Post(':id/comments')
  @Access('user')
  @ApiCookieAuth('session')
  @ApiSecurity('csrf')
  @ApiOperation({
    summary: 'BLG-05 Add a non-empty comment, at most 500 characters',
  })
  comment(
    @CurrentActor() actor: Actor,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: CommentDto,
  ) {
    return this.blog.addComment(actor, id, dto.body);
  }

  @Post(':id/like')
  @HttpCode(200)
  @Access('user')
  @ApiCookieAuth('session')
  @ApiSecurity('csrf')
  @ApiOperation({
    summary:
      'BLG-06 Like a published post; repeating the request cannot add another like',
  })
  like(@CurrentActor() actor: Actor, @Param('id', ObjectIdPipe) id: string) {
    return this.blog.like(actor, id, true);
  }

  @Delete(':id/like')
  @Access('user')
  @ApiCookieAuth('session')
  @ApiSecurity('csrf')
  @ApiOperation({
    summary: 'BLG-06 Remove your like; repeating the request is safe',
  })
  unlike(@CurrentActor() actor: Actor, @Param('id', ObjectIdPipe) id: string) {
    return this.blog.like(actor, id, false);
  }

  @Post(':id/images')
  @Access('user')
  @ApiCookieAuth('session')
  @ApiSecurity('csrf')
  @ApiConsumes('multipart/form-data')
  @ImagesBody()
  @UploadImages()
  @ApiOperation({
    summary:
      'BLG-10, GEN-08 Upload JPG/PNG images to your post, maximum 5 total and 5 MB each',
  })
  upload(
    @CurrentActor() actor: Actor,
    @Param('id', ObjectIdPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.media.add(actor, MediaTarget.Post, id, files);
  }

  @Delete(':id/images/:imageId')
  @Access('user')
  @ApiCookieAuth('session')
  @ApiSecurity('csrf')
  @ApiOperation({
    summary: 'BLG-10 Remove an image from your post after confirmation',
  })
  removeImage(
    @CurrentActor() actor: Actor,
    @Param('id', ObjectIdPipe) id: string,
    @Param('imageId', ObjectIdPipe) imageId: string,
    @Body() _dto: ConfirmDto,
  ) {
    return this.media.remove(actor, MediaTarget.Post, id, imageId);
  }
}

@Public()
@ApiTags('Comments')
@ApiErrors()
@ApiCookieAuth('session')
@ApiSecurity('csrf')
@UseGuards(CommunityGuard)
@Access('user')
@Controller('comments')
export class CommentsController {
  constructor(private readonly blog: BlogService) {}

  @Patch(':id')
  @ApiOperation({
    summary: 'BLG-07 Edit your own comment, maximum 500 characters',
  })
  edit(
    @CurrentActor() actor: Actor,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: CommentDto,
  ) {
    return this.blog.editComment(actor, id, dto.body);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'BLG-07 Delete your own comment after confirmation',
  })
  remove(
    @CurrentActor() actor: Actor,
    @Param('id', ObjectIdPipe) id: string,
    @Body() _dto: ConfirmDto,
  ) {
    return this.blog.deleteComment(actor, id);
  }
}

@Public()
@ApiTags('Authors and tags')
@ApiErrors()
@UseGuards(CommunityGuard)
@Access('optional')
@Controller()
export class DiscoveryController {
  constructor(private readonly blog: BlogService) {}

  @Get('tags/:tag/posts')
  @ApiOperation({ summary: 'BLG-08 List public posts with this exact tag' })
  tag(@Param() params: TagParamDto, @Query() dto: PageDto) {
    return this.blog.list({ page: dto.page, tag: params.tag });
  }

  @Get('authors/:id')
  @ApiOperation({
    summary:
      'BLG-12 View author name, join date, published posts and public itineraries',
  })
  author(@Param('id', ObjectIdPipe) id: string, @Query() dto: AuthorQueryDto) {
    return this.blog.author(id, dto);
  }
}
