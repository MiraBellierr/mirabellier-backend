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

  app.post('/posts', (req, res) => {
    try {
      const userFromToken = authFromReq(req);
      const userId = userFromToken ? userFromToken.id : req.body.userId;

      const id = Date.now().toString();
      const title = req.body.title || req.body.name || 'Untitled';
      const contentObj = req.body.content || req.body.body || {};
      const createdAt = new Date().toISOString();

      db.prepare('INSERT INTO posts (id, title, content, userId, author, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, title, JSON.stringify(contentObj), userId || null, req.body.author || null, createdAt);

      const u = userId ? getUserById(userId) : null;
      const resp = {
        id,
        title,
        content: contentObj,
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
};
