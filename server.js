const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const {
  seatOrder,
  createInitialRoomState,
  buildSnapshot,
  ensureGameReady,
  move,
  action,
  normalizeGameType,
  computeGobangAiMove,
} = require("./game-logic");
const { initDatabase, authenticateUser } = require("./db");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");

const rooms = new Map();
const sessions = new Map();

function makeRoomId() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function makeClientId() {
  return crypto.randomUUID();
}

function createRoom(gameType, aiMode) {
  const normalized = normalizeGameType(gameType);
  let id = makeRoomId();
  while (rooms.has(id)) {
    id = makeRoomId();
  }
  const base = createInitialRoomState(normalized);
  const room = {
    id,
    gameType: normalized,
    players: {},
    status: base.status,
    currentTurn: base.currentTurn,
    winner: base.winner,
    draw: base.draw,
    board: base.board,
    captures: base.captures,
    passCount: base.passCount,
    history: base.history,
    resultText: "等待对手加入。",
    lastMove: base.lastMove,
    updatedAt: base.updatedAt,
    score: null,
    sockets: new Map(),
    ai: aiMode || false,
  };
  seatOrder(normalized).forEach((side) => {
    room.players[side] = null;
  });
  if (room.ai) {
    const aiSide = seatOrder(normalized)[1];
    room.players[aiSide] = "AI";
    room.resultText = "练习模式";
    ensureGameReady(room);
  }
  rooms.set(id, room);
  return room;
}

function attachPlayer(room, clientId) {
  let side = seatOrder(room.gameType).find((seat) => room.players[seat] === clientId) || null;
  if (side) {
    return side;
  }
  const openSeat = seatOrder(room.gameType).find((seat) => !room.players[seat]);
  if (openSeat) {
    room.players[openSeat] = clientId;
    side = openSeat;
    ensureGameReady(room);
    return side;
  }
  return null;
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function safeJoin(base, target) {
  const resolved = path.resolve(base, "." + target);
  if (!resolved.startsWith(path.resolve(base))) {
    return null;
  }
  return resolved;
}

function serveStatic(req, res, urlPath) {
  const target = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = safeJoin(PUBLIC_DIR, target);
  if (!filePath) {
    sendText(res, 400, "Bad request");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendText(res, 404, "Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function getRoomState(roomId, clientId) {
  const room = rooms.get(roomId);
  if (!room) {
    return null;
  }
  return buildSnapshot(room, clientId);
}

function pushRoomState(room) {
  for (const [clientId, sockets] of room.sockets.entries()) {
    const snapshot = buildSnapshot(room, clientId);
    const payload = `event: state\ndata: ${JSON.stringify(snapshot)}\n\n`;
    for (const socket of sockets) {
      try {
        socket.write(payload);
      } catch (err) {
        sockets.delete(socket);
      }
    }
    if (sockets.size === 0) {
      room.sockets.delete(clientId);
    }
  }
}

function addSocket(room, clientId, res) {
  if (!room.sockets.has(clientId)) {
    room.sockets.set(clientId, new Set());
  }
  room.sockets.get(clientId).add(res);
}

function removeSocket(room, clientId, res) {
  const sockets = room.sockets.get(clientId);
  if (!sockets) {
    return;
  }
  sockets.delete(res);
  if (sockets.size === 0) {
    room.sockets.delete(clientId);
  }
}

function findClientSide(room, clientId) {
  return seatOrder(room.gameType).find((seat) => room.players[seat] === clientId) || null;
}

function ensureRoomClient(room, clientId) {
  const side = attachPlayer(room, clientId);
  if (side) {
    pushRoomState(room);
  }
  return side;
}

async function handleCreateRoom(req, res) {
  const body = await parseJsonBody(req);
  const clientId = body.clientId || makeClientId();
  const gameType = body.gameType;
  if (!gameType) {
    sendJson(res, 400, { ok: false, message: "请选择棋类。" });
    return;
  }
  const room = createRoom(gameType, body.ai);
  const side = ensureRoomClient(room, clientId);
  const snapshot = buildSnapshot(room, clientId);
  sendJson(res, 200, {
    ok: true,
    clientId,
    roomId: room.id,
    side,
    snapshot,
  });
}

async function handleJoinRoom(req, res) {
  const body = await parseJsonBody(req);
  const roomId = String(body.roomId || "").trim().toUpperCase();
  const clientId = body.clientId || makeClientId();
  if (!roomId) {
    sendJson(res, 400, { ok: false, message: "请输入房间号。" });
    return;
  }
  const room = rooms.get(roomId);
  if (!room) {
    sendJson(res, 404, { ok: false, message: "房间不存在。" });
    return;
  }
  ensureRoomClient(room, clientId);
  const side = findClientSide(room, clientId);
  sendJson(res, 200, {
    ok: true,
    clientId,
    roomId: room.id,
    side,
    snapshot: buildSnapshot(room, clientId),
  });
}

async function handleState(req, res, url) {
  const roomId = String(url.searchParams.get("roomId") || "").trim().toUpperCase();
  const clientId = String(url.searchParams.get("clientId") || "").trim();
  if (!roomId) {
    sendJson(res, 400, { ok: false, message: "缺少房间号。" });
    return;
  }
  const snapshot = getRoomState(roomId, clientId || null);
  if (!snapshot) {
    sendJson(res, 404, { ok: false, message: "房间不存在。" });
    return;
  }
  sendJson(res, 200, { ok: true, snapshot });
}

async function handleMove(req, res) {
  const body = await parseJsonBody(req);
  const roomId = String(body.roomId || "").trim().toUpperCase();
  const clientId = String(body.clientId || "").trim();
  const room = rooms.get(roomId);
  if (!room) {
    sendJson(res, 404, { ok: false, message: "房间不存在。" });
    return;
  }
  const side = findClientSide(room, clientId);
  if (!side) {
    sendJson(res, 403, { ok: false, message: "你不是这个房间的玩家。" });
    return;
  }
  const result = move(room, side, body);
  if (!result.ok) {
    sendJson(res, 400, result);
    return;
  }
  pushRoomState(room);
  if (room.ai && room.status === "playing") {
    triggerAiMove(room);
  }
  sendJson(res, 200, { ok: true, snapshot: buildSnapshot(room, clientId) });
}

function triggerAiMove(room) {
  const aiSide = seatOrder(room.gameType).find((side) => room.players[side] === "AI");
  if (!aiSide || room.currentTurn !== aiSide || room.status !== "playing") {
    return;
  }
  if (room.gameType === "gobang") {
    const aiMove = computeGobangAiMove(room.board, aiSide);
    if (aiMove) {
      move(room, aiSide, aiMove);
      pushRoomState(room);
      if (room.status === "playing") {
        triggerAiMove(room);
      }
    }
  }
}

async function handleAction(req, res) {
  const body = await parseJsonBody(req);
  const roomId = String(body.roomId || "").trim().toUpperCase();
  const clientId = String(body.clientId || "").trim();
  const room = rooms.get(roomId);
  if (!room) {
    sendJson(res, 404, { ok: false, message: "房间不存在。" });
    return;
  }
  const side = findClientSide(room, clientId);
  if (!side) {
    sendJson(res, 403, { ok: false, message: "你不是这个房间的玩家。" });
    return;
  }
  const result = action(room, side, body);
  if (!result.ok) {
    sendJson(res, 400, result);
    return;
  }
  pushRoomState(room);
  if (room.ai && room.status === "playing") {
    triggerAiMove(room);
  }
  sendJson(res, 200, { ok: true, snapshot: buildSnapshot(room, clientId) });
}

function handleEvents(req, res, url) {
  const roomId = String(url.searchParams.get("roomId") || "").trim().toUpperCase();
  const clientId = String(url.searchParams.get("clientId") || "").trim();
  const room = rooms.get(roomId);
  if (!room) {
    sendText(res, 404, "Room not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`event: state\ndata: ${JSON.stringify(buildSnapshot(room, clientId || null))}\n\n`);
  addSocket(room, clientId || "", res);

  const heartbeat = setInterval(() => {
    try {
      res.write(": keep-alive\n\n");
    } catch (err) {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeSocket(room, clientId || "", res);
  });
}

async function handleLogin(req, res) {
  const body = await parseJsonBody(req);
  const { username, password } = body;
  if (!username || !password) {
    sendJson(res, 400, { ok: false, message: "请输入用户名和密码" });
    return;
  }
  const result = await authenticateUser(username, password);
  if (!result.ok) {
    sendJson(res, 401, result);
    return;
  }
  const token = crypto.randomUUID();
  sessions.set(token, { username, createdAt: Date.now() });
  sendJson(res, 200, { ok: true, token, username });
}

function handleMe(req, res) {
  const token = req.headers["x-session-token"];
  if (!token) {
    sendJson(res, 401, { ok: false, message: "未登录" });
    return;
  }
  const session = sessions.get(token);
  if (!session) {
    sendJson(res, 401, { ok: false, message: "会话已过期" });
    return;
  }
  sendJson(res, 200, { ok: true, username: session.username });
}

function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname === "/login") {
    serveStatic(req, res, "/login.html");
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/login") {
    handleLogin(req, res).catch((err) => sendJson(res, 500, { ok: false, message: err.message }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/me") {
    handleMe(req, res);
    return;
  }
  if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/app") || url.pathname.startsWith("/styles"))) {
    serveStatic(req, res, url.pathname);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/state") {
    handleState(req, res, url).catch((err) => {
      sendJson(res, 500, { ok: false, message: err.message });
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/events") {
    handleEvents(req, res, url);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/room/create") {
    handleCreateRoom(req, res).catch((err) => {
      sendJson(res, 500, { ok: false, message: err.message });
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/room/join") {
    handleJoinRoom(req, res).catch((err) => {
      sendJson(res, 500, { ok: false, message: err.message });
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/move") {
    handleMove(req, res).catch((err) => {
      sendJson(res, 500, { ok: false, message: err.message });
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/action") {
    handleAction(req, res).catch((err) => {
      sendJson(res, 500, { ok: false, message: err.message });
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ping") {
    sendJson(res, 200, { ok: true, time: Date.now() });
    return;
  }

  sendText(res, 404, "Not found");
}

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const urls = [];
  for (const interfaces of Object.values(nets)) {
    for (const net of interfaces || []) {
      if (net.family !== "IPv4" || net.internal) {
        continue;
      }
      urls.push(`http://${net.address}:${PORT}`);
    }
  }
  return urls;
}

const server = http.createServer(route);
initDatabase().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`Board game server running at http://localhost:${PORT}`);
    console.log(`Listening on ${HOST}:${PORT}`);
    const urls = getLanAddresses();
    if (urls.length) {
      console.log(`LAN access: ${urls.join(" , ")}`);
    }
  });
});
