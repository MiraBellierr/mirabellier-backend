const fs = require('fs');
const path = require('path');
const multer = require('multer');

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
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
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

module.exports = {
  IMAGES_DIR,
  VIDEOS_DIR,
  imageUpload,
  videoUpload,
};
