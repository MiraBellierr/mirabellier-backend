require("dotenv").config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const util = require('util');
const ffmpeg = require('fluent-ffmpeg');
const ytdl = require('youtube-dl-exec');

const unlinkAsync = util.promisify(fs.unlink);
const ffprobe = util.promisify(ffmpeg.ffprobe);

ffmpeg.setFfmpegPath(process.env.FFMPEG);

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

// Upload cat video endpoint
app.post('/upload-cat-video', videoUpload.single('video'), async (req, res) => {
  try {
    ensureCatsFileExists();
    const posts = JSON.parse(fs.readFileSync(CATS_FILE, 'utf-8'));

    if ((!req.file && !req.body.youtubeUrl) || (req.file && req.body.youtubeUrl)) {
      return res.status(400).json({ error: 'Either video file or YouTube URL is required, but not both.' });
    }

    let finalFilename, finalPath, metadata;
    let tempFilesToCleanup = [];

    // Handle YouTube Shorts URL
    if (req.body.youtubeUrl) {
      const youtubeUrl = req.body.youtubeUrl;
      if (!youtubeUrl.includes('youtube.com/shorts/') && !youtubeUrl.includes('youtu.be/')) {
        return res.status(400).json({ error: 'Only YouTube Shorts URLs are allowed.' });
      }

      const tempName = `yt_temp_${Date.now()}`;
      const tempPath = path.join(__dirname, 'videos', tempName);
      const cookiesPath = path.join(__dirname, 'cookies.txt');
      
      if (!fs.existsSync(cookiesPath)) {
        console.error('Cookies file not found at:', cookiesPath);
        throw new Error('Authentication required - cookies file missing');
      }

      // Download YouTube video with cookies authentication
      await ytdl(youtubeUrl, {
        output: tempPath,
        format: 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        noCheckCertificates: true,
        noWarnings: true,
        preferFreeFormats: true,
        cookies: cookiesPath,
        addHeader: [
          'referer:youtube.com', 
          'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        ]
      });

      // Find downloaded files
      const files = fs.readdirSync(path.join(__dirname, 'videos'));
      const downloadedFiles = files.filter(f => f.startsWith(tempName));
      if (downloadedFiles.length === 0) {
        throw new Error('Failed to find downloaded YouTube video');
      }

      const mainFile = downloadedFiles.find(f => ['.mp4', '.mkv', '.mov'].some(ext => f.endsWith(ext))) || downloadedFiles[0];
      const mainFilePath = path.join(__dirname, 'videos', mainFile);
      
      tempFilesToCleanup = downloadedFiles
        .filter(f => f !== mainFile)
        .map(f => path.join(__dirname, 'videos', f));

      finalFilename = `yt_${Date.now()}_h264.mp4`;
      finalPath = path.join(__dirname, 'videos', finalFilename);
      
      // Convert using the specific FFmpeg command
      await new Promise((resolve, reject) => {
        ffmpeg(mainFilePath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions([
            '-profile:v high',
            '-level 4.0',
            '-movflags +faststart'
          ])
          .on('error', reject)
          .on('end', () => {
            // Delete the original downloaded file after conversion
            fs.unlinkSync(mainFilePath);
            resolve();
          })
          .save(finalPath);
      });

      metadata = await ffprobe(finalPath);
    } 
    // Handle regular file upload
    else {
      const originalPath = req.file.path;
      const originalFilename = req.file.filename;
      metadata = await ffprobe(originalPath);

      const baseName = originalFilename.includes('.') 
        ? originalFilename.substring(0, originalFilename.lastIndexOf('.'))
        : originalFilename;
      finalFilename = `${baseName}_h264.mp4`;
      finalPath = path.join(path.dirname(originalPath), finalFilename);

      // Apply the same FFmpeg command to uploaded files
      await new Promise((resolve, reject) => {
        ffmpeg(originalPath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions([
            '-profile:v high',
            '-level 4.0',
            '-movflags +faststart'
          ])
          .on('error', reject)
          .on('end', () => {
            // Delete the original file after conversion
            fs.unlinkSync(originalPath);
            resolve();
          })
          .save(finalPath);
      });

      metadata = await ffprobe(finalPath);
    }

    // Cleanup temporary files
    await Promise.all(
      tempFilesToCleanup.map(file => 
        unlinkAsync(file).catch(err => console.error('Error deleting temp file:', err))
    ));

    // Get title
    const autoTitle = req.body.customTitle || 
                     metadata.format.tags?.title || 
                     (req.body.youtubeUrl ? `YouTube Short ${Date.now()}` : 
                     finalFilename.replace(/\.[^/.]+$/, ''));

    const newPost = {
      id: Date.now().toString(),
      name: autoTitle,
      url: `/videos/${finalFilename}`,
      createdAt: new Date().toISOString(),
      source: req.body.youtubeUrl ? 'youtube' : 'upload'
    };

    posts.push(newPost);
    fs.writeFileSync(CATS_FILE, JSON.stringify(posts, null, 2));
    res.status(201).json(newPost);

  } catch (err) {
    console.error('Error processing video:', err);
    
    // Clean up any remaining temporary files
    if (tempFilesToCleanup && tempFilesToCleanup.length > 0) {
      await Promise.all(
        tempFilesToCleanup.map(file => 
          unlinkAsync(file).catch(cleanupErr => 
            console.error('Error during cleanup:', cleanupErr)))
      );
    }
    
    res.status(500).json({ 
      error: 'Video processing failed',
      details: err.message,
      type: err.name || 'ProcessingError'
    });
  }
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