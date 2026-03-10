const { getQuotesOfTheDay, isValidRecordedDate } = require("../lib/quote-of-the-day");

function setNoStoreHeaders(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

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
        setNoStoreHeaders(res);
        return res.status(404).json({
          error: "Quotes not found for the requested date",
        });
      }

      setNoStoreHeaders(res);
      res.json(quotes);
    } catch (error) {
      setNoStoreHeaders(res);
      res.status(502).json({
        error: "Failed to load quotes of the day",
        details:
          error instanceof Error ? error.message : "Unknown quote error",
      });
    }
  });
};
