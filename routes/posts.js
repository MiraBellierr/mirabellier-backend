const express = require('express');

module.exports = function registerPostsRoutes(app, deps) {
  const { db, getUserById, userPublic, authFromReq } = deps;

  app.get('/posts', (req, res) => {
    try {
      const rows = db.prepare('SELECT p.*, u.username as authorName, u.avatar as authorAvatar FROM posts p LEFT JOIN users u ON p.userId = u.id ORDER BY createdAt DESC').all();
      const posts = rows.map(p => ({
        id: p.id,
        title: p.title,
        content: p.content ? JSON.parse(p.content) : null,
        shortDescription: p.shortDescription || null,
        thumbnail: p.thumbnail || null,
        userId: p.userId,
        author: p.userId ? (p.authorName || p.author || 'Unknown') : (p.author || 'Unknown'),
        authorAvatar: p.userId ? (p.authorAvatar || null) : (p.authorAvatar || null),
        createdAt: p.createdAt
      }));
      res.json(posts);
    } catch (err) {
      console.error('GET /posts error', err);
      res.status(500).json({ error: 'failed to fetch posts' });
    }
  });

  app.get('/posts/:id', (req, res) => {
    try {
      const id = req.params.id
      const p = db.prepare('SELECT p.*, u.username as authorName, u.avatar as authorAvatar FROM posts p LEFT JOIN users u ON p.userId = u.id WHERE p.id = ?').get(id)
      if (!p) return res.status(404).json({ error: 'Not found' })

      const post = {
        id: p.id,
        title: p.title,
        content: p.content ? JSON.parse(p.content) : null,
        shortDescription: p.shortDescription || null,
        thumbnail: p.thumbnail || null,
        userId: p.userId,
        author: p.userId ? (p.authorName || p.author || 'Unknown') : (p.author || 'Unknown'),
        authorAvatar: p.userId ? (p.authorAvatar || null) : (p.authorAvatar || null),
        createdAt: p.createdAt,
      }

      res.json(post)
    } catch (err) {
      console.error('GET /posts/:id error', err)
      res.status(500).json({ error: 'failed to fetch post' })
    }
  })

  // Server-side SEO page for individual blog post (for social crawlers)
  app.get('/blog/:id', (req, res) => {
    try {
      // support slugged URLs like /blog/this-is-title-12345
      const raw = req.params.id || ''
      const maybeId = raw.includes('-') ? raw.split('-').pop() : raw
      const id = maybeId || raw
      const p = db.prepare('SELECT p.*, u.username as authorName, u.avatar as authorAvatar FROM posts p LEFT JOIN users u ON p.userId = u.id WHERE p.id = ?').get(id)
      if (!p) return res.status(404).send('Not found')

      const title = p.title || 'Untitled'
      let description = p.shortDescription || ''
      if (!description && p.content) {
        try {
          const parsed = JSON.parse(p.content)
          if (parsed && typeof parsed === 'object') {
            // try to extract a short text from editor content
            const walk = (node) => {
              if (!node) return ''
              if (Array.isArray(node)) return node.map(walk).join(' ')
              if (typeof node === 'string') return node
              if (node.type === 'text') return node.text || ''
              if (node.content) return walk(node.content)
              return ''
            }
            description = walk(parsed).slice(0, 160)
          }
        } catch (e) {
          // ignore
        }
      }

      const thumbnail = p.thumbnail || null

      const escapeHtml = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

      const host = req.get('host')
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http'

      let imageUrl = ''
      if (thumbnail) {
        if (/^https?:\/\//i.test(thumbnail)) imageUrl = thumbnail
        else if (thumbnail.startsWith('/')) imageUrl = `${protocol}://${host}${thumbnail}`
        else imageUrl = `${protocol}://${host}/images/${thumbnail}`
      }

      const slugify = (input) => {
        if (!input) return ''
        return String(input)
          .toLowerCase()
          .normalize('NFKD')
          .replace(/[^a-z0-9\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .slice(0,80)
      }

      const slug = slugify(title)
      const spaPath = `/blog/${slug}-${id}`
      const requestPath = req.originalUrl || req.path || `/blog/${raw}`

      const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    ${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}" />` : ''}
    <meta property="og:url" content="${protocol}://${host}${requestPath}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    ${imageUrl ? `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />` : ''}
    <link rel="canonical" href="${protocol}://${host}${spaPath}" />
    <meta http-equiv="refresh" content="0;url=${spaPath}" />
    <noscript>
      <meta http-equiv="refresh" content="0;url=${spaPath}" />
    </noscript>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <p><a href="${spaPath}">Open in app</a></p>
  </body>
</html>`

      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.send(html)
    } catch (err) {
      console.error('GET /blog/:id error', err)
      res.status(500).send('Server error')
    }
  })

  app.post('/posts', (req, res) => {
    try {
      const userFromToken = authFromReq(req);
      const userId = userFromToken ? userFromToken.id : req.body.userId;

      const id = Date.now().toString();
      const title = req.body.title || req.body.name || 'Untitled';
      const contentObj = req.body.content || req.body.body || {};
      const shortDescription = req.body.shortDescription || req.body.description || null;
      const thumbnail = req.body.thumbnail || null;
      const createdAt = new Date().toISOString();

      db.prepare('INSERT INTO posts (id, title, content, userId, author, shortDescription, thumbnail, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, title, JSON.stringify(contentObj), userId || null, req.body.author || null, shortDescription, thumbnail, createdAt);

      const u = userId ? getUserById(userId) : null;
      const resp = {
        id,
        title,
        content: contentObj,
        shortDescription,
        thumbnail,
        userId: userId || null,
        author: userId ? (u ? u.username : (req.body.author || 'Unknown')) : (req.body.author || 'Unknown'),
        authorAvatar: userId ? (u ? u.avatar : null) : null,
        createdAt
      };

      res.status(201).json(resp);
    } catch (err) {
      console.error('POST /posts error', err);
      res.status(500).json({ error: 'failed to save post' });
    }
  });

  app.put('/posts/:id', (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: 'unauthorized' });

      const id = req.params.id;
      const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'Not found' });

      if (!existing.userId || existing.userId !== user.id) {
        return res.status(403).json({ error: 'forbidden' });
      }

      const title = req.body.title || existing.title;
      const contentObj = req.body.content !== undefined ? req.body.content : (existing.content ? JSON.parse(existing.content) : {});
      const shortDescription = req.body.shortDescription !== undefined ? req.body.shortDescription : existing.shortDescription;
      const thumbnail = req.body.thumbnail !== undefined ? req.body.thumbnail : existing.thumbnail;

      db.prepare('UPDATE posts SET title = ?, content = ?, shortDescription = ?, thumbnail = ? WHERE id = ?')
        .run(title, JSON.stringify(contentObj), shortDescription, thumbnail, id);

      const u = user ? getUserById(user.id) : null;
      const resp = {
        id,
        title,
        content: contentObj,
        shortDescription: shortDescription || null,
        thumbnail: thumbnail || null,
        userId: existing.userId || null,
        author: existing.userId ? (u ? u.username : existing.author || 'Unknown') : (existing.author || 'Unknown'),
        authorAvatar: existing.userId ? (u ? u.avatar : null) : null,
        createdAt: existing.createdAt
      };

      res.json(resp);
    } catch (err) {
      console.error('PUT /posts/:id error', err);
      res.status(500).json({ error: 'failed to update post' });
    }
  });

  app.delete('/posts/:id', (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: 'unauthorized' });

      const id = req.params.id;
      const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'Not found' });

      if (!existing.userId || existing.userId !== user.id) {
        return res.status(403).json({ error: 'forbidden' });
      }

      db.prepare('DELETE FROM posts WHERE id = ?').run(id);
      res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /posts/:id error', err);
      res.status(500).json({ error: 'failed to delete post' });
    }
  });
};
