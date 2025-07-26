const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Now pointing to root directory
const BLOG_FILE = path.join(__dirname, 'blog.json');
const CATS_FILE = path.join(__dirname, 'cats.json');

// Ensure blog.json exists
const ensureBlogFileExists = () => {
  if (!fs.existsSync(BLOG_FILE)) {
    fs.writeFileSync(BLOG_FILE, '[]', 'utf-8');
  }
};

const ensureCatsFileExists = () => {
  if (!fs.existsSync(CATS_FILE)) {
    fs.writeFileSync(CATS_FILE, '[]', 'utf-8');
  }
};

// API Endpoints
app.get('/posts', (req, res) => {
  ensureBlogFileExists();
  const posts = JSON.parse(fs.readFileSync(BLOG_FILE, 'utf-8'));
  res.json(posts);
});

app.post('/posts', (req, res) => {
  ensureBlogFileExists();
  const posts = JSON.parse(fs.readFileSync(BLOG_FILE, 'utf-8'));
  const newPost = {
    id: Date.now().toString(),
    ...req.body,
    createdAt: new Date().toISOString()
  };
  posts.push(newPost);
  fs.writeFileSync(BLOG_FILE, JSON.stringify(posts, null, 2));
  res.status(201).json(newPost);
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
const imageUpload = multer({ storage });

// Video upload
const videoUpload = multer({
  storage: VideoStorage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1,
    fields: 1,
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

// Upload cat video endpoint
app.post('/upload-cat-video', videoUpload.single('video'), (req, res) => {
  ensureCatsFileExists();
  const posts = JSON.parse(fs.readFileSync(CATS_FILE, 'utf-8'));

  if (!req.file || !req.body.title) {
    return res.status(400).json({ error: 'Title and video file are required.' });
  }

  const newPost = {
    id: Date.now().toString(),
    name: req.body.title,
    url: `/videos/${req.file.filename}`,
    createdAt: new Date().toISOString()
  };

  posts.push(newPost);
  fs.writeFileSync(CATS_FILE, JSON.stringify(posts, null, 2));
  res.status(201).json(newPost);
});

app.get('/cat-videos', (req, res) => {
  ensureCatsFileExists();
  const cats = JSON.parse(fs.readFileSync(CATS_FILE, 'utf-8'));
  res.json(cats);
});

// Route: Upload image
app.post('/posts-img', imageUpload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const imagePath = `/images/${req.file.filename}`;
    res.json({ path: imagePath });
});

// Serve videos statically
app.use('/videos', express.static(VIDEOS_DIR));
app.use('/images', express.static(IMAGES_DIR));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  ensureBlogFileExists();
});