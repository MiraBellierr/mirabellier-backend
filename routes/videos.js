const express = require('express');

module.exports = function registerVideoRoutes(app, deps) {
  const { db, getUserById, userPublic, authFromReq, videoUpload } = deps;

  app.post('/upload-video', videoUpload.single('video'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Video file is required.' });

      const finalFilename = req.file.filename;
      const autoTitle = req.body.customTitle || finalFilename.replace(/\.[^/.]+$/, '');

      const id = Date.now().toString();
      const createdAt = new Date().toISOString();
      const userFromToken = authFromReq(req);
      const userId = userFromToken ? userFromToken.id : (req.body.userId || null);

      db.prepare(`INSERT INTO videos (id, name, description, url, userId, likes, comments, createdAt, source, originalMetadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, autoTitle, req.body.description || '', `/videos/${finalFilename}`, userId, JSON.stringify([]), JSON.stringify([]), createdAt, 'upload', null);

      const newPost = {
        id,
        name: autoTitle,
        description: req.body.description || '',
        url: `/videos/${finalFilename}`,
        userId: userId || null,
        likes: req.body.likes ? parseInt(req.body.likes, 10) : 0,
        comments: [],
        createdAt,
        source: 'upload',
        originalMetadata: null
      };

      res.status(201).json(newPost);
    } catch (err) {
      console.error('Error processing video:', err);
      res.status(500).json({ error: 'Video upload failed', details: err.message, type: err.name || 'ProcessingError' });
    }
  });

  app.get('/videos', (req, res) => {
    try {
      const rows = db.prepare(`SELECT v.*, u.username as authorUsername, u.avatar as authorAvatar FROM videos v LEFT JOIN users u ON u.id = v.userId ORDER BY createdAt DESC`).all();
      const enriched = rows.map(r => {
        const rawComments = r.comments ? JSON.parse(r.comments) : [];
        const byId = {};
        rawComments.forEach(c => { byId[c.id] = { ...c, children: [], user: c.userId ? userPublic(getUserById(c.userId)) : null }; });
        const nestedComments = [];
        rawComments.forEach(c => {
          const node = byId[c.id];
          if (!node) return;
          if (c.parentId) { const parent = byId[c.parentId]; if (parent) parent.children.push(node); else nestedComments.push(node); } else nestedComments.push(node);
        });

        let likesArr = [];
        try {
          if (r.likes === null || r.likes === undefined) likesArr = [];
          else if (typeof r.likes === 'string') likesArr = JSON.parse(r.likes);
          else if (typeof r.likes === 'number') likesArr = [];
        } catch (e) { likesArr = []; }

        return {
          id: r.id,
          name: r.name,
          description: r.description,
          url: r.url,
          userId: r.userId,
          likes: likesArr,
          comments: nestedComments,
          createdAt: r.createdAt,
          source: r.source,
          originalMetadata: r.originalMetadata ? JSON.parse(r.originalMetadata) : null,
          user: r.userId ? { id: r.userId, username: r.authorUsername, avatar: r.authorAvatar } : null
        };
      });
      res.json(enriched);
    } catch (e) {
      console.error('Error reading videos', e);
      res.status(500).json({ error: 'Failed to read videos' });
    }
  });

  app.post('/videos/:id/comments', (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: 'unauthenticated' });
      const videoId = req.params.id;
      const text = (req.body.text || '').toString().trim();
      if (!text) return res.status(400).json({ error: 'text required' });
      const parentId = req.body.parentId || null;

      const row = db.prepare('SELECT comments FROM videos WHERE id = ?').get(videoId);
      if (!row) return res.status(404).json({ error: 'video not found' });

      const comments = row.comments ? JSON.parse(row.comments) : [];
      const commentId = Date.now().toString();
      const comment = { id: commentId, userId: user.id, text, parentId, createdAt: new Date().toISOString() };
      comments.push(comment);

      db.prepare('UPDATE videos SET comments = ? WHERE id = ?').run(JSON.stringify(comments), videoId);

      const resp = { ...comment, user: userPublic(user), children: [] };
      res.status(201).json(resp);
    } catch (err) {
      console.error('POST /videos/:id/comments error', err);
      res.status(500).json({ error: 'failed to add comment' });
    }
  });

  app.post('/videos/:id/like', (req, res) => {
    try {
      const user = authFromReq(req);
      if (!user) return res.status(401).json({ error: 'unauthenticated' });

      const videoId = req.params.id;
      const action = (req.body && req.body.action) ? req.body.action : 'like';

      const row = db.prepare('SELECT likes FROM videos WHERE id = ?').get(videoId);
      if (!row) return res.status(404).json({ error: 'video not found' });

      let likesArr = [];
      try { if (row.likes) likesArr = Array.isArray(row.likes) ? row.likes : JSON.parse(row.likes); } catch (e) { likesArr = []; }

      const userId = user.id;
      if (action === 'like') { if (!likesArr.includes(userId)) likesArr.push(userId); }
      else if (action === 'unlike') { likesArr = likesArr.filter(x => x !== userId); }
      else return res.status(400).json({ error: 'invalid action' });

      db.prepare('UPDATE videos SET likes = ? WHERE id = ?').run(JSON.stringify(likesArr), videoId);

      res.json({ likes: likesArr });
    } catch (err) {
      console.error('POST /videos/:id/like error', err);
      res.status(500).json({ error: 'failed to update likes' });
    }
  });
};
