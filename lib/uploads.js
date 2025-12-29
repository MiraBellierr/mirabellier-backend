const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');

function resolveDir(envVar, defaultName) {
  const envVal = process.env[envVar];
  if (envVal) {
    const resolved = path.isAbsolute(envVal) ? envVal : path.resolve(__dirname, '..', envVal);
    return resolved;
  }
  return path.join(__dirname, '..', defaultName);
}

const IMAGES_DIR = resolveDir('IMAGES_DIR', 'images');
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

const VIDEOS_DIR = resolveDir('VIDEOS_DIR', 'videos');
if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, IMAGES_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '';
    cb(null, 'mirabellier-image-' + uniqueSuffix + ext);
  },
});

const VideoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VIDEOS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'mirabellier-video-' + uniqueSuffix + ext);
  }
});

const imageUpload = multer({ storage: imageStorage });

const videoUpload = multer({
  storage: VideoStorage,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1,
    fields: 5,
    fieldSize: 50 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];
    if (allowedTypes.includes(file.mimetype)) cb(null, true); else cb(new Error('Invalid file type. Only video files are allowed.'));
  }
});

// Optimize uploaded images - compress and create WebP version
async function optimizeImage(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const baseName = path.basename(filePath, ext);
    const dir = path.dirname(filePath);
    
    // Create optimized JPEG/PNG
    if (['.jpg', '.jpeg', '.png'].includes(ext)) {
      const optimizedPath = path.join(dir, `${baseName}${ext}`);
      await sharp(filePath)
        .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .png({ quality: 85, compressionLevel: 9 })
        .toFile(optimizedPath + '.tmp');
      
      fs.renameSync(optimizedPath + '.tmp', optimizedPath);
      
      // Create WebP version for modern browsers
      const webpPath = path.join(dir, `${baseName}.webp`);
      await sharp(filePath)
        .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(webpPath);
    }
  } catch (err) {
    console.error('Image optimization error:', err);
  }
}

module.exports = {
  IMAGES_DIR,
  VIDEOS_DIR,
  imageUpload,
  videoUpload,
  optimizeImage,
};
