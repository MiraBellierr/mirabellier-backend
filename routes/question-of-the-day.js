const express = require("express");
const {
  buildQuestionPreviewState,
  buildQuestionShareHtml,
  getQuestionPreviewDimensions,
  renderQuestionPreviewBuffer,
} = require("../lib/question-of-the-day-embed");
const {
  isLikelyCrawler,
  resolveProtocol,
} = require("../lib/share-preview-utils");
const {
  handleHumanSpaRequest,
  sendFrontendRedirectConfigError,
} = require("../lib/spa-entry");
const { isOwner } = require("../lib/authz");

const MAX_PROMPT_LENGTH = 240;
const MAX_ANSWER_LENGTH = 500;
const MAX_GUEST_NAME_LENGTH = 40;
const DEFAULT_ADMIN_QUEUE_PAGE_SIZE = 5;
const MAX_ADMIN_QUEUE_PAGE_SIZE = 50;
const GUEST_TOKEN_PATTERN = /^qotd:guest:[a-z0-9-]{12,}$/i;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function getCurrentRecordedDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function addDaysToRecordedDate(recordedDate, days) {
  const [year, month, day] = String(recordedDate)
    .split("-")
    .map((value) => Number(value));

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function isValidRecordedDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function setNoStoreHeaders(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function setEmbedImageCacheHeaders(res, hasVersionQuery) {
  if (hasVersionQuery) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=300");
}

function collapseWhitespace(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function sanitizePrompt(value) {
  return collapseWhitespace(value).slice(0, MAX_PROMPT_LENGTH);
}

function sanitizeAnswer(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, MAX_ANSWER_LENGTH);
}

function sanitizeGuestName(value) {
  return collapseWhitespace(value).slice(0, MAX_GUEST_NAME_LENGTH);
}

function sanitizeGuestToken(value) {
  const trimmed = collapseWhitespace(value);
  return GUEST_TOKEN_PATTERN.test(trimmed) ? trimmed : null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function shouldRedirectToSpa(req) {
  return !isLikelyCrawler(req.get("user-agent"));
}

function parsePositiveInteger(value, fallback) {
  const normalized = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(String(normalized ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function mapUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar || null,
  };
}

function mapQuestionRow(row) {
  if (!row) return null;

  return {
    recordedDate: row.recordedDate,
    prompt: row.prompt,
    lockedAt: row.lockedAt || null,
    archivedAt: row.archivedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAdminQuestionRow(row, activeRecordedDate) {
  if (!row) return null;

  return {
    recordedDate: row.recordedDate,
    prompt: row.prompt,
    lockedAt: row.lockedAt || null,
    archivedAt: row.archivedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    answerCount: Number(row.answerCount) || 0,
    isCurrent: row.recordedDate === activeRecordedDate,
  };
}

function mapAnswerRow(row, getUserById, userPublic) {
  const user = row.userId ? userPublic(getUserById(row.userId)) : null;

  return {
    id: row.id,
    recordedDate: row.recordedDate,
    answer: row.answer,
    createdAt: row.createdAt,
    guestName: row.guestName || null,
    user: mapUser(user),
  };
}

module.exports = function registerQuestionOfTheDayRoutes(app, deps) {
  const {
    db,
    authFromReq,
    getUserById,
    userPublic,
    generateSitemap,
    notifyQuestionOfTheDayDrop = () => Promise.resolve({ skipped: true }),
  } = deps;
  const router = express.Router();

  const selectQuestionByRecordedDate = db.prepare(
    `SELECT recordedDate, prompt, lockedAt, archivedAt, createdAt, updatedAt
     FROM daily_questions
     WHERE recordedDate = ?`,
  );
  const selectQuestionForMutationByRecordedDate = db.prepare(
    `SELECT recordedDate, prompt, createdByUserId, lockedAt, archivedAt, createdAt, updatedAt
     FROM daily_questions
     WHERE recordedDate = ?`,
  );
  const insertQuestion = db.prepare(
    `INSERT INTO daily_questions (
      recordedDate,
      prompt,
      createdByUserId,
      lockedAt,
      archivedAt,
      createdAt,
      updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateQuestion = db.prepare(
    `UPDATE daily_questions
     SET prompt = ?, createdByUserId = ?, updatedAt = ?
     WHERE recordedDate = ?`,
  );
  const lockQuestion = db.prepare(
    `UPDATE daily_questions
     SET lockedAt = COALESCE(lockedAt, ?)
     WHERE recordedDate = ?`,
  );
  const archiveQuestion = db.prepare(
    `UPDATE daily_questions
     SET archivedAt = COALESCE(archivedAt, ?), updatedAt = ?
     WHERE recordedDate = ?`,
  );
  const selectAnswerByIdentity = db.prepare(
    `SELECT id
     FROM daily_question_answers
     WHERE recordedDate = ? AND identityType = ? AND identityKey = ?
     LIMIT 1`,
  );
  const selectAnswersByRecordedDate = db.prepare(
    `SELECT id, recordedDate, userId, guestName, answer, createdAt
     FROM daily_question_answers
     WHERE recordedDate = ?
     ORDER BY createdAt ASC`,
  );
  const selectAnswerById = db.prepare(
    `SELECT id, recordedDate, userId, guestName, answer, createdAt
     FROM daily_question_answers
     WHERE id = ?`,
  );
  const insertAnswer = db.prepare(
    `INSERT INTO daily_question_answers (
      id,
      recordedDate,
      userId,
      guestName,
      identityType,
      identityKey,
      answer,
      createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const deleteAnswer = db.prepare(
    "DELETE FROM daily_question_answers WHERE id = ?",
  );
  const selectArchiveSummaries = db.prepare(
    `SELECT
       q.recordedDate,
       q.prompt,
       q.createdAt,
       q.updatedAt,
       COUNT(a.id) AS answerCount
     FROM daily_questions q
     LEFT JOIN daily_question_answers a ON a.recordedDate = q.recordedDate
     WHERE q.archivedAt IS NOT NULL OR q.recordedDate < ?
     GROUP BY q.recordedDate, q.prompt, q.createdAt, q.updatedAt
     ORDER BY q.recordedDate DESC`,
  );
  const selectArchivedQuestionByRecordedDate = db.prepare(
    `SELECT recordedDate, prompt, lockedAt, archivedAt, createdAt, updatedAt
     FROM daily_questions
     WHERE recordedDate = ? AND (archivedAt IS NOT NULL OR recordedDate < ?)`,
  );
  const selectScheduledRecordedDatesFromRecordedDate = db.prepare(
    `SELECT recordedDate
     FROM daily_questions
     WHERE recordedDate >= ?
     ORDER BY recordedDate ASC`,
  );
  const selectAdminQuestionCountFromRecordedDate = db.prepare(
    `SELECT COUNT(*) AS totalCount
     FROM daily_questions
     WHERE recordedDate >= ? AND archivedAt IS NULL`,
  );
  const selectAdminQuestionsFromRecordedDate = db.prepare(
    `SELECT
       q.recordedDate,
       q.prompt,
       q.lockedAt,
       q.archivedAt,
       q.createdAt,
       q.updatedAt,
       COUNT(a.id) AS answerCount
     FROM daily_questions q
     LEFT JOIN daily_question_answers a ON a.recordedDate = q.recordedDate
     WHERE q.recordedDate >= ? AND q.archivedAt IS NULL
     GROUP BY q.recordedDate, q.prompt, q.lockedAt, q.archivedAt, q.createdAt, q.updatedAt
     ORDER BY q.recordedDate ASC`,
  );
  const selectAdminQuestionsPageFromRecordedDate = db.prepare(
    `SELECT
       q.recordedDate,
       q.prompt,
       q.lockedAt,
       q.archivedAt,
       q.createdAt,
       q.updatedAt,
       COUNT(a.id) AS answerCount
     FROM daily_questions q
     LEFT JOIN daily_question_answers a ON a.recordedDate = q.recordedDate
     WHERE q.recordedDate >= ? AND q.archivedAt IS NULL
     GROUP BY q.recordedDate, q.prompt, q.lockedAt, q.archivedAt, q.createdAt, q.updatedAt
     ORDER BY q.recordedDate ASC
     LIMIT ? OFFSET ?`,
  );
  const selectActiveCarriedQuestionThroughRecordedDate = db.prepare(
    `SELECT
       q.recordedDate,
       q.prompt,
       q.lockedAt,
       q.archivedAt,
       q.createdAt,
       q.updatedAt
     FROM daily_questions q
     LEFT JOIN daily_question_answers a ON a.recordedDate = q.recordedDate
     WHERE q.recordedDate <= ? AND q.archivedAt IS NULL
     GROUP BY q.recordedDate, q.prompt, q.lockedAt, q.archivedAt, q.createdAt, q.updatedAt
     HAVING COUNT(a.id) = 0 OR substr(q.lockedAt, 1, 10) = ?
     ORDER BY q.recordedDate ASC
     LIMIT 1`,
  );

  const createAnswerTransaction = db.transaction((payload) => {
    const question = selectQuestionForMutationByRecordedDate.get(
      payload.recordedDate,
    );

    if (!question) {
      throw new HttpError(404, "No active question right now");
    }

    const existingAnswer = selectAnswerByIdentity.get(
      payload.recordedDate,
      payload.identityType,
      payload.identityKey,
    );

    if (existingAnswer) {
      throw new HttpError(409, "You already answered this question");
    }

    insertAnswer.run(
      payload.id,
      payload.recordedDate,
      payload.userId,
      payload.guestName,
      payload.identityType,
      payload.identityKey,
      payload.answer,
      payload.createdAt,
    );

    if (!question.lockedAt) {
      lockQuestion.run(payload.createdAt, payload.recordedDate);
    }

    return selectAnswerById.get(payload.id);
  });

  const queueQuestionsTransaction = db.transaction((payload) => {
    const occupiedDates = new Set(
      selectScheduledRecordedDatesFromRecordedDate
        .all(payload.startRecordedDate)
        .map((row) => row.recordedDate),
    );
    const insertedRecordedDates = [];
    let nextRecordedDate = payload.startRecordedDate;

    for (const prompt of payload.prompts) {
      while (occupiedDates.has(nextRecordedDate)) {
        nextRecordedDate = addDaysToRecordedDate(nextRecordedDate, 1);
      }

      insertQuestion.run(
        nextRecordedDate,
        prompt,
        payload.userId,
        null,
        null,
        payload.now,
        payload.now,
      );

      occupiedDates.add(nextRecordedDate);
      insertedRecordedDates.push(nextRecordedDate);
      nextRecordedDate = addDaysToRecordedDate(nextRecordedDate, 1);
    }

    return insertedRecordedDates;
  });

  function loadAnswers(recordedDate) {
    return selectAnswersByRecordedDate
      .all(recordedDate)
      .map((row) => mapAnswerRow(row, getUserById, userPublic));
  }

  function getActiveQuestionRow(currentRecordedDate) {
    const todaysQuestion = selectQuestionByRecordedDate.get(currentRecordedDate);

    return (
      selectActiveCarriedQuestionThroughRecordedDate.get(
        currentRecordedDate,
        currentRecordedDate,
      ) || (todaysQuestion && !todaysQuestion.archivedAt ? todaysQuestion : null)
    );
  }

  function getArchiveCutoffRecordedDate(currentRecordedDate) {
    return (
      getActiveQuestionRow(currentRecordedDate)?.recordedDate ||
      currentRecordedDate
    );
  }

  function loadAllAdminQuestions(currentRecordedDate) {
    const activeRecordedDate =
      getActiveQuestionRow(currentRecordedDate)?.recordedDate || null;
    const startRecordedDate = activeRecordedDate || currentRecordedDate;

    return selectAdminQuestionsFromRecordedDate
      .all(startRecordedDate)
      .map((row) => mapAdminQuestionRow(row, activeRecordedDate));
  }

  function loadAdminQuestionsPage(currentRecordedDate, options = {}) {
    const activeRecordedDate =
      getActiveQuestionRow(currentRecordedDate)?.recordedDate || null;
    const startRecordedDate = activeRecordedDate || currentRecordedDate;
    const pageSize = clamp(
      parsePositiveInteger(
        options.pageSize,
        DEFAULT_ADMIN_QUEUE_PAGE_SIZE,
      ),
      1,
      MAX_ADMIN_QUEUE_PAGE_SIZE,
    );
    const totalQuestions =
      Number(
        selectAdminQuestionCountFromRecordedDate.get(startRecordedDate)
          ?.totalCount,
      ) || 0;
    const totalPages =
      totalQuestions > 0 ? Math.ceil(totalQuestions / pageSize) : 0;
    const page =
      totalPages > 0
        ? clamp(parsePositiveInteger(options.page, 1), 1, totalPages)
        : 1;
    const offset = totalQuestions > 0 ? (page - 1) * pageSize : 0;
    const questions =
      totalQuestions > 0
        ? selectAdminQuestionsPageFromRecordedDate
            .all(startRecordedDate, pageSize, offset)
            .map((row) => mapAdminQuestionRow(row, activeRecordedDate))
        : [];

    return {
      currentRecordedDate,
      page,
      pageSize,
      totalQuestions,
      totalPages,
      hasPreviousPage: page > 1,
      hasNextPage: totalPages > 0 && page < totalPages,
      questions,
    };
  }

  function buildCurrentPayload(req) {
    const currentRecordedDate = getCurrentRecordedDate();
    const question = getActiveQuestionRow(currentRecordedDate);
    const user = authFromReq(req);
    const viewerMode = user ? "user" : "guest";
    const identityType = user ? "user" : "guest";
    const identityKey = user
      ? user.id
      : sanitizeGuestToken(req.query?.guestToken);
    const questionRecordedDate = question?.recordedDate || null;
    const hasAnswered =
      !!questionRecordedDate &&
      !!identityKey &&
      !!selectAnswerByIdentity.get(
        questionRecordedDate,
        identityType,
        identityKey,
      );
    const answers = questionRecordedDate ? loadAnswers(questionRecordedDate) : [];

    return {
      currentRecordedDate,
      question: mapQuestionRow(question),
      answers,
      canAnswer: Boolean(question) && !hasAnswered,
      hasAnswered,
      viewerMode,
    };
  }

  function buildPreviewState() {
    const currentRecordedDate = getCurrentRecordedDate();
    return buildQuestionPreviewState({
      currentRecordedDate,
      question: mapQuestionRow(getActiveQuestionRow(currentRecordedDate)),
    });
  }

  app.get("/question-of-the-day", async (req, res) => {
    try {
      if (shouldRedirectToSpa(req)) {
        if (handleHumanSpaRequest(req, res, "/question-of-the-day")) return;
        return sendFrontendRedirectConfigError(res);
      }

      const host = req.get("host") || "mirabellier.com";
      const protocol = resolveProtocol(req);
      const state = buildPreviewState();
      const html = buildQuestionShareHtml({
        state,
        protocol,
        host,
        spaPath: "/question-of-the-day",
      });

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      setNoStoreHeaders(res);
      res.send(html);
    } catch {
      res.status(500).send("Server error");
    }
  });

  app.get("/question-of-the-day/embed-image.png", async (req, res) => {
    try {
      const state = buildPreviewState();
      const dimensions = getQuestionPreviewDimensions(state);
      const imageBuffer = await renderQuestionPreviewBuffer(state);

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", String(imageBuffer.length));
      res.setHeader("X-Preview-Version", String(state.version || "fallback"));
      res.setHeader("X-Preview-Width", String(dimensions.width));
      res.setHeader("X-Preview-Height", String(dimensions.height));
      setEmbedImageCacheHeaders(
        res,
        typeof req.query.v === "string" && req.query.v.trim().length > 0,
      );
      res.send(imageBuffer);
    } catch {
      res.status(500).send("Failed to render question preview image");
    }
  });

  router.get("/current", (req, res) => {
    try {
      setNoStoreHeaders(res);
      res.json(buildCurrentPayload(req));
    } catch (error) {
      setNoStoreHeaders(res);
      res.status(500).json({
        error: "Failed to load question of the day",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  router.post("/current", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!isOwner(user)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const prompt = sanitizePrompt(req.body?.prompt);
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const recordedDate = getCurrentRecordedDate();
      const now = new Date().toISOString();
      const existingQuestion =
        selectQuestionForMutationByRecordedDate.get(recordedDate);

      if (existingQuestion?.lockedAt) {
        return res.status(409).json({
          error: "Prompt can no longer be edited after answers have been posted",
        });
      }

      if (existingQuestion?.archivedAt) {
        return res.status(409).json({
          error: "This day has already been forced into the archive",
        });
      }

      if (existingQuestion) {
        updateQuestion.run(prompt, user.id, now, recordedDate);
      } else {
        insertQuestion.run(recordedDate, prompt, user.id, null, null, now, now);
      }

      generateSitemap(db);
      void notifyQuestionOfTheDayDrop();
      setNoStoreHeaders(res);
      res.json({
        question: mapQuestionRow(selectQuestionByRecordedDate.get(recordedDate)),
      });
    } catch (error) {
      setNoStoreHeaders(res);
      res.status(500).json({
        error: "Failed to save question of the day",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  router.post("/current/answers", (req, res) => {
    try {
      const user = authFromReq(req);
      const answer = sanitizeAnswer(req.body?.answer);

      if (!answer) {
        return res.status(400).json({ error: "Answer is required" });
      }

      const viewerMode = user ? "user" : "guest";
      const identityType = viewerMode;
      const identityKey = user
        ? user.id
        : sanitizeGuestToken(req.body?.guestToken);

      if (!identityKey) {
        return res.status(400).json({ error: "A valid guest token is required" });
      }

      const guestName = user ? null : sanitizeGuestName(req.body?.name);

      if (!user && !guestName) {
        return res.status(400).json({ error: "Name is required" });
      }

      const payload = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        recordedDate:
          getActiveQuestionRow(getCurrentRecordedDate())?.recordedDate || null,
        userId: user ? user.id : null,
        guestName,
        identityType,
        identityKey,
        answer,
        createdAt: new Date().toISOString(),
      };

      if (!payload.recordedDate) {
        return res.status(404).json({ error: "No active question right now" });
      }

      const row = createAnswerTransaction(payload);

      void notifyQuestionOfTheDayDrop();
      setNoStoreHeaders(res);
      res.status(201).json(mapAnswerRow(row, getUserById, userPublic));
    } catch (error) {
      if (error instanceof HttpError) {
        setNoStoreHeaders(res);
        return res.status(error.status).json({ error: error.message });
      }

      if (
        error &&
        typeof error === "object" &&
        String(error.code || "").toUpperCase() ===
          "SQLITE_CONSTRAINT_UNIQUE"
      ) {
        setNoStoreHeaders(res);
        return res.status(409).json({ error: "You already answered this question" });
      }

      setNoStoreHeaders(res);
      res.status(500).json({
        error: "Failed to submit answer",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  router.get("/admin/questions", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!isOwner(user)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const currentRecordedDate = getCurrentRecordedDate();

      setNoStoreHeaders(res);
      res.json(
        loadAdminQuestionsPage(currentRecordedDate, {
          page: req.query?.page,
          pageSize: req.query?.pageSize,
        }),
      );
    } catch (error) {
      setNoStoreHeaders(res);
      res.status(500).json({
        error: "Failed to load scheduled questions",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  router.post("/admin/questions", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!isOwner(user)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const prompts = Array.isArray(req.body?.prompts)
        ? req.body.prompts.map(sanitizePrompt).filter(Boolean)
        : [];

      if (!prompts.length) {
        return res.status(400).json({
          error: "Add at least one non-empty question",
        });
      }

      const currentRecordedDate = getCurrentRecordedDate();
      const now = new Date().toISOString();
      const addedRecordedDates = queueQuestionsTransaction({
        prompts,
        startRecordedDate: currentRecordedDate,
        userId: user.id,
        now,
      });

      generateSitemap(db);
      void notifyQuestionOfTheDayDrop();
      setNoStoreHeaders(res);
      res.status(201).json({
        currentRecordedDate,
        addedCount: addedRecordedDates.length,
        addedQuestions: addedRecordedDates.map((recordedDate) =>
          mapQuestionRow(selectQuestionByRecordedDate.get(recordedDate)),
        ),
        questions: loadAllAdminQuestions(currentRecordedDate),
      });
    } catch (error) {
      setNoStoreHeaders(res);
      res.status(500).json({
        error: "Failed to queue questions",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  router.post("/admin/current/force-archive", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!isOwner(user)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const currentRecordedDate = getCurrentRecordedDate();
      const activeQuestion = getActiveQuestionRow(currentRecordedDate);

      if (!activeQuestion) {
        return res.status(404).json({ error: "No active question to archive" });
      }

      const now = new Date().toISOString();
      archiveQuestion.run(now, now, activeQuestion.recordedDate);

      generateSitemap(db);
      void notifyQuestionOfTheDayDrop();
      setNoStoreHeaders(res);
      res.json({
        archivedQuestion: mapQuestionRow(
          selectQuestionByRecordedDate.get(activeQuestion.recordedDate),
        ),
        currentRecordedDate,
        question: mapQuestionRow(getActiveQuestionRow(currentRecordedDate)),
        questions: loadAllAdminQuestions(currentRecordedDate),
      });
    } catch (error) {
      setNoStoreHeaders(res);
      res.status(500).json({
        error: "Failed to archive the active question",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  router.get("/archive", (req, res) => {
    try {
      const currentRecordedDate = getCurrentRecordedDate();
      const archiveCutoffRecordedDate =
        getArchiveCutoffRecordedDate(currentRecordedDate);
      const entries = selectArchiveSummaries
        .all(archiveCutoffRecordedDate)
        .map((row) => ({
          recordedDate: row.recordedDate,
          prompt: row.prompt,
          answerCount: Number(row.answerCount) || 0,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }));

      setNoStoreHeaders(res);
      res.json(entries);
    } catch (error) {
      setNoStoreHeaders(res);
      res.status(500).json({
        error: "Failed to load question archive",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  router.get("/archive/:recordedDate", (req, res) => {
    const { recordedDate } = req.params;

    if (!isValidRecordedDate(recordedDate)) {
      setNoStoreHeaders(res);
      return res.status(400).json({
        error: "Invalid date format",
        details: "Use YYYY-MM-DD",
      });
    }

    try {
      const currentRecordedDate = getCurrentRecordedDate();
      const archiveCutoffRecordedDate =
        getArchiveCutoffRecordedDate(currentRecordedDate);
      const question = selectArchivedQuestionByRecordedDate.get(
        recordedDate,
        archiveCutoffRecordedDate,
      );

      if (!question) {
        setNoStoreHeaders(res);
        return res.status(404).json({ error: "Archived question not found" });
      }

      const answers = loadAnswers(recordedDate);

      setNoStoreHeaders(res);
      res.json({
        recordedDate,
        question: mapQuestionRow(question),
        answers,
        answerCount: answers.length,
      });
    } catch (error) {
      setNoStoreHeaders(res);
      res.status(500).json({
        error: "Failed to load archived question",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  router.delete("/answers/:id", (req, res) => {
    try {
      const user = authFromReq(req);
      if (!isOwner(user)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const result = deleteAnswer.run(req.params.id);
      if (result.changes === 0) {
        return res.status(404).json({ error: "Answer not found" });
      }

      setNoStoreHeaders(res);
      res.json({ ok: true });
    } catch (error) {
      setNoStoreHeaders(res);
      res.status(500).json({
        error: "Failed to delete answer",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.use("/question-of-the-day", router);
};
