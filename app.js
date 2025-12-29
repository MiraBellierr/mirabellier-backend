const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const passport = require('passport');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 5000;

// Compression middleware - compress all responses
app.use(compression({
  level: 6, // Balance between speed and compression
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Enable keep-alive for faster subsequent requests
app.use((req, res, next) => {
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Keep-Alive', 'timeout=5, max=100');
  next();
});

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(passport.initialize());

// Add timing headers for performance monitoring
app.use((req, res, next) => {
  const start = Date.now();
  const originalSend = res.send;
  res.send = function(...args) {
    const duration = Date.now() - start;
    if (!res.headersSent) {
      res.setHeader('Server-Timing', `total;dur=${duration}`);
    }
    return originalSend.apply(res, args);
  };
  next();
});

const { db } = require('./lib/db');
const users = require('./lib/users');
const uploads = require('./lib/uploads');

function authFromReq(req) {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const parts = auth.split(' ');
  if (parts.length !== 2) return null;
  const token = parts[1];
  return users.getUserByToken(token);
}

require('./routes/posts')(app, { db, getUserById: users.getUserById, userPublic: users.userPublic, authFromReq });
require('./routes/videos')(app, { db, getUserById: users.getUserById, userPublic: users.userPublic, authFromReq, videoUpload: uploads.videoUpload });
require('./routes/images')(app, { IMAGES_DIR: uploads.IMAGES_DIR });
require('./routes/auth')(app, {
  makeToken: users.makeToken,
  createSession: users.createSession,
  getUserByUsername: users.getUserByUsername,
  getUserById: users.getUserById,
  getUserByToken: users.getUserByToken,
  updateUserById: users.updateUserById,
  userPublic: users.userPublic,
  authFromReq,
  imageUpload: uploads.imageUpload,
  findOrCreateDiscordUser: users.findOrCreateDiscordUser,
});

require('./routes/anime')(app, { db, authFromReq });

// Image upload endpoint for blog posts with optimization
app.post('/posts-img', uploads.imageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    
    // Optimize the uploaded image
    await uploads.optimizeImage(path.join(uploads.IMAGES_DIR, req.file.filename));
    
    res.json({ 
      path: `/images/${req.file.filename}`,
      webp: `/images/${path.basename(req.file.filename, path.extname(req.file.filename))}.webp`
    });
  } catch (err) {
    console.error('Image upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Serve static files with long cache headers
app.use('/videos', express.static(uploads.VIDEOS_DIR, {
  maxAge: '365d',
  immutable: true,
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));
app.use('/images', express.static(uploads.IMAGES_DIR, {
  maxAge: '365d',
  immutable: true,
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});