/* eslint-disable */
'use strict';
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

module.exports = {
  name: '6. Blog, community and moderation',
  async run(ctx, H) {
    const { guest, check, expectStatus: st, idOf, items, PNG_1PX, GIF_1PX, imageForm } = H;
    const db = ctx.db; const admin = ctx.admin;
    let r;
    const author = await H.newUser(db, 'author');
    const reader = await H.newUser(db, 'reader');
    const third = await H.newUser(db, 'third');
    const tag = 'qa' + Date.now().toString(36);

    // BLG-01 / BLG-08
    r = await guest.post('/posts', { title: 'Guest post', body: 'Not allowed' }); st('ACC-10', 'POST', '/posts', 'guest must log in to post', r, 401);
    r = await author.post('/posts', { body: 'No title' }); st('BLG-01', 'POST', '/posts', 'title required', r, 400);
    r = await author.post('/posts', { title: 'T', body: 'B', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }); st('BLG-08', 'POST', '/posts', 'more than 5 tags rejected', r, 400);
    r = await author.post('/posts', { title: 'T', body: 'B', tags: ['x'.repeat(31)] }); st('BLG-08', 'POST', '/posts', 'tag over 30 chars rejected', r, 400);
    r = await author.post('/posts', { title: 'Draft about Aswan', body: 'Draft body text.', status: 'Draft', tags: [tag] }); st('BLG-01', 'POST', '/posts', 'save draft', r, 201);
    const draft = idOf(r.body);
    r = await guest.get(`/posts/${draft}`); st('BLG-01', 'GET', '/posts/:id', 'draft hidden from public', r, 404);
    r = await reader.get(`/posts/${draft}`); st('BLG-01', 'GET', '/posts/:id', 'draft hidden from other users', r, 404);
    r = await author.get(`/posts/${draft}`); st('BLG-01', 'GET', '/posts/:id', 'author sees own draft', r, 200);
    r = await author.post('/posts', { title: 'Nile sunset cruise', body: 'We sailed down the Nile at sunset. Highly recommended.', status: 'Published', tags: [tag, 'egypt'] }); st('BLG-01', 'POST', '/posts', 'publish post', r, 201);
    const post = idOf(r.body);
    r = await author.post('/posts', { title: 'Second Nile story', body: 'Another short story.', status: 'Published', tags: [tag] });
    const post2 = idOf(r.body);

    // BLG-02 / BLG-09 / BLG-08 tag listing
    r = await guest.get(`/posts?tag=${tag}`); st('BLG-02', 'GET', '/posts', 'public list filtered by tag', r, 200);
    const listed = items(r.body).map(idOf);
    check('BLG-02', 'GET /posts?tag=', 'published posts only (no draft)', '2 posts', listed.length, listed.includes(post) && listed.includes(post2) && !listed.includes(draft));
    r = await guest.get(`/tags/${tag}/posts`); st('BLG-08', 'GET', '/tags/:tag/posts', 'click tag to list posts', r, 200);
    r = await guest.get(`/posts/${post}`); st('BLG-02', 'GET', '/posts/:id', 'post page', r, 200);
    check('BLG-02', 'GET /posts/:id', 'shows author, tags, like count', 'present', ['title', 'tags'].filter((k) => !(k in (r.body || {}))).join(',') || 'present', r.body?.title && Array.isArray(r.body?.tags) && JSON.stringify(r.body).match(/like/i));
    r = await author.get('/posts/mine'); st('BLG-03', 'GET', '/posts/mine', 'own posts incl. drafts', r, 200);
    check('BLG-03', 'GET /posts/mine', 'includes the draft', draft, items(r.body).map(idOf).includes(draft) ? 'present' : 'missing', items(r.body).map(idOf).includes(draft));

    // BLG-04 edit/delete own
    r = await author.patch(`/posts/${post}`, { title: 'Nile sunset cruise (edited)' }); st('BLG-04', 'PATCH', '/posts/:id', 'edit own post', r, 200);
    r = await author.patch(`/posts/${post}`, {}); st('BLG-04', 'PATCH', '/posts/:id', 'empty edit rejected', r, 400);
    r = await reader.patch(`/posts/${post}`, { title: 'Hijack' }); st('BLG-04', 'PATCH', '/posts/:id', "cannot edit someone else's post", r, 403);
    r = await reader.del(`/posts/${post}`, { confirm: true }); st('BLG-04', 'DELETE', '/posts/:id', "cannot delete someone else's post", r, 403);
    r = await author.del(`/posts/${post2}`, {}); st('GEN-03', 'DELETE', '/posts/:id', 'delete requires confirmation', r, 400);

    // BLG-10 images
    r = await author.raw('POST', `/posts/${post}/images`, imageForm('images', [{ data: PNG_1PX, type: 'image/png', name: 'p.png' }])); st('BLG-10', 'POST', '/posts/:id/images', 'attach PNG', r, [200, 201]);
    const imgId = /"id":"([0-9a-f]{24})"/.exec(JSON.stringify(r.body))?.[1];
    r = await author.raw('POST', `/posts/${post}/images`, imageForm('images', [{ data: GIF_1PX, type: 'image/gif', name: 'p.gif' }])); st('GEN-08', 'POST', '/posts/:id/images', 'GIF rejected', r, [400, 415]);
    r = await author.raw('POST', `/posts/${post}/images`, imageForm('images', [{ data: Buffer.from('not really a png'), type: 'image/png', name: 'fake.png' }])); st('GEN-08', 'POST', '/posts/:id/images', 'file with fake PNG type rejected', r, [400, 415]);
    r = await reader.raw('POST', `/posts/${post}/images`, imageForm('images', [{ data: PNG_1PX, type: 'image/png', name: 'p.png' }])); st('BLG-10', 'POST', '/posts/:id/images', "cannot add images to someone else's post", r, 403);
    if (imgId) { r = await guest.get(`/media/${imgId}`); st('GEN-08', 'GET', '/media/:id', 'published post image served publicly', r, 200); }
    if (imgId) { r = await author.del(`/posts/${post}/images/${imgId}`, { confirm: true }); st('BLG-10', 'DELETE', '/posts/:id/images/:imageId', 'remove image', r, 200); }

    // BLG-05 / BLG-07 comments
    r = await reader.post(`/posts/${post}/comments`, { body: '' }); st('BLG-05', 'POST', '/posts/:id/comments', 'empty comment rejected', r, 400);
    r = await reader.post(`/posts/${post}/comments`, { body: 'x'.repeat(501) }); st('BLG-05', 'POST', '/posts/:id/comments', 'comment over 500 chars rejected', r, 400);
    r = await guest.post(`/posts/${post}/comments`, { body: 'Hi' }); st('ACC-10', 'POST', '/posts/:id/comments', 'guest must log in to comment', r, 401);
    r = await reader.post(`/posts/${draft}/comments`, { body: 'On a draft' }); check('BLG-05', 'POST /posts/:id/comments', 'cannot comment on a draft', '403/404', r.status, [403, 404].includes(r.status));
    r = await reader.post(`/posts/${post}/comments`, { body: 'Great trip!' }); st('BLG-05', 'POST', '/posts/:id/comments', 'comment on published post', r, 201);
    const comment = idOf(r.body);
    await third.post(`/posts/${post}/comments`, { body: 'Thanks for sharing.' });
    r = await guest.get(`/posts/${post}/comments`); st('BLG-05', 'GET', '/posts/:id/comments', 'comments listed', r, 200);
    const cm = items(r.body).map((c) => c.body);
    check('BLG-05', 'GET /posts/:id/comments', 'chronological order', 'Great trip! first', cm.join(' | '), cm[0] === 'Great trip!');
    r = await reader.patch(`/comments/${comment}`, { body: 'Great trip!! (edited)' }); st('BLG-07', 'PATCH', '/comments/:id', 'edit own comment', r, 200);
    r = await third.patch(`/comments/${comment}`, { body: 'Hijack' }); st('BLG-07', 'PATCH', '/comments/:id', "cannot edit someone else's comment", r, 403);

    // BLG-06 likes
    r = await reader.post(`/posts/${post}/like`); st('BLG-06', 'POST', '/posts/:id/like', 'like', r, [200, 201]);
    r = await reader.post(`/posts/${post}/like`); check('BLG-06', 'POST /posts/:id/like', 'second like does not double count', '200/201/409', r.status, [200, 201, 409].includes(r.status));
    await third.post(`/posts/${post}/like`);
    const likes = await db.collection('likes').countDocuments({ postId: new H.ObjectId(post) }) + await db.collection('community_likes').countDocuments({ postId: new H.ObjectId(post) });
    check('BLG-06', 'DB likes', 'one like per user (2 users -> 2 likes)', 2, likes, likes === 2);
    r = await reader.del(`/posts/${post}/like`); st('BLG-06', 'DELETE', '/posts/:id/like', 'remove like', r, 200);
    r = await guest.post(`/posts/${post}/like`); st('ACC-10', 'POST', '/posts/:id/like', 'guest must log in to like', r, 401);

    // BLG-09 search ordering by interaction
    r = await guest.get(`/posts?q=Nile`); st('BLG-09', 'GET', '/posts?q=', 'keyword search', r, 200);
    const order = items(r.body).map(idOf);
    check('BLG-09', 'GET /posts?q=Nile', 'ordered by likes + comments (post with 1 like + 2 comments first)', post, order.join(','), order[0] === post && order.includes(post2));
    r = await guest.get(`/posts?q=${encodeURIComponent(author.email.split('@')[0])}`);
    r = await guest.get('/posts?q=zzzznothing'); check('BLG-09', 'GET /posts?q=', 'no results -> empty list', 0, items(r.body).length, r.status === 200 && items(r.body).length === 0);

    // BLG-12 author page
    r = await guest.get(`/authors/${author.id}`); st('BLG-12', 'GET', '/authors/:id', 'public author page', r, 200);
    const ap = JSON.stringify(r.body);
    check('BLG-12', 'GET /authors/:id', 'name and published posts; no email or drafts', 'no email/draft', ap.includes(author.email) ? 'email leaked' : ap.includes(draft) ? 'draft leaked' : 'ok', !ap.includes(author.email) && !ap.includes(draft) && ap.includes(post));

    // BLG-13 attach itinerary (bonus)
    r = await author.post('/itineraries', { title: 'Public Cairo trip', countries: ['EG'], startDate: day(20) });
    const pubItn = idOf(r.body);
    await author.post(`/itineraries/${pubItn}/days`, { cityId: 'cairo' });
    r = await author.patch(`/posts/${post}/itinerary`, { itineraryId: pubItn }); st('BLG-13', 'PATCH', '/posts/:id/itinerary', 'private itinerary cannot be attached', r, [400, 403, 404]);
    await author.patch(`/itineraries/${pubItn}`, { visibility: 'public' });
    r = await author.patch(`/posts/${post}/itinerary`, { itineraryId: pubItn }); st('BLG-13', 'PATCH', '/posts/:id/itinerary', 'attach own public itinerary', r, 200);
    r = await guest.get(`/posts/${post}`); check('BLG-13', 'GET /posts/:id', 'post shows the itinerary', pubItn, JSON.stringify(r.body).includes(pubItn) ? 'linked' : 'missing', JSON.stringify(r.body).includes(pubItn));
    r = await reader.patch(`/posts/${post}/itinerary`, { itineraryId: pubItn }); st('BLG-13', 'PATCH', '/posts/:id/itinerary', "cannot attach to someone else's post", r, 403);
    r = await author.patch(`/posts/${post}/itinerary`, { itineraryId: null }); st('BLG-13', 'PATCH', '/posts/:id/itinerary', 'detach itinerary', r, 200);

    // GEN-09 reports
    r = await reader.post('/reports', { targetType: 'post', targetId: post, reason: 'Spam content' }); st('GEN-09', 'POST', '/reports', 'report a post', r, 201);
    r = await reader.post('/reports', { targetType: 'post', targetId: post, reason: 'Spam again' }); st('GEN-09', 'POST', '/reports', 'second report of same item rejected', r, 409);
    r = await reader.post('/reports', { targetType: 'comment', targetId: comment, reason: 'Testing' }); check('GEN-09', 'POST /reports', 'report a comment', 201, r.status, r.status === 201);
    r = await third.post('/reports', { targetType: 'post', targetId: post }); st('GEN-09', 'POST', '/reports', 'reason required', r, 400);
    r = await third.post('/reports', { targetType: 'user', targetId: post, reason: 'x' }); st('GEN-09', 'POST', '/reports', 'unsupported target type', r, 400);
    r = await guest.post('/reports', { targetType: 'post', targetId: post, reason: 'x' }); st('ACC-10', 'POST', '/reports', 'guest must log in to report', r, 401);

    // GEN-10 moderation
    r = await reader.get('/admin/reports'); st('GEN-10', 'GET', '/admin/reports', 'non-admin forbidden', r, 403);
    r = await admin.get('/admin/reports?status=Open'); st('GEN-10', 'GET', '/admin/reports', 'admin lists open reports', r, 200);
    const reports = items(r.body);
    const postReport = reports.find((x) => (x.targetId?._id ?? x.targetId) === post);
    check('GEN-10', 'GET /admin/reports', 'post report listed', 'present', postReport ? 'present' : 'missing', !!postReport);
    if (postReport) {
      r = await admin.patch(`/admin/reports/${idOf(postReport)}`, { action: 'hide', confirm: true, note: 'Spam' }); st('GEN-10', 'PATCH', '/admin/reports/:id', 'resolve by hiding content', r, 200);
      r = await guest.get(`/posts/${post}`); st('GEN-10', 'GET', '/posts/:id', 'hidden post invisible to public', r, 404);
      r = await author.get(`/posts/${post}`); st('GEN-10', 'GET', '/posts/:id', 'author still sees hidden post', r, 200);
      r = await admin.get(`/admin/content/post/${post}`); st('GEN-10', 'GET', '/admin/content/:type/:id', 'admin sees hidden post', r, 200);
    }
    const commentReport = reports.find((x) => (x.targetId?._id ?? x.targetId) === comment);
    if (commentReport) { r = await admin.patch(`/admin/reports/${idOf(commentReport)}`, { action: 'dismiss' }); st('GEN-10', 'PATCH', '/admin/reports/:id', 'dismiss report', r, 200); }
    r = await admin.del(`/admin/content/post/${post2}`, { confirm: true }); st('GEN-10', 'DELETE', '/admin/content/:type/:id', 'admin deletes post directly', r, 200);
    r = await guest.get(`/posts/${post2}`); st('GEN-10', 'GET', '/posts/:id', 'deleted post gone', r, 404);
    r = await admin.get('/admin/audit-logs'); const acts = items(r.body).map((a) => a.action).join(',');
    check('GEN-07', 'GET /admin/audit-logs', 'moderation actions audited (hide + delete)', 'hide,delete', acts.slice(0, 200), /hid/i.test(acts) && /delet/i.test(acts));

    // ACC-12 deactivated author's content hidden
    r = await third.del('/users/me', { confirm: true }); st('ACC-12', 'DELETE', '/users/me', 'commenter deactivates account', r, 200);
    r = await author.get(`/posts/${post}/comments`);
    check('ACC-12', 'GET /posts/:id/comments', "deactivated user's comment shown as 'Deleted user'", 'Deleted user', /Deleted user/i.test(JSON.stringify(r.body)) ? 'Deleted user' : JSON.stringify(r.body).slice(0, 120), /Deleted user/i.test(JSON.stringify(r.body)));
    // GEN-05 page size 10
    for (let i = 0; i < 11; i++) await author.post('/posts', { title: `Paging post ${i}`, body: 'Body', status: 'Published', tags: ['paging' + tag] });
    r = await guest.get(`/posts?tag=paging${tag}`);
    check('GEN-05', 'GET /posts', 'lists paginate at 10 per page', '10 of 11', `${items(r.body).length} of ${r.body?.total}`, items(r.body).length === 10 && r.body?.total === 11);
    r = await guest.get(`/posts?tag=paging${tag}&page=2`);
    check('GEN-05', 'GET /posts?page=2', 'second page has the rest', 1, items(r.body).length, items(r.body).length === 1);

    Object.assign(ctx, { postAuthor: author, publicItinerary: pubItn });
  },
};
