const {
  HTTP_CACHE_TTL_MS,
  getQuotesOfTheDay,
  isValidRecordedDate,
} = require("../lib/quote-of-the-day");

module.exports = function registerQuoteRoutes(app) {
  app.get("/quote-of-the-day", async (req, res) => {
    const recordedDate = req.query.date ? String(req.query.date) : null;

    if (recordedDate && !isValidRecordedDate(recordedDate)) {
      return res.status(400).json({
        error: "Invalid date format",
        details: "Use YYYY-MM-DD for the date query parameter",
      });
    }

    try {
      const quotes = await getQuotesOfTheDay({ recordedDate });

      if (!quotes) {
        return res.status(404).json({
          error: "Quotes not found for the requested date",
        });
      }

      res.setHeader(
        "Cache-Control",
        `public, max-age=${Math.floor(HTTP_CACHE_TTL_MS / 1000)}`,
      );
      res.json(quotes);
    } catch (error) {
      res.status(502).json({
        error: "Failed to load quotes of the day",
        details:
          error instanceof Error ? error.message : "Unknown quote error",
      });
    }
  });
};
