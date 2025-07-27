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
    let tempFilesToCleanup = []; // Track temporary files for cleanup

    // Handle YouTube Shorts URL
    if (req.body.youtubeUrl) {
      const youtubeUrl = req.body.youtubeUrl;
      if (!youtubeUrl.includes('youtube.com/shorts/') && !youtubeUrl.includes('youtu.be/')) {
        return res.status(400).json({ error: 'Only YouTube Shorts URLs are allowed.' });
      }

      const tempName = `yt_temp_${Date.now()}`;
      const tempPath = path.join(__dirname, 'videos', tempName);
      
      // Download YouTube video - let youtube-dl choose the filename
      await ytdl(youtubeUrl, {
        output: tempPath,
        format: 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        noCheckCertificates: true,
        noWarnings: true,
        preferFreeFormats: true,
        addHeader: ['referer:youtube.com', 'user-agent:googlebot']
      });

      // Find all files that start with our temp name
      const files = fs.readdirSync(path.join(__dirname, 'videos'));
      const downloadedFiles = files.filter(f => f.startsWith(tempName));
      if (downloadedFiles.length === 0) {
        throw new Error('Failed to find downloaded YouTube video');
      }

      // Find the main video file (prioritize .mp4)
      const mainFile = downloadedFiles.find(f => f.endsWith('.mp4')) || downloadedFiles[0];
      const mainFilePath = path.join(__dirname, 'videos', mainFile);
      
      // Track all temp files for cleanup
      tempFilesToCleanup = downloadedFiles
        .filter(f => f !== mainFile)
        .map(f => path.join(__dirname, 'videos', f));

      // Rename to our final filename
      finalFilename = `yt_${Date.now()}_h264.mp4`;
      finalPath = path.join(__dirname, 'videos', finalFilename);
      fs.renameSync(mainFilePath, finalPath);

      metadata = await ffprobe(finalPath);
    } 
    // Handle regular file upload
    else {
      const originalPath = req.file.path;
      const originalFilename = req.file.filename;
      metadata = await ffprobe(originalPath);

      // Check if video is H.264
      const isH264 = metadata.streams.some(stream => 
        stream.codec_type === 'video' && stream.codec_name === 'h264'
      );

      // Check if audio is AAC
      const isAAC = metadata.streams.some(stream => 
        stream.codec_type === 'audio' && stream.codec_name === 'aac'
      );

      if (isH264 && isAAC) {
        finalFilename = originalFilename;
        finalPath = originalPath;
      } else {
        const baseName = originalFilename.includes('.') 
          ? originalFilename.substring(0, originalFilename.lastIndexOf('.'))
          : originalFilename;
        finalFilename = `${baseName}_h264.mp4`;
        finalPath = path.join(path.dirname(originalPath), finalFilename);

        await new Promise((resolve, reject) => {
          const command = ffmpeg(originalPath)
            .videoCodec(isH264 ? 'copy' : 'libx264')
            .audioCodec(isAAC ? 'copy' : 'aac')
            .outputOptions([
              '-movflags faststart',
              '-preset fast',
              '-crf 23'
            ])
            .on('error', reject)
            .on('end', resolve)
            .save(finalPath);
        });

        // Delete original file if we converted it
        await unlinkAsync(originalPath);
      }
    }

    // Cleanup any temporary files from YouTube download
    await Promise.all(
      tempFilesToCleanup.map(file => 
        unlinkAsync(file).catch(err => console.error('Error deleting temp file:', err))
    ));

    // Get title from metadata, YouTube URL, or filename
    const autoTitle = metadata.format.tags?.title || 
                     req.body.customTitle ||
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
    res.status(500).json({ error: 'Video processing failed', details: err.message });
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