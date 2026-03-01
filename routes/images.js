const path = require("path");
const fs = require("fs");

function isSafeFilename(filename) {
  return Boolean(
    filename &&
    !filename.includes("..") &&
    !filename.includes("/") &&
    !filename.includes("\\"),
  );
}

function listImageFiles(imagesDir) {
  if (!fs.existsSync(imagesDir)) return [];

  return fs.readdirSync(imagesDir).filter((filename) => {
    const fullPath = path.join(imagesDir, filename);
    try {
      return fs.statSync(fullPath).isFile();
    } catch {
      return false;
    }
  });
}

function mapImageMetadata(imagesDir, filename) {
  const fullPath = path.join(imagesDir, filename);
  const stat = fs.statSync(fullPath);

  return {
    filename,
    url: `/images/${filename}`,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

module.exports = function registerImageRoutes(app, deps) {
  const { IMAGES_DIR } = deps;

  app.get("/images/list", (req, res) => {
    try {
      const files = listImageFiles(IMAGES_DIR);
      const list = files
        .map((filename) => mapImageMetadata(IMAGES_DIR, filename))
        .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));

      // Cache image list for 2 minutes
      res.setHeader("Cache-Control", "public, max-age=120");
      res.json(list);
    } catch {
      res.status(500).json({ error: "Failed to read images" });
    }
  });

  app.get("/images/meta/:filename", (req, res) => {
    try {
      const filename = req.params.filename;
      if (!isSafeFilename(filename)) {
        return res.status(400).json({ error: "invalid filename" });
      }

      const fullPath = path.join(IMAGES_DIR, filename);
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: "not found" });
      }

      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) return res.status(404).json({ error: "not found" });

      // Cache metadata for 1 hour
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.json({
        filename,
        url: `/images/${filename}`,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch {
      res.status(500).json({ error: "failed" });
    }
  });
};
