const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const S2C = require("./websocket-events").S2C;

/** @type {ReturnType<typeof makeWebSocketManager> | null} */
let instance = null;

function makeWebSocketManager(wss, { db, handleMessage }) {
  // userId (string) → Set<WebSocket>
  const connections = new Map();

  // in-memory token store: token → { userId, expiresAt }
  const wsTokens = new Map();

  function createWsToken(userId) {
    const token = crypto.randomBytes(32).toString("hex");
    wsTokens.set(token, { userId, expiresAt: Date.now() + 60000 });
    return token;
  }

  function validateWsToken(token) {
    const entry = wsTokens.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      wsTokens.delete(token);
      return null;
    }
    wsTokens.delete(token); // one-time use
    return entry.userId;
  }

  // Clean expired tokens every 2 minutes
  const tokenCleanup = setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of wsTokens) {
      if (now > entry.expiresAt) wsTokens.delete(token);
    }
  }, 120000).unref();

  function sendToUser(userId, data) {
    const userConns = connections.get(String(userId));
    if (!userConns) return;
    const raw = JSON.stringify(data);
    for (const ws of userConns) {
      if (ws.readyState === 1) ws.send(raw);
    }
  }

  function sendToUsers(userIds, data) {
    const raw = JSON.stringify(data);
    for (const id of userIds) {
      const userConns = connections.get(String(id));
      if (!userConns) continue;
      for (const ws of userConns) {
        if (ws.readyState === 1) ws.send(raw);
      }
    }
  }

  function broadcast(data) {
    const raw = JSON.stringify(data);
    for (const [, userConns] of connections) {
      for (const ws of userConns) {
        if (ws.readyState === 1) ws.send(raw);
      }
    }
  }

  function hasConnections(userId) {
    const userConns = connections.get(String(userId));
    return userConns ? userConns.size > 0 : false;
  }

  function getConnectedUserIds() {
    return Array.from(connections.keys());
  }

  // Heartbeat
  const heartbeat = setInterval(() => {
    for (const [, userConns] of connections) {
      for (const ws of userConns) {
        if (ws.isAlive === false) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }
  }, 30000);

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token");
    const userId = validateWsToken(token);

    if (!userId) {
      ws.close(4001, "Unauthorized");
      return;
    }

    const uid = String(userId);
    if (!connections.has(uid)) connections.set(uid, new Set());
    connections.get(uid).add(ws);

    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("error", () => {
      // ignore transport errors
    });

    if (handleMessage) {
      ws.on("message", (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        if (msg && typeof msg.type === "string") {
          const result = handleMessage(uid, msg, (data) => sendToUser(uid, data));
          if (result && typeof result.catch === "function") {
            result.catch(() => {
              // ignore async handler errors to keep connection alive
            });
          }
        }
      });
    }

    ws.on("close", () => {
      const userConns = connections.get(uid);
      if (userConns) {
        userConns.delete(ws);
        if (userConns.size === 0) connections.delete(uid);
      }
    });
  });

  wss.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(tokenCleanup);
  });

  return {
    createWsToken,
    sendToUser,
    sendToUsers,
    broadcast,
    hasConnections,
    getConnectedUserIds,
  };
}

/**
 * Create WebSocket server attached to the HTTP server.
 * Must be called once during app startup.
 */
function initWebSocketServer(httpServer, deps) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  instance = makeWebSocketManager(wss, deps);
  return instance;
}

/**
 * Returns the WebSocket manager instance (null before init).
 */
function getWebSocketManager() {
  return instance;
}

module.exports = { initWebSocketServer, getWebSocketManager, S2C };
