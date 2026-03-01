const fs = require("fs");
const path = require("path");
const multer = require("multer");
const sharp = require("sharp");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
]);

function resolveDir(envVar, defaultName) {
  const envVal = process.env[envVar];
  if (envVal) {
    const resolved = path.isAbsolute(envVal)
      ? envVal
      : path.resolve(__dirname, "..", envVal);
    return resolved;
  }
  return path.join(__dirname, "..", defaultName);
}

function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function buildUniqueFilename(
  prefix,
  originalName,
  allowEmptyExtension = false,
) {
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const ext = path.extname(originalName);
  const safeExt = ext || (allowEmptyExtension ? "" : ".bin");
  return `${prefix}${uniqueSuffix}${safeExt}`;
}

function createDiskStorage(
  destinationDir,
  filenamePrefix,
  allowEmptyExtension,
) {
  return multer.diskStorage({
    destination: (_, __, cb) => cb(null, destinationDir),
    filename: (_, file, cb) => {
      cb(
        null,
        buildUniqueFilename(
          filenamePrefix,
          file.originalname,
          allowEmptyExtension,
        ),
      );
    },
  });
}

const IMAGES_DIR = resolveDir("IMAGES_DIR", "images");
const VIDEOS_DIR = resolveDir("VIDEOS_DIR", "videos");
ensureDirExists(IMAGES_DIR);
ensureDirExists(VIDEOS_DIR);

const imageStorage = createDiskStorage(IMAGES_DIR, "mirabellier-image-", true);
const videoStorage = createDiskStorage(VIDEOS_DIR, "mirabellier-video-", true);

const imageUpload = multer({ storage: imageStorage });

const videoUpload = multer({
  storage: videoStorage,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB
    files: 1,
    fields: 5,
    fieldSize: 1024 * 1024 * 1024, // 1GB
  },
  fileFilter: (_, file, cb) => {
    if (VIDEO_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error("Invalid file type. Only video files are allowed."));
  },
});

async function writeOptimizedOriginal(filePath, optimizedPath) {
  await sharp(filePath)
    .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, progressive: true })
    .png({ quality: 85, compressionLevel: 9 })
    .toFile(`${optimizedPath}.tmp`);

  fs.renameSync(`${optimizedPath}.tmp`, optimizedPath);
}

async function writeWebpVersion(filePath, webpPath) {
  await sharp(filePath)
    .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(webpPath);
}

// Optimize uploaded images - compress and create WebP version
async function optimizeImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return;

  const baseName = path.basename(filePath, ext);
  const dir = path.dirname(filePath);
  const optimizedPath = path.join(dir, `${baseName}${ext}`);
  const webpPath = path.join(dir, `${baseName}.webp`);

  try {
    await writeOptimizedOriginal(filePath, optimizedPath);
    await writeWebpVersion(filePath, webpPath);
  } catch {
    // Preserve existing behavior: optimization failures do not block uploads.
  }
}

module.exports = {
  IMAGES_DIR,
  VIDEOS_DIR,
  imageUpload,
  videoUpload,
  optimizeImage,
};
