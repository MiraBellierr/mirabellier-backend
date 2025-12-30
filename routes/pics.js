const express = require('express');

module.exports = function registerPicsRoutes(app, deps) {
  const { db, getUserById, userPublic, authFromReq, imageUpload, optimizeImage } = deps;

  app.post('/upload-pic', imageUpload.single('image'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Image file is required.' });

      const finalFilename = req.file.filename;
      const title = req.body.title || finalFilename.replace(/\.[^/.]+$/, '');

      const id = Date.now().toString();
      const createdAt = new Date().toISOString();
      const userFromToken = authFromReq(req);
      const userId = userFromToken ? userFromToken.id : (req.body.userId || null);

      // Optimize the image
      if (req.file.path) {
        await optimizeImage(req.file.path);
      }

      db.prepare(`INSERT INTO pics (id, title, url, userId, likes, comments, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, title, `/images/${finalFilename}`, userId, JSON.stringify([]), JSON.stringify([]), createdAt);

      const newPic = {
        id,
        title,
        url: `/images/${finalFilename}`,
        userId: userId || null,
        likes: [],
        comments: [],
        createdAt
      };

      res.status(201).json(newPic);
    } catch (err) {
      console.error('Error processing picture:', err);
      res.status(500).json({ error: 'Picture upload failed', details: err.message, type: err.name || 'ProcessingError' });
    }
  });

  app.get('/pics', (req, res) => {
    try {
      const rows = db.prepare(`SELECT p.*, u.username as authorUsername, u.avatar as authorAvatar FROM pics p LEFT JOIN users u ON u.id = p.userId ORDER BY createdAt DESC`).all();
      const enriched = rows.map(r => {
        const rawComments = r.comments ? JSON.parse(r.comments) : [];
        const byId = {};
        rawComments.forEach(c => { byId[c.id] = { ...c, children: [], user: c.userId ? userPublic(getUserById(c.userId)) : null }; });
        const nestedComments = [];
        rawComments.forEach(c => {
          const node = byId[c.id];
          if (c.parentId && byId[c.parentId]) {
            byId[c.parentId].children.push(node);
          } else {
            nestedComments.push(node);
          }
        });
        return {
          ...r,
          likes: r.likes ? JSON.parse(r.likes) : [],
          comments: nestedComments,
          author: r.authorUsername,
          authorAvatar: r.authorAvatar
        };
      });
      res.json(enriched);
    } catch (err) {
      console.error('Error reading pics:', err);
      res.status(500).json({ error: 'Failed to fetch pics' });
    }
  });

  app.post('/pics/:id/like', (req, res) => {
    try {
      const { id } = req.params;
      const userFromToken = authFromReq(req);
      if (!userFromToken) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const pic = db.prepare('SELECT likes FROM pics WHERE id = ?').get(id);
      if (!pic) return res.status(404).json({ error: 'Picture not found' });

      const likes = pic.likes ? JSON.parse(pic.likes) : [];
      const userId = userFromToken.id;
      const likeIndex = likes.indexOf(userId);

      if (likeIndex > -1) {
        likes.splice(likeIndex, 1);
      } else {
        likes.push(userId);
      }

      db.prepare('UPDATE pics SET likes = ? WHERE id = ?').run(JSON.stringify(likes), id);
      res.json({ likes, liked: likes.includes(userId) });
    } catch (err) {
      console.error('Error liking pic:', err);
      res.status(500).json({ error: 'Failed to like picture' });
    }
  });

  app.post('/pics/:id/comment', (req, res) => {
    try {
      const { id } = req.params;
      const { text, parentId } = req.body;
      const userFromToken = authFromReq(req);
      if (!userFromToken) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const pic = db.prepare('SELECT comments FROM pics WHERE id = ?').get(id);
      if (!pic) return res.status(404).json({ error: 'Picture not found' });

      const comments = pic.comments ? JSON.parse(pic.comments) : [];
      const newComment = {
        id: Date.now().toString(),
        text,
        userId: userFromToken.id,
        createdAt: new Date().toISOString(),
        parentId: parentId || null,
        children: []
      };

      comments.push(newComment);
      db.prepare('UPDATE pics SET comments = ? WHERE id = ?').run(JSON.stringify(comments), id);
      res.status(201).json(newComment);
    } catch (err) {
      console.error('Error adding comment:', err);
      res.status(500).json({ error: 'Failed to add comment' });
    }
  });
};
