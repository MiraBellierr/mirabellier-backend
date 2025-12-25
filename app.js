require("dotenv").config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const bcrypt = require('bcryptjs');
// Note: ffmpeg was removed from the backend. No ffmpeg/ffprobe usage.

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Now pointing to root directory
// JSON files removed — use SQLite tables for posts and videos

// Use sqlite (better-sqlite3) for user/session storage
const Database = require('better-sqlite3');
const DB_FILE = path.join(__dirname, 'database.sqlite3');
const db = new Database(DB_FILE);

// Initialize tables
db.prepare(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  passwordHash TEXT,
  avatar TEXT,
  createdAt TEXT
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  userId TEXT
)`).run();

// Posts table (replacing blog.json)
db.prepare(`CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  title TEXT,
  content TEXT,
  userId TEXT,
  author TEXT,
  createdAt TEXT
)`).run();

// Videos table (replacing cats.json)
db.prepare(`CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  url TEXT,
  userId TEXT,
  likes INTEGER,
  comments TEXT,
  createdAt TEXT,
  source TEXT,
  originalMetadata TEXT
)`).run();

function makeToken() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function userPublic(user) {
  if (!user) return null
  const { passwordHash, ...rest } = user
  return rest
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username)
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id)
}

function createUser(username, password) {
  const id = Date.now().toString()
  const passwordHash = bcrypt.hashSync(password, 10)
  const createdAt = new Date().toISOString()
  db.prepare('INSERT INTO users (id, username, passwordHash, avatar, createdAt) VALUES (?, ?, ?, ?, ?)')
    .run(id, username, passwordHash, null, createdAt)
  return getUserById(id)
}

function createSession(token, userId) {
  db.prepare('INSERT INTO sessions (token, userId) VALUES (?, ?)').run(token, userId)
}

function getUserByToken(token) {
  return db.prepare('SELECT u.* FROM sessions s JOIN users u ON s.userId = u.id WHERE s.token = ?').get(token)
}

function enrichCommentsArray(arr) {
  if (!Array.isArray(arr)) return [];
  const byId = {};
  arr.forEach(c => {
    byId[c.id] = { ...c, children: [], user: c.userId ? userPublic(getUserById(c.userId)) : null };
  });
  const roots = [];
  arr.forEach(c => {
    const node = byId[c.id];
    if (!node) return;
    if (c.parentId) {
      const parent = byId[c.parentId];
      if (parent) parent.children.push(node); else roots.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function updateUserById(id, { username, password, avatar }) {
  const user = getUserById(id)
  if (!user) return null
  if (username && username !== user.username) {
    // ensure uniqueness
    const existing = getUserByUsername(username)
    if (existing && existing.id !== id) throw new Error('username taken')
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, id)
  }
  if (password) {
    const passwordHash = bcrypt.hashSync(password, 10)
    db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(passwordHash, id)
  }
  if (avatar) {
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, id)
  }
  return getUserById(id)
}

// JSON file helpers removed; using sqlite tables for persistence

// API Endpoints
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
    }))
    res.json(posts);
  } catch (err) {
    console.error('GET /posts error', err)
    res.status(500).json({ error: 'failed to fetch posts' })
  }
});

app.post('/posts', (req, res) => {
  try {
    // determine userId from auth header if present, otherwise fall back to provided userId
    const userFromToken = authFromReq(req)
    const userId = userFromToken ? userFromToken.id : req.body.userId

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
    }

    res.status(201).json(resp);
  } catch (err) {
    console.error('POST /posts error', err)
    res.status(500).json({ error: 'failed to save post' })
  }
});

// Create images folder if not exists
const IMAGES_DIR = path.join(__dirname, 'images');
if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR);
}

// Ensure videos directory exists
const VIDEOS_DIR = path.join(__dirname, 'videos');
if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR);
}

// Multer setup for images upload
const imageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, IMAGES_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${file.originalname}`;
        cb(null, uniqueName);
    }
});

// Multer setup for video uploads
const VideoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, VIDEOS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'catvideo-' + uniqueSuffix + ext);
  }
});

// Image upload
const imageUpload = multer({ storage: imageStorage });

// Video upload
const videoUpload = multer({
  storage: VideoStorage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1,
    fields: 5,
    fieldSize: 50 * 1024 * 1024 // 50MB limit for each field
  },
  fileFilter: (req, file, cb) => {
    // Optional: validate file types
    const allowedTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'));
    }
  }
});

// Upload video endpoint
app.post('/upload-video', videoUpload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Video file is required.' });
    }

    const finalFilename = req.file.filename;
    const finalPath = req.file.path;

    // derive title from provided customTitle or filename
    const autoTitle = req.body.customTitle || finalFilename.replace(/\.[^/.]+$/, '');

    const id = Date.now().toString();
    const createdAt = new Date().toISOString();
    const userFromToken = authFromReq(req);
    const userId = userFromToken ? userFromToken.id : (req.body.userId || null);

    // store likes as JSON array of userIds
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
    res.status(500).json({ 
      error: 'Video upload failed',
      details: err.message,
      type: err.name || 'ProcessingError'
    });
  }
});

app.get('/videos', (req, res) => {
  try {
    const rows = db.prepare(`SELECT v.*, u.username as authorUsername, u.avatar as authorAvatar FROM videos v LEFT JOIN users u ON u.id = v.userId ORDER BY createdAt DESC`).all();
    const enriched = rows.map(r => {
      const rawComments = r.comments ? JSON.parse(r.comments) : [];
      const nestedComments = enrichCommentsArray(rawComments);
      // likes stored as JSON array in DB; tolerate numeric legacy values
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

// Add a comment or reply to a video. Requires authentication.
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

// Like / Unlike a video. Accepts { action: 'like'|'unlike' } in body.
app.post('/videos/:id/like', (req, res) => {
  try {
    // Requires authentication to know which user is liking/unliking
    const user = authFromReq(req);
    if (!user) return res.status(401).json({ error: 'unauthenticated' });

    const videoId = req.params.id;
    const action = (req.body && req.body.action) ? req.body.action : 'like';

    const row = db.prepare('SELECT likes FROM videos WHERE id = ?').get(videoId);
    if (!row) return res.status(404).json({ error: 'video not found' });

    // parse likes array (stored as JSON string)
    let likesArr = [];
    try {
      if (row.likes) likesArr = Array.isArray(row.likes) ? row.likes : JSON.parse(row.likes);
    } catch (e) { likesArr = []; }

    const userId = user.id;
    if (action === 'like') {
      if (!likesArr.includes(userId)) likesArr.push(userId);
    } else if (action === 'unlike') {
      likesArr = likesArr.filter(x => x !== userId);
    } else {
      return res.status(400).json({ error: 'invalid action' });
    }

    db.prepare('UPDATE videos SET likes = ? WHERE id = ?').run(JSON.stringify(likesArr), videoId);

    res.json({ likes: likesArr });
  } catch (err) {
    console.error('POST /videos/:id/like error', err);
    res.status(500).json({ error: 'failed to update likes' });
  }
});

// Route: Upload image
app.post('/posts-img', imageUpload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const imagePath = `/images/${req.file.filename}`;
    res.json({ path: imagePath });
});

// List images with metadata (non-conflicting path)
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
    res.json(list);
  } catch (err) {
    console.error('Error reading images', err);
    res.status(500).json({ error: 'Failed to read images' });
  }
});

// Get metadata for a single image (non-conflicting path)
app.get('/images/meta/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    // prevent path traversal
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'invalid filename' });
    }
    const full = path.join(IMAGES_DIR, filename);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'not found' });
    const stat = fs.statSync(full);
    if (!stat.isFile()) return res.status(404).json({ error: 'not found' });
    res.json({ filename, url: `/images/${filename}`, size: stat.size, modifiedAt: stat.mtime.toISOString() });
  } catch (err) {
    console.error('Error reading image metadata', err);
    res.status(500).json({ error: 'failed' });
  }
});

// Serve videos statically
app.use('/videos', express.static(VIDEOS_DIR));
app.use('/images', express.static(IMAGES_DIR));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Register
app.post('/register', (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password) return res.status(400).json({ error: 'username and password required' })
    if (getUserByUsername(username)) return res.status(409).json({ error: 'username taken' })
    const newUser = createUser(username, password)
    const token = makeToken()
    createSession(token, newUser.id)
    res.status(201).json({ token, user: userPublic(newUser) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'register failed' })
  }
})

// Login
app.post('/login', (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password) return res.status(400).json({ error: 'username and password required' })
    const user = getUserByUsername(username)
    if (!user) return res.status(401).json({ error: 'invalid credentials' })
    if (!bcrypt.compareSync(password, user.passwordHash)) return res.status(401).json({ error: 'invalid credentials' })
    const token = makeToken()
    createSession(token, user.id)
    res.json({ token, user: userPublic(user) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'login failed' })
  }
})

// Auth helper
function authFromReq(req) {
  const auth = req.headers.authorization
  if (!auth) return null
  const parts = auth.split(' ')
  if (parts.length !== 2) return null
  const token = parts[1]
  return getUserByToken(token)
}

// Get current user
app.get('/me', (req, res) => {
  try {
    const user = authFromReq(req)
    if (!user) return res.status(401).json({ error: 'unauthenticated' })
    res.json(userPublic(user))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'failed' })
  }
})

// Get public user by id
app.get('/user/:id', (req, res) => {
  try {
    const id = req.params.id
    const user = getUserById(id)
    if (!user) return res.status(404).json({ error: 'not found' })
    res.json(userPublic(user))
  } catch (err) {
    console.error('GET /user/:id error', err)
    res.status(500).json({ error: 'failed' })
  }
})

// Logout - remove session token server-side
app.post('/logout', (req, res) => {
  try {
    const auth = req.headers.authorization
    if (!auth) return res.status(401).json({ error: 'unauthenticated' })
    const parts = auth.split(' ')
    if (parts.length !== 2) return res.status(401).json({ error: 'unauthenticated' })
    const token = parts[1]
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'logout failed' })
  }
})

// Update current user (supports avatar upload via 'avatar' field)
app.post('/me', imageUpload.single('avatar'), (req, res) => {
  try {
    const user = authFromReq(req)
    if (!user) return res.status(401).json({ error: 'unauthenticated' })
    // Accept either an uploaded file or an existing avatar path in the body
    const avatar = req.file ? `/images/${req.file.filename}` : (req.body && req.body.avatar ? req.body.avatar : undefined)
    const updated = updateUserById(user.id, { username: req.body.username, password: req.body.password, avatar })
    res.json(userPublic(updated))
  } catch (err) {
    console.error(err)
    if (err.message === 'username taken') return res.status(409).json({ error: 'username taken' })
    res.status(500).json({ error: 'update failed' })
  }
})