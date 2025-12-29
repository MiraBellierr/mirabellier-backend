const path = require('path');
const fs = require('fs');

module.exports = function registerImageRoutes(app, deps) {
  const { IMAGES_DIR } = deps;

  app.get('/images/list', (req, res) => {
    try {
      if (!fs.existsSync(IMAGES_DIR)) return res.json([]);
      const files = fs.readdirSync(IMAGES_DIR).filter(f => {
        const full = path.join(IMAGES_DIR, f);
        try { return fs.statSync(full).isFile(); } catch (e) { return false; }
      });
      const list = files.map(f => {
        const full = path.join(IMAGES_DIR, f);
        const stat = fs.statSync(full);
        return {
          filename: f,
          url: `/images/${f}`,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString()
        };
      }).sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
      // Cache image list for 2 minutes
      res.setHeader('Cache-Control', 'public, max-age=120');
      res.json(list);
    } catch (err) {
      console.error('Error reading images', err);
      res.status(500).json({ error: 'Failed to read images' });
    }
  });

  app.get('/images/meta/:filename', (req, res) => {
    try {
      const filename = req.params.filename;
      if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) return res.status(400).json({ error: 'invalid filename' });
      const full = path.join(IMAGES_DIR, filename);
      if (!fs.existsSync(full)) return res.status(404).json({ error: 'not found' });
      const stat = fs.statSync(full);
      if (!stat.isFile()) return res.status(404).json({ error: 'not found' });
      // Cache metadata for 1 hour
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.json({ filename, url: `/images/${filename}`, size: stat.size, modifiedAt: stat.mtime.toISOString() });
    } catch (err) {
      console.error('Error reading image metadata', err);
      res.status(500).json({ error: 'failed' });
    }
  });
};
