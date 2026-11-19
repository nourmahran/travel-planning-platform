/* oxlint-disable typescript/no-floating-promises -- node:test owns and awaits top-level test registrations */
import { createTestDatabase } from './test-database';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { NestExpressApplication } from '@nestjs/platform-express';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import request, { Test } from 'supertest';
import sharp from 'sharp';
import { createApplication } from './test-app';
import { CommunitySessionsService } from '../../src/community/auth';
import { AuditService } from '../../src/community/audit.service';
import { ContentService } from '../../src/community/content.service';
import { NotificationsService } from '../../src/community/notifications.service';
import { CommunityStore } from '../../src/community/store';
import {
  ContentType,
  MediaTarget,
  NotificationType,
  objectId,
  PostStatus,
  Role,
} from '../../src/community/types';
import { ids, seedFixtures } from './fixtures';

let mongo: MongoMemoryReplSet;
let app: NestExpressApplication;
let store: CommunityStore;
let sessions: CommunitySessionsService;
let notifications: NotificationsService;
let png: Buffer;
let jpeg: Buffer;
type User = 'eyad' | 'sara' | 'admin' | 'hotelModerator' | 'airlineModerator';
let credentials: Record<User, { token: string; csrfToken: string }>;

function as(user: User, call: Test) {
  const session = credentials[user];
  return call
    .set('Cookie', 'session=' + session.token)
    .set('X-CSRF-Token', session.csrfToken);
}

function api() {
  return request(app.getHttpServer());
}

async function post(
  status: PostStatus = PostStatus.Published,
  user: User = 'eyad',
  title = 'Aswan journey',
) {
  const result = await as(user, api().post('/api/posts'))
    .send({
      title,
      body: 'A trip along the Nile.',
      tags: ['Egypt'],
      status,
    })
    .expect(201);
  return result.body._id as string;
}

async function report(type: ContentType, id: string, user: User = 'sara') {
  const result = await as(user, api().post('/api/reports'))
    .send({
      targetType: type,
      targetId: id,
      reason: 'Inappropriate content',
    })
    .expect(201);
  return result.body._id as string;
}

test('BLG-13 attaches only an owned public itinerary and hides it after privacy changes', async () => {
  const created = await as('eyad', api().post('/api/posts'))
    .send({ title: 'Aswan plan', body: 'Our trip', status: 'Published', itineraryId: ids.publicItinerary })
    .expect(201);
  const postId = created.body._id as string;
  const detail = await api().get('/api/posts/' + postId).expect(200);
  assert.equal(detail.body.itinerary.title, 'Aswan weekend');

  await as('sara', api().post('/api/posts'))
    .send({ title: 'Someone else', body: 'Trip', itineraryId: ids.publicItinerary })
    .expect(404);
  await as('eyad', api().post('/api/posts'))
    .send({ title: 'Private trip', body: 'Trip', itineraryId: ids.privateItinerary })
    .expect(404);

  await store.connection.collection('itineraries').updateOne(
    { _id: objectId(ids.publicItinerary) },
    { $set: { visibility: 'Private' } },
  );
  const hidden = await api().get('/api/posts/' + postId).expect(200);
  assert.equal(hidden.body.itinerary, null);
  assert.equal(hidden.body.itineraryId, null);
});

before(
  async () => {
    process.env.NODE_ENV = 'test';
    mongo = await createTestDatabase();
    ({ app } = await createApplication(mongo.getUri('member6_tests'), true));
    store = app.get(CommunityStore);
    sessions = app.get(CommunitySessionsService);
    notifications = app.get(NotificationsService);
    png = await sharp({
      create: { width: 12, height: 12, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();
    jpeg = await sharp(png).jpeg().toBuffer();
  },
  { timeout: 180000 },
);

beforeEach(async () => {
  for (const collection of await store.connection.db!.collections())
    await collection.deleteMany({});
  await seedFixtures(store);
  credentials = {} as typeof credentials;
  for (const user of [
    'eyad',
    'sara',
    'admin',
    'hotelModerator',
    'airlineModerator',
  ] as User[]) {
    credentials[user] = await sessions.issue(ids[user]);
  }
});

after(async () => {
  await app?.close();
  await mongo?.stop();
});

test('Swagger and empty public lists are available without authentication', async () => {
  const docs = await api().get('/api/docs-json').expect(200);
  for (const path of [
    '/api/posts',
    '/api/posts/mine',
    '/api/authors/{id}',
    '/api/admin/reports',
    '/api/admin/audit-logs',
    '/api/notifications/unread-count',
    '/api/activities/{id}/images',
  ]) {
    assert.ok(docs.body.paths[path], path);
  }
  assert.ok(docs.body.components.schemas.CreatePostDto);
  const empty = await api().get('/api/posts').expect(200);
  assert.deepEqual(empty.body.items, []);
  assert.equal(empty.body.pageSize, 10);
  assert.equal(empty.body.message, 'No results found');
  await api().get('/api/docs').expect(200);
});

test('Draft posts are private and appear in the owner list', async () => {
  const id = await post(PostStatus.Draft);
  await api()
    .get('/api/posts/' + id)
    .expect(404);
  await as('sara', api().get('/api/posts/' + id)).expect(404);
  await as('eyad', api().get('/api/posts/' + id)).expect(200);
  await as('admin', api().get('/api/posts/' + id)).expect(200);
  assert.equal((await api().get('/api/posts')).body.total, 0);
  const mine = await as('eyad', api().get('/api/posts/mine')).expect(200);
  assert.equal(mine.body.items[0].status, 'Draft');
  await as('sara', api().post('/api/posts/' + id + '/like')).expect(404);
  await as('sara', api().post('/api/posts/' + id + '/comments'))
    .send({ body: 'Hello' })
    .expect(404);
});

test('Post changes enforce ownership, whitelist fields, and require confirmation for deletion', async () => {
  const id = await post();
  await as('sara', api().patch('/api/posts/' + id))
    .send({ title: 'Stolen' })
    .expect(403);
  await as('admin', api().patch('/api/posts/' + id))
    .send({ title: 'Admin edit' })
    .expect(403);
  await as('eyad', api().patch('/api/posts/' + id))
    .send({ hidden: false })
    .expect(400);
  await as('eyad', api().patch('/api/posts/' + id))
    .send({ authorId: ids.sara })
    .expect(400);
  await as('eyad', api().patch('/api/posts/' + id))
    .send({})
    .expect(400);
  const edited = await as('eyad', api().patch('/api/posts/' + id))
    .send({ title: '  Updated title  ', tags: [' New '] })
    .expect(200);
  assert.equal(edited.body.title, 'Updated title');
  assert.deepEqual(edited.body.tags, ['new']);
  await as('eyad', api().delete('/api/posts/' + id))
    .send({})
    .expect(400);
  await as('eyad', api().delete('/api/posts/' + id))
    .send({ confirm: 'true' })
    .expect(400);
  await as('sara', api().delete('/api/posts/' + id))
    .send({ confirm: true })
    .expect(403);
  await as('eyad', api().delete('/api/posts/' + id))
    .send({ confirm: true })
    .expect(200);
  await api()
    .get('/api/posts/' + id)
    .expect(404);
});

test('Validation rejects blank fields, invalid tags, nulls, invalid IDs and malformed pagination', async () => {
  for (const body of [
    {},
    { title: ' ', body: 'Text' },
    { title: 'Title', body: ' ' },
    { title: 'Title', body: 'Text', tags: ['a', 'b', 'c', 'd', 'e', 'f'] },
    { title: 'Title', body: 'Text', tags: ['x'.repeat(31)] },
    { title: 'Title', body: 'Text', tags: ['Egypt', ' egypt '] },
    { title: 'Title', body: 'Text', tags: [''] },
    { title: 'Title', body: 'Text', tags: 'egypt' },
    { title: 'Title', body: 'Text', tags: null },
    { title: 'Title', body: 'Text', status: null },
    { title: 'Title', body: 'Text', status: 'Anything' },
  ]) {
    const result = await as('eyad', api().post('/api/posts'))
      .send(body)
      .expect(400);
    assert.ok(result.body.errors);
  }
  const id = await post();
  for (const field of ['title', 'body', 'tags', 'status']) {
    await as('eyad', api().patch('/api/posts/' + id))
      .send({ [field]: null })
      .expect(400);
  }
  await api().get('/api/posts/bad-id').expect(400);
  for (const page of ['0', '-1', '1.5', 'abc', '100001'])
    await api()
      .get('/api/posts?page=' + page)
      .expect(400);
  await api().get('/api/posts?pageSize=100').expect(400);
  await api().get('/api/posts?q[$ne]=x').expect(400);
});

test('Search matches title, tags and author name, ranks by interactions, and uses newest as tie-breaker', async () => {
  const old = await post(PostStatus.Published, 'eyad', 'First story');
  const newer = await post(PostStatus.Published, 'eyad', 'Second story');
  const popular = await post(PostStatus.Published, 'sara', 'A Cairo guide');
  await store.posts.updateOne(
    { _id: objectId(old) },
    { $set: { publishedAt: new Date('2026-01-01') } },
  );
  await store.posts.updateOne(
    { _id: objectId(newer) },
    { $set: { publishedAt: new Date('2026-01-02') } },
  );
  await as('eyad', api().post('/api/posts/' + popular + '/like')).expect(200);
  await as('eyad', api().post('/api/posts/' + popular + '/comments'))
    .send({ body: 'Useful' })
    .expect(201);
  const result = await api().get('/api/posts?q=egypt').expect(200);
  assert.deepEqual(
    result.body.items.map((item: { _id: string }) => item._id),
    [popular, newer, old],
  );
  assert.equal(result.body.items[0].interactionScore, 2);
  assert.ok(result.body.items[0].excerpt);
  assert.equal((await api().get('/api/posts?q=El%20Safty')).body.total, 2);
  assert.equal((await api().get('/api/posts?q=Cairo')).body.total, 1);
  assert.equal((await api().get('/api/posts?q=%5B')).body.total, 0);
  assert.equal((await api().get('/api/tags/EGYPT/posts')).body.total, 3);
  assert.equal((await api().get('/api/posts?tag=missing')).body.total, 0);
});

test('Public and personal lists have fixed ten-item pages', async () => {
  for (let index = 0; index < 11; index++)
    await post(PostStatus.Published, 'eyad', 'Story ' + index);
  const first = await api().get('/api/posts').expect(200);
  const second = await api().get('/api/posts?page=2').expect(200);
  assert.equal(first.body.total, 11);
  assert.equal(first.body.items.length, 10);
  assert.equal(second.body.items.length, 1);
  assert.equal(first.body.totalPages, 2);
  assert.equal(
    (await as('eyad', api().get('/api/posts/mine?page=2'))).body.items.length,
    1,
  );
  assert.equal((await api().get('/api/posts?page=3')).body.items.length, 0);
});

test('Comments enforce 500-character limit, chronology, pagination, editing and ownership', async () => {
  const id = await post();
  await as('sara', api().post('/api/posts/' + id + '/comments'))
    .send({ body: ' ' })
    .expect(400);
  await as('sara', api().post('/api/posts/' + id + '/comments'))
    .send({ body: 'a'.repeat(501) })
    .expect(400);
  const first = await as('sara', api().post('/api/posts/' + id + '/comments'))
    .send({ body: 'a'.repeat(500) })
    .expect(201);
  for (let index = 0; index < 10; index++) {
    await as('eyad', api().post('/api/posts/' + id + '/comments'))
      .send({ body: 'Comment ' + index })
      .expect(201);
  }
  const listed = await api()
    .get('/api/posts/' + id + '/comments')
    .expect(200);
  assert.equal(listed.body.total, 11);
  assert.equal(listed.body.items.length, 10);
  assert.equal(listed.body.items[0]._id, first.body._id);
  assert.equal(
    (await api().get('/api/posts/' + id + '/comments?page=2')).body.items
      .length,
    1,
  );
  await as('eyad', api().patch('/api/comments/' + first.body._id))
    .send({ body: 'Unauthorized' })
    .expect(403);
  await as('sara', api().patch('/api/comments/' + first.body._id))
    .send({ body: 'Edited' })
    .expect(200);
  await as('sara', api().delete('/api/comments/' + first.body._id))
    .send({})
    .expect(400);
  await as('sara', api().delete('/api/comments/' + first.body._id))
    .send({ confirm: true })
    .expect(200);
  assert.equal((await api().get('/api/posts/' + id)).body.commentCount, 10);
});

test('Concurrent likes are idempotent and the database rejects duplicate likes', async () => {
  const id = await post();
  const responses = await Promise.all(
    Array.from({ length: 8 }, () =>
      as('sara', api().post('/api/posts/' + id + '/like')),
    ),
  );
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(await store.likes.countDocuments({ postId: objectId(id) }), 1);
  await assert.rejects(
    store.likes.create({ postId: objectId(id), userId: objectId(ids.sara) }),
    (error: unknown) => (error as { code: number }).code === 11000,
  );
  assert.equal((await api().get('/api/posts/' + id)).body.likeCount, 1);
  await as('sara', api().delete('/api/posts/' + id + '/like')).expect(200);
  await as('sara', api().delete('/api/posts/' + id + '/like')).expect(200);
  assert.equal((await api().get('/api/posts/' + id)).body.likeCount, 0);
});

test('Media upload validates actual bytes, MIME, extension, size, and ownership', async () => {
  const id = await post();
  const endpoint = '/api/posts/' + id + '/images';
  await as('sara', api().post(endpoint))
    .attach('images', png, 'trip.png')
    .expect(403);
  await as('eyad', api().post(endpoint)).expect(400);
  await as('eyad', api().post(endpoint))
    .attach('images', Buffer.from('fake'), {
      filename: 'fake.jpg',
      contentType: 'image/jpeg',
    })
    .expect(400);
  await as('eyad', api().post(endpoint))
    .attach('images', png, { filename: 'wrong.jpg', contentType: 'image/jpeg' })
    .expect(400);
  await as('eyad', api().post(endpoint))
    .attach('images', png.subarray(0, 25), 'broken.png')
    .expect(400);
  await as('eyad', api().post(endpoint))
    .attach('images', Buffer.alloc(5 * 1024 * 1024 + 1), 'large.png')
    .expect(413);
  const saved = await as('eyad', api().post(endpoint))
    .attach('images', png, 'trip.png')
    .attach('images', jpeg, 'trip.jpg')
    .expect(201);
  assert.equal(saved.body.length, 2);
  const image = await api().get(saved.body[0].url).expect(200);
  assert.match(image.headers['content-type'], /image\/png/);
  assert.equal(image.headers['cache-control'], 'private, no-store');
  assert.equal((await api().get('/api/posts/' + id)).body.images.length, 2);
  const other = await post();
  await as(
    'eyad',
    api().delete('/api/posts/' + other + '/images/' + saved.body[0].id),
  )
    .send({ confirm: true })
    .expect(404);
  await as('eyad', api().delete(endpoint + '/' + saved.body[0].id))
    .send({ confirm: true })
    .expect(200);
  await api().get(saved.body[0].url).expect(404);
});

test('Concurrent uploads cannot exceed five images and failed batches are atomic', async () => {
  const id = await post();
  const endpoint = '/api/posts/' + id + '/images';
  const responses = await Promise.all(
    Array.from({ length: 6 }, () =>
      as('eyad', api().post(endpoint)).attach('images', png, 'trip.png'),
    ),
  );
  assert.equal(
    responses.filter((response) => response.status === 201).length,
    5,
  );
  assert.equal(
    responses.filter((response) => response.status === 400).length,
    1,
  );
  assert.equal(await store.media.countDocuments({ targetId: objectId(id) }), 5);
  const image = await store.media.findOne({ targetId: objectId(id) });
  await as('eyad', api().delete(endpoint + '/' + image!._id.toString()))
    .send({ confirm: true })
    .expect(200);
  await as('eyad', api().post(endpoint))
    .attach('images', png, 'a.png')
    .attach('images', png, 'b.png')
    .expect(400);
  assert.equal(await store.media.countDocuments({ targetId: objectId(id) }), 4);
});

test('Shared media checks hotel/airline assignments and activity itinerary ownership', async () => {
  const hotel = '/api/media/hotel/' + ids.hotel + '/images';
  await as('eyad', api().post(hotel))
    .attach('images', png, 'hotel.png')
    .expect(403);
  await as(
    'hotelModerator',
    api().post('/api/media/hotel/' + ids.otherHotel + '/images'),
  )
    .attach('images', png, 'hotel.png')
    .expect(403);
  for (let index = 0; index < 5; index++) {
    await as('hotelModerator', api().post(hotel))
      .attach('images', png, 'hotel.png')
      .expect(201);
  }
  await as('admin', api().post(hotel))
    .attach('images', png, 'hotel.png')
    .expect(400);
  const airline = '/api/media/airline/' + ids.airline + '/images';
  await as('airlineModerator', api().post(airline))
    .attach('images', png, 'logo.png')
    .expect(201);
  await as('airlineModerator', api().post(airline))
    .attach('images', png, 'logo.png')
    .expect(400);
  const activity = '/api/activities/' + ids.privateActivity + '/images';
  await as('sara', api().post(activity))
    .attach('images', png, 'trip.png')
    .expect(403);
  const saved = await as('eyad', api().post(activity))
    .attach('images', png, 'trip.png')
    .expect(201);
  await api().get(saved.body[0].url).expect(404);
  await as('eyad', api().get(saved.body[0].url)).expect(200);
  await as('admin', api().get(saved.body[0].url)).expect(200);
});

test('Reporting requires login, public content and a reason, with lifetime duplicate prevention', async () => {
  const id = await post();
  const body = { targetType: 'post', targetId: id, reason: 'Abuse' };
  await api().post('/api/reports').send(body).expect(401);
  await as('sara', api().post('/api/reports'))
    .send({ ...body, reason: ' ' })
    .expect(400);
  const responses = await Promise.all(
    [1, 2].map(() => as('sara', api().post('/api/reports')).send(body)),
  );
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [201, 409],
  );
  const created = responses.find((response) => response.status === 201)!;
  await as('admin', api().patch('/api/admin/reports/' + created.body._id))
    .send({ action: 'dismiss' })
    .expect(200);
  await as('sara', api().post('/api/reports')).send(body).expect(409);
  assert.equal((await api().get('/api/posts/' + id)).status, 200);
  await as('sara', api().post('/api/reports'))
    .send({ ...body, targetId: new Types.ObjectId().toString() })
    .expect(404);
  await as('sara', api().post('/api/reports'))
    .send({
      targetType: 'itinerary',
      targetId: ids.privateItinerary,
      reason: 'Abuse',
    })
    .expect(404);
});

test('Moderation is administrator-only, requires confirmation, closes reports and hides media', async () => {
  const id = await post();
  const images = await as('eyad', api().post('/api/posts/' + id + '/images'))
    .attach('images', png, 'trip.png')
    .expect(201);
  const first = await report(ContentType.Post, id);
  await report(ContentType.Post, id, 'eyad');
  await as('eyad', api().get('/api/admin/reports')).expect(403);
  assert.equal(
    (await as('admin', api().get('/api/admin/reports')).expect(200)).body.total,
    2,
  );
  await as('admin', api().patch('/api/admin/reports/' + first))
    .send({ action: 'hide' })
    .expect(400);
  await as('admin', api().patch('/api/admin/reports/' + first))
    .send({ action: 'hide', confirm: true, note: 'Abuse confirmed' })
    .expect(200);
  await api()
    .get('/api/posts/' + id)
    .expect(404);
  await api().get(images.body[0].url).expect(404);
  await as('eyad', api().get('/api/posts/' + id)).expect(200);
  await as('admin', api().get('/api/posts/' + id)).expect(200);
  await as('eyad', api().get(images.body[0].url)).expect(200);
  await as('eyad', api().patch('/api/posts/' + id))
    .send({ title: 'Changed', status: 'Published' })
    .expect(200);
  await api()
    .get('/api/posts/' + id)
    .expect(404);
  assert.equal(
    (await as('admin', api().get('/api/admin/reports'))).body.total,
    0,
  );
  assert.equal(
    (await as('admin', api().get('/api/admin/reports?status=Hidden'))).body
      .total,
    2,
  );
  await as('admin', api().patch('/api/admin/reports/' + first))
    .send({ action: 'dismiss' })
    .expect(409);
  const audits = await as('admin', api().get('/api/admin/audit-logs')).expect(
    200,
  );
  assert.equal(audits.body.items[0].action, 'content.hidden');
  assert.equal(audits.body.items[0].actorId, ids.admin);
  assert.equal(audits.body.items[0].details.note, 'Abuse confirmed');
});

test('Failed audit persistence rolls back moderation and report resolution together', async () => {
  const id = await post();
  const reportId = await report(ContentType.Post, id);
  const audit = app.get(AuditService);
  const original = audit.record;
  audit.record = async () => {
    throw new Error('Simulated audit write failure');
  };
  try {
    await as('admin', api().patch('/api/admin/reports/' + reportId))
      .send({ action: 'hide', confirm: true })
      .expect(500);
  } finally {
    audit.record = original;
  }
  assert.equal((await store.posts.findById(id))!.hidden, false);
  assert.equal((await store.reports.findById(reportId))!.status, 'Open');
  assert.equal(await store.audits.countDocuments(), 0);
});

test('Hidden comments are visible only to their own author/admin and stop contributing to public scores', async () => {
  const id = await post();
  const comment = await as('sara', api().post('/api/posts/' + id + '/comments'))
    .send({ body: 'Reported text' })
    .expect(201);
  await report(ContentType.Comment, comment.body._id, 'eyad');
  await as(
    'admin',
    api().patch('/api/admin/content/comment/' + comment.body._id + '/hide'),
  )
    .send({ confirm: true })
    .expect(200);
  assert.equal(
    (await api().get('/api/posts/' + id + '/comments')).body.total,
    0,
  );
  assert.equal(
    (await as('eyad', api().get('/api/posts/' + id + '/comments'))).body.total,
    0,
  );
  assert.equal(
    (await as('sara', api().get('/api/posts/' + id + '/comments'))).body.total,
    1,
  );
  assert.equal(
    (await as('admin', api().get('/api/posts/' + id + '/comments'))).body.total,
    1,
  );
  assert.equal(
    (await api().get('/api/posts')).body.items[0].interactionScore,
    0,
  );
  await as('sara', api().patch('/api/comments/' + comment.body._id))
    .send({ body: 'Edited hidden text' })
    .expect(200);
  assert.equal((await store.comments.findById(comment.body._id))!.hidden, true);
});

test('Administrator deletion removes a post, comments, likes and images and resolves child reports', async () => {
  const id = await post();
  const comment = await as('sara', api().post('/api/posts/' + id + '/comments'))
    .send({ body: 'Comment' })
    .expect(201);
  await as('sara', api().post('/api/posts/' + id + '/like')).expect(200);
  const images = await as('eyad', api().post('/api/posts/' + id + '/images'))
    .attach('images', png, 'trip.png')
    .expect(201);
  const postReport = await report(ContentType.Post, id);
  const commentReport = await report(
    ContentType.Comment,
    comment.body._id,
    'eyad',
  );
  await as('admin', api().delete('/api/admin/content/post/' + id))
    .send({ confirm: true })
    .expect(200);
  for (const model of [store.posts, store.comments, store.likes, store.media])
    assert.equal(await model.countDocuments(), 0);
  assert.equal((await store.reports.findById(postReport))!.status, 'Deleted');
  assert.equal(
    (await store.reports.findById(commentReport))!.status,
    'Deleted',
  );
  await api().get(images.body[0].url).expect(404);
  await as('eyad', api().get('/api/posts/' + id)).expect(404);
});

test('Review moderation updates hotel rating and itinerary deletion preserves independent clones', async () => {
  const reviewReport = await report(ContentType.Review, ids.review);
  await as('admin', api().patch('/api/admin/reports/' + reviewReport))
    .send({ action: 'hide', confirm: true })
    .expect(200);
  let hotel = await store.connection
    .collection('hotels')
    .findOne({ _id: objectId(ids.hotel) });
  assert.equal(hotel!.averageRating, 1);
  assert.equal(hotel!.ratingCount, 1);
  await as(
    'admin',
    api().delete('/api/admin/content/review/' + ids.otherReview),
  )
    .send({ confirm: true })
    .expect(200);
  hotel = await store.connection
    .collection('hotels')
    .findOne({ _id: objectId(ids.hotel) });
  assert.equal(hotel!.averageRating, 0);
  assert.equal(hotel!.ratingCount, 0);
  const clone = new Types.ObjectId();
  await store.connection.collection('itineraries').insertOne({
    _id: clone,
    authorId: objectId(ids.sara),
    visibility: 'Private',
    originalItineraryId: objectId(ids.publicItinerary),
  });
  await as('eyad', api().post('/api/activities/' + ids.activity + '/images'))
    .attach('images', png, 'trip.png')
    .expect(201);
  const itineraryReport = await report(
    ContentType.Itinerary,
    ids.publicItinerary,
  );
  await as('admin', api().patch('/api/admin/reports/' + itineraryReport))
    .send({ action: 'delete', confirm: true })
    .expect(200);
  assert.ok(
    await store.connection.collection('itineraries').findOne({ _id: clone }),
  );
  for (const name of [
    'activities',
    'itinerary_days',
    'budgets',
    'transport_costs',
  ]) {
    assert.equal(
      await store.connection
        .collection(name)
        .countDocuments({ itineraryId: objectId(ids.publicItinerary) }),
      0,
    );
  }
  assert.equal(
    await store.media.countDocuments({ targetId: objectId(ids.activity) }),
    0,
  );
});

test('Author pages expose only public profile fields, posts and public itineraries', async () => {
  const published = await post();
  await post(PostStatus.Draft);
  const page = await api()
    .get('/api/authors/' + ids.eyad)
    .expect(200);
  assert.equal(page.body.name, 'Eyad El Safty');
  assert.ok(page.body.joinedAt);
  assert.equal(page.body.posts.total, 1);
  assert.equal(page.body.posts.items[0]._id, published);
  assert.equal(page.body.itineraries.total, 1);
  assert.equal(page.body.itineraries.items[0]._id, ids.publicItinerary);
  assert.equal(page.body.email, undefined);
  assert.equal(page.body.passwordHash, undefined);
  await as(
    'admin',
    api().patch(
      '/api/admin/content/itinerary/' + ids.publicItinerary + '/hide',
    ),
  )
    .send({ confirm: true })
    .expect(200);
  assert.equal(
    (await api().get('/api/authors/' + ids.eyad)).body.itineraries.total,
    0,
  );
});

test('Deactivation hides authored posts and itineraries while comments use Deleted user; suspension retains public posts', async () => {
  const eyadPost = await post();
  const saraPost = await post(PostStatus.Published, 'sara');
  await as('eyad', api().post('/api/posts/' + saraPost + '/comments'))
    .send({ body: 'Old comment' })
    .expect(201);
  await store.connection
    .collection('users')
    .updateOne(
      { _id: objectId(ids.eyad) },
      { $set: { status: 'deactivated' } },
    );
  await api()
    .get('/api/posts/' + eyadPost)
    .expect(404);
  await api()
    .get('/api/authors/' + ids.eyad)
    .expect(404);
  assert.equal((await api().get('/api/posts?q=El%20Safty')).body.total, 0);
  assert.equal(
    (await api().get('/api/posts/' + saraPost + '/comments')).body.items[0]
      .author.name,
    'Deleted user',
  );
  await as('eyad', api().get('/api/posts/mine')).expect(401);
  await store.connection
    .collection('users')
    .updateOne({ _id: objectId(ids.sara) }, { $set: { status: 'suspended' } });
  await api()
    .get('/api/posts/' + saraPost)
    .expect(200);
  await as('sara', api().get('/api/posts/mine')).expect(401);
});

test('Notifications cover every required event, deduplicate, paginate and enforce recipient-only read access', async () => {
  const types = Object.values(NotificationType);
  for (let index = 0; index < 11; index++) {
    await notifications.send({
      recipientId: ids.eyad,
      eventId: 'event-' + index,
      type: types[index % types.length],
      title: 'Booking update',
      message: 'A required event occurred.',
      link: '/bookings/example',
    });
  }
  const same = {
    recipientId: ids.eyad,
    eventId: 'same-event',
    type: NotificationType.RefundUpdated,
    title: 'Refund updated',
    message: 'Your refund was processed.',
  };
  await Promise.all(Array.from({ length: 8 }, () => notifications.send(same)));
  assert.equal(await store.notifications.countDocuments(), 12);
  assert.equal(
    (await as('eyad', api().get('/api/notifications'))).body.items.length,
    10,
  );
  assert.equal(
    (await as('eyad', api().get('/api/notifications?page=2'))).body.items
      .length,
    2,
  );
  assert.equal(
    (await as('eyad', api().get('/api/notifications/unread-count'))).body
      .unreadCount,
    12,
  );
  assert.equal(
    (await as('sara', api().get('/api/notifications'))).body.total,
    0,
  );
  const notification = await store.notifications.findOne({
    eventId: 'same-event',
  });
  await as(
    'sara',
    api().patch('/api/notifications/' + notification!._id + '/read'),
  ).expect(404);
  const read = await as(
    'eyad',
    api().patch('/api/notifications/' + notification!._id + '/read'),
  ).expect(200);
  const again = await as(
    'eyad',
    api().patch('/api/notifications/' + notification!._id + '/read'),
  ).expect(200);
  assert.equal(read.body.readAt, again.body.readAt);
  await notifications.send(same);
  assert.equal(
    (await as('eyad', api().get('/api/notifications/unread-count'))).body
      .unreadCount,
    11,
  );
  await as('eyad', api().patch('/api/notifications/read-all')).expect(200);
  assert.equal(
    (await as('eyad', api().get('/api/notifications/unread-count'))).body
      .unreadCount,
    0,
  );
});

test('Authentication rejects forged identity, invalid sessions, missing CSRF and expired inactivity', async () => {
  await api()
    .post('/api/posts')
    .set('X-User-Id', ids.admin)
    .send({ title: 'Fake', body: 'Fake' })
    .expect(401);
  await api().get('/api/posts/mine').set('Cookie', 'session=fake').expect(401);
  await api()
    .post('/api/posts')
    .set('Cookie', 'session=' + credentials.eyad.token)
    .send({ title: 'X', body: 'X' })
    .expect(403);
  await as('eyad', api().get('/api/admin/audit-logs'))
    .set('X-Role', 'admin')
    .expect(403);
  await store.sessions.updateMany(
    { userId: objectId(ids.eyad) },
    { $set: { lastSeenAt: new Date(Date.now() - 31 * 60 * 1000) } },
  );
  await as('eyad', api().get('/api/posts/mine')).expect(401);
  await sessions.revoke(credentials.sara.token);
  await as('sara', api().get('/api/posts/mine')).expect(401);
});

test('Concurrent deletion, commenting and liking cannot leave orphaned interactions', async () => {
  const id = await post();
  const results = await Promise.all([
    as('sara', api().post('/api/posts/' + id + '/comments')).send({
      body: 'Concurrent comment',
    }),
    as('sara', api().post('/api/posts/' + id + '/like')),
    as('eyad', api().delete('/api/posts/' + id)).send({ confirm: true }),
  ]);
  assert.ok([201, 404].includes(results[0].status));
  assert.ok([200, 404].includes(results[1].status));
  assert.equal(results[2].status, 200);
  assert.equal(await store.posts.countDocuments({ _id: objectId(id) }), 0);
  assert.equal(
    await store.comments.countDocuments({ postId: objectId(id) }),
    0,
  );
  assert.equal(await store.likes.countDocuments({ postId: objectId(id) }), 0);
});

test('Publishing and returning a post to Draft immediately change public and image access', async () => {
  const id = await post(PostStatus.Draft);
  const images = await as('eyad', api().post('/api/posts/' + id + '/images'))
    .attach('images', png, 'trip.png')
    .expect(201);
  await api().get(images.body[0].url).expect(404);
  const published = await as('eyad', api().patch('/api/posts/' + id))
    .send({ status: 'Published' })
    .expect(200);
  assert.ok(published.body.publishedAt);
  await api()
    .get('/api/posts/' + id)
    .expect(200);
  await api().get(images.body[0].url).expect(200);
  await as('eyad', api().patch('/api/posts/' + id))
    .send({ status: 'Draft' })
    .expect(200);
  await api()
    .get('/api/posts/' + id)
    .expect(404);
  await api().get(images.body[0].url).expect(404);
  assert.equal((await api().get('/api/posts')).body.total, 0);
});

test('Unicode character limits are consistent between DTOs and MongoDB schemas', async () => {
  const id = await post();
  await as('sara', api().post('/api/posts/' + id + '/comments'))
    .send({ body: '🌍'.repeat(500) })
    .expect(201);
  await as('sara', api().post('/api/posts/' + id + '/comments'))
    .send({ body: '🌍'.repeat(501) })
    .expect(400);
  await as('eyad', api().patch('/api/posts/' + id))
    .send({ tags: ['🌍'.repeat(30)] })
    .expect(200);
  await as('eyad', api().patch('/api/posts/' + id))
    .send({ tags: ['🌍'.repeat(31)] })
    .expect(400);
  await api()
    .get('/api/tags/' + 'x'.repeat(31) + '/posts')
    .expect(400);
});

test('Author itinerary lists paginate independently and hide private and moderated entries', async () => {
  for (let index = 0; index < 10; index++) {
    await store.connection.collection('itineraries').insertOne({
      authorId: objectId(ids.eyad),
      title: 'Public trip ' + index,
      visibility: 'Public',
      hidden: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  const first = await api()
    .get('/api/authors/' + ids.eyad)
    .expect(200);
  const second = await api()
    .get('/api/authors/' + ids.eyad + '?itinerariesPage=2')
    .expect(200);
  assert.equal(first.body.itineraries.total, 11);
  assert.equal(first.body.itineraries.items.length, 10);
  assert.equal(second.body.itineraries.items.length, 1);
  const content = app.get(ContentService);
  await as(
    'admin',
    api().patch(
      '/api/admin/content/itinerary/' + ids.publicItinerary + '/hide',
    ),
  )
    .send({ confirm: true })
    .expect(200);
  await assert.rejects(
    content.readable(ContentType.Itinerary, ids.publicItinerary),
  );
  await content.readable(ContentType.Itinerary, ids.publicItinerary, {
    id: ids.eyad,
    name: 'Eyad',
    role: Role.User,
  });
  await assert.rejects(
    content.readable(ContentType.Itinerary, ids.publicItinerary, {
      id: ids.sara,
      name: 'Sara',
      role: Role.User,
    }),
  );
  await content.readable(ContentType.Itinerary, ids.publicItinerary, {
    id: ids.admin,
    name: 'Admin',
    role: Role.Admin,
  });
});

test('Activity image limits and hidden itinerary/provider image permissions are enforced', async () => {
  const endpoint = '/api/activities/' + ids.activity + '/images';
  let imageUrl = '';
  for (let index = 0; index < 5; index++) {
    const saved = await as('eyad', api().post(endpoint))
      .attach('images', png, 'trip.png')
      .expect(201);
    imageUrl = saved.body[0].url;
  }
  await as('eyad', api().post(endpoint))
    .attach('images', png, 'trip.png')
    .expect(400);
  await api().get(imageUrl).expect(200);
  await as(
    'admin',
    api().patch(
      '/api/admin/content/itinerary/' + ids.publicItinerary + '/hide',
    ),
  )
    .send({ confirm: true })
    .expect(200);
  await api().get(imageUrl).expect(404);
  await as('eyad', api().get(imageUrl)).expect(200);
  const hotelImage = await as(
    'hotelModerator',
    api().post('/api/media/hotel/' + ids.hotel + '/images'),
  )
    .attach('images', png, 'hotel.png')
    .expect(201);
  await store.connection
    .collection('hotels')
    .updateOne({ _id: objectId(ids.hotel) }, { $set: { active: false } });
  await api().get(hotelImage.body[0].url).expect(404);
  await as('hotelModerator', api().get(hotelImage.body[0].url)).expect(200);
  await as('admin', api().get(hotelImage.body[0].url)).expect(200);
});

test('Audit APIs paginate and filter; shared audit service rejects non-admin callers', async () => {
  const audit = app.get(AuditService);
  for (let index = 0; index < 11; index++) {
    await audit.record(
      { id: ids.admin, name: 'Administrator', role: Role.Admin },
      {
        action: 'account.suspended',
        targetType: 'account',
        targetId: ids.sara,
      },
    );
  }
  await assert.rejects(
    audit.record(
      { id: ids.eyad, name: 'Eyad', role: Role.User },
      {
        action: 'account.suspended',
        targetType: 'account',
        targetId: ids.sara,
      },
    ),
  );
  const result = await as(
    'admin',
    api().get(
      '/api/admin/audit-logs?action=account.suspended&actorId=' + ids.admin,
    ),
  ).expect(200);
  assert.equal(result.body.total, 11);
  assert.equal(result.body.items.length, 10);
  assert.equal(
    (await as('admin', api().get('/api/admin/audit-logs?page=2'))).body.items
      .length,
    1,
  );
  await as(
    'admin',
    api().delete('/api/admin/audit-logs/' + result.body.items[0]._id),
  )
    .send({ confirm: true })
    .expect(404);
});
