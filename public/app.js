const clientIdKey = "boardgame.clientId";
const roomIdKey = "boardgame.roomId";
const sessionKey = "boardgame.session";

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(sessionKey)) || null;
  } catch {
    return null;
  }
}

function requireAuth() {
  const session = getSession();
  if (!session || !session.token) {
    window.location.href = "/login";
    return null;
  }
  return session;
}

const state = {
  snapshot: null,
  roomId: "",
  clientId: "",
  eventSource: null,
  pollTimer: null,
  selected: null,
  toastTimer: null,
};

const $ = (id) => document.getElementById(id);

const dom = {
  roomInput: $("roomInput"),
  joinBtn: $("joinBtn"),
  copyLinkBtn: $("copyLinkBtn"),
  restartBtn: $("restartBtn"),
  passBtn: $("passBtn"),
  resignBtn: $("resignBtn"),
  usernameDisplay: $("usernameDisplay"),
  logoutBtn: $("logoutBtn"),
  board: $("board"),
  roomIdText: $("roomIdText"),
  gameText: $("gameText"),
  yourSideText: $("yourSideText"),
  turnText: $("turnText"),
  statusText: $("statusText"),
  scoreBlock: $("scoreBlock"),
  boardTitle: $("boardTitle"),
  boardSubtitle: $("boardSubtitle"),
  connectionChip: $("connectionChip"),
  legendLeft: $("legendLeft"),
  legendRight: $("legendRight"),
  toast: $("toast"),
};

const GAME_LABELS = {
  gobang: "五子棋",
  chess: "象棋",
  go: "围棋",
};

const SIDE_LABELS = {
  black: "黑方",
  white: "白方",
  red: "红方",
};

const CHESS_PIECES = {
  red: { K: "帅", A: "仕", E: "相", H: "马", R: "车", C: "炮", S: "兵" },
  black: { K: "将", A: "士", E: "象", H: "马", R: "车", C: "炮", S: "卒" },
};

function ensureClientId() {
  const params = new URLSearchParams(window.location.search);
  const forced = params.get("client");
  if (forced) {
    localStorage.setItem(clientIdKey, forced);
    state.clientId = forced;
    return;
  }
  let id = localStorage.getItem(clientIdKey);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(clientIdKey, id);
  }
  state.clientId = id;
}

function setConnection(text, mode = "") {
  dom.connectionChip.textContent = text;
  dom.connectionChip.dataset.mode = mode;
}

function toast(message) {
  dom.toast.textContent = message;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    if (dom.toast.textContent === message) {
      dom.toast.textContent = "";
    }
  }, 2600);
}

function sideLabel(side) {
  return SIDE_LABELS[side] || "-";
}

function pieceText(piece) {
  return CHESS_PIECES[piece.color]?.[piece.type] || "";
}

function isGoStarPoint(row, col) {
  const stars = new Set([3, 9, 15]);
  return stars.has(row) && stars.has(col);
}

function updateRoomInfo(snapshot) {
  if (!snapshot) {
    dom.roomIdText.textContent = "-";
    dom.gameText.textContent = "-";
    dom.yourSideText.textContent = "-";
    dom.turnText.textContent = "-";
    dom.boardTitle.textContent = "等待进入对局";
    dom.boardSubtitle.textContent = "创建或加入一个房间后，这里会显示棋盘。";
    dom.statusText.textContent = "选择一种棋类并创建房间，或输入房间号加入。";
    dom.legendLeft.textContent = "提示会显示在这里。";
    dom.legendRight.textContent = "";
    dom.scoreBlock.classList.add("hidden");
    dom.scoreBlock.innerHTML = "";
    dom.passBtn.classList.add("hidden");
    dom.resignBtn.classList.add("hidden");
    return;
  }

  dom.roomIdText.textContent = snapshot.ai ? "练习" : snapshot.roomId;
  dom.gameText.textContent = GAME_LABELS[snapshot.gameType] || snapshot.gameType;
  dom.yourSideText.textContent = snapshot.yourSide ? sideLabel(snapshot.yourSide) : "旁观";
  dom.turnText.textContent = sideLabel(snapshot.currentTurn);
  dom.boardTitle.textContent = `${GAME_LABELS[snapshot.gameType] || "棋局"}${snapshot.ai ? " · 练习模式" : ""} · ${snapshot.roomId}`;
  dom.boardSubtitle.textContent =
    snapshot.gameType === "go"
      ? "围棋可提子、可停一手，双方连续停一手后自动计分。"
      : snapshot.gameType === "chess"
        ? "象棋遵循车马炮相士将兵的走法，红方先行。"
        : "五子棋先连成五子的一方获胜。";

  dom.statusText.textContent = snapshot.message || "";
  dom.legendLeft.textContent =
    snapshot.gameType === "chess"
      ? "象棋先选己方棋子，再点目标位置。"
      : "直接点击空位落子。";
  dom.legendRight.textContent =
    snapshot.gameType === "go"
      ? `提子数：黑 ${snapshot.captures?.black || 0} / 白 ${snapshot.captures?.white || 0}`
      : snapshot.gameType === "chess"
        ? `吃子数：红 ${snapshot.captures?.red || 0} / 黑 ${snapshot.captures?.black || 0}`
        : snapshot.status === "finished"
          ? "本局已结束"
          : "";

  const canAct = Boolean(snapshot.yourSide && snapshot.status === "playing");
  dom.passBtn.classList.toggle("hidden", !(snapshot.gameType === "go" && canAct));
  dom.resignBtn.classList.toggle("hidden", !canAct);
  dom.copyLinkBtn.classList.toggle("hidden", Boolean(snapshot.ai));

  if (snapshot.gameType === "go") {
    if (snapshot.status === "finished" && snapshot.score) {
      dom.scoreBlock.classList.remove("hidden");
      dom.scoreBlock.innerHTML = `
        <strong>终局计分</strong><br />
        黑方：${snapshot.score.blackScore.toFixed(1)}<br />
        白方：${snapshot.score.whiteScore.toFixed(1)}<br />
        结果：${snapshot.score.winner === "black" ? "黑方" : "白方"}获胜
      `;
    } else {
      dom.scoreBlock.classList.add("hidden");
      dom.scoreBlock.innerHTML = "";
    }
  } else if (snapshot.gameType === "chess" && snapshot.status === "finished") {
    dom.scoreBlock.classList.remove("hidden");
    dom.scoreBlock.innerHTML = `对局结束，${sideLabel(snapshot.winner)}获胜。`;
  } else if (snapshot.gameType === "gobang" && snapshot.status === "finished") {
    dom.scoreBlock.classList.remove("hidden");
    dom.scoreBlock.innerHTML = `对局结束，${sideLabel(snapshot.winner)}获胜。`;
  } else {
    dom.scoreBlock.classList.add("hidden");
    dom.scoreBlock.innerHTML = "";
  }
}

function getLastMoveCells(snapshot) {
  const cells = new Set();
  const mv = snapshot?.lastMove;
  if (!mv) {
    return cells;
  }
  if (snapshot.gameType === "chess") {
    if (Number.isInteger(mv.row) && Number.isInteger(mv.col)) {
      cells.add(`${mv.row},${mv.col}`);
    }
    if (Number.isInteger(mv.toRow) && Number.isInteger(mv.toCol)) {
      cells.add(`${mv.toRow},${mv.toCol}`);
    }
    return cells;
  }
  if (Number.isInteger(mv.row) && Number.isInteger(mv.col)) {
    cells.add(`${mv.row},${mv.col}`);
  }
  return cells;
}

function renderBoard(snapshot) {
  dom.board.innerHTML = "";
  if (!snapshot) {
    dom.board.className = "board";
    dom.board.removeAttribute("style");
    return;
  }

  const rows = snapshot.board.length;
  const cols = snapshot.board[0].length;
  dom.board.className = `board board--${snapshot.gameType}`;
  dom.board.style.setProperty("--board-cols", cols);
  dom.board.style.setProperty("--board-rows", rows);

  const lastMoveCells = getLastMoveCells(snapshot);
  const selected = state.selected;
  const fragment = document.createDocumentFragment();

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.setAttribute("aria-label", `${row + 1} 行 ${col + 1} 列`);

      if (snapshot.gameType === "go" && isGoStarPoint(row, col) && !snapshot.board[row][col]) {
        cell.classList.add("cell--star");
      }
      if (lastMoveCells.has(`${row},${col}`)) {
        cell.classList.add("cell--last");
      }
      if (selected && selected.row === row && selected.col === col) {
        cell.classList.add("cell--selected");
      }

      const value = snapshot.board[row][col];
      if (snapshot.gameType === "gobang" || snapshot.gameType === "go") {
        if (value === "black" || value === "white") {
          const stone = document.createElement("span");
          stone.className = `stone stone--${value}`;
          cell.appendChild(stone);
        }
      } else if (value) {
        const piece = document.createElement("span");
        piece.className = `piece piece--${value.color}`;
        piece.textContent = pieceText(value);
        cell.appendChild(piece);
      }

      fragment.appendChild(cell);
    }
  }

  dom.board.appendChild(fragment);
}

function render(snapshot) {
  state.snapshot = snapshot;
  if (snapshot?.roomId) {
    state.roomId = snapshot.roomId;
    localStorage.setItem(roomIdKey, snapshot.roomId);
    const url = new URL(window.location.href);
    url.searchParams.set("room", snapshot.roomId);
    window.history.replaceState({}, "", url);
  }

  if (snapshot) {
    const selected = state.selected;
    if (selected && snapshot.gameType === "chess") {
      const cell = snapshot.board[selected.row]?.[selected.col];
      if (!cell || cell.color !== snapshot.yourSide) {
        state.selected = null;
      }
    } else if (selected) {
      state.selected = null;
    }
  }

  updateRoomInfo(snapshot);
  renderBoard(snapshot);

  if (snapshot) {
    setConnection("在线", "online");
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.message || "请求失败");
  }
  return data;
}

async function fetchSnapshot(roomId) {
  const url = new URL("/api/state", window.location.origin);
  url.searchParams.set("roomId", roomId);
  url.searchParams.set("clientId", state.clientId);
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.message || "房间不存在");
  }
  return data.snapshot;
}

async function loadState(roomId) {
  const snapshot = await fetchSnapshot(roomId);
  render(snapshot);
  openStream(snapshot.roomId);
}

function closeStream() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function startPolling(roomId) {
  stopPolling();
  if (!roomId) {
    return;
  }
  state.pollTimer = setInterval(() => {
    fetchSnapshot(roomId)
      .then((snapshot) => {
        render(snapshot);
      })
      .catch(() => {
        setConnection("重连中", "offline");
      });
  }, 2000);
}

function openStream(roomId) {
  closeStream();
  if (!roomId) {
    return;
  }
  const url = new URL("/events", window.location.origin);
  url.searchParams.set("roomId", roomId);
  url.searchParams.set("clientId", state.clientId);
  const es = new EventSource(url);
  state.eventSource = es;

  es.addEventListener("state", (event) => {
    const snapshot = JSON.parse(event.data);
    render(snapshot);
  });

  es.onopen = () => {
    setConnection("在线", "online");
  };

  es.onerror = () => {
    setConnection("重连中", "offline");
  };

  startPolling(roomId);
}

async function createRoom(gameType) {
  const data = await postJson("/api/room/create", {
    gameType,
    clientId: state.clientId,
  });
  render(data.snapshot);
  openStream(data.roomId);
}

async function createPracticeRoom(gameType) {
  const data = await postJson("/api/room/create", {
    gameType,
    clientId: state.clientId,
    ai: true,
  });
  render(data.snapshot);
  openStream(data.roomId);
}

async function joinRoom(roomId) {
  const data = await postJson("/api/room/join", {
    roomId,
    clientId: state.clientId,
  });
  render(data.snapshot);
  openStream(data.roomId);
}

async function sendMove(payload) {
  const data = await postJson("/api/move", {
    roomId: state.roomId,
    clientId: state.clientId,
    ...payload,
  });
  if (data.snapshot) {
    render(data.snapshot);
  }
}

async function sendAction(action) {
  const data = await postJson("/api/action", {
    roomId: state.roomId,
    clientId: state.clientId,
    action,
  });
  if (data.snapshot) {
    render(data.snapshot);
  }
}

function handleBoardClick(event) {
  const cell = event.target.closest(".cell");
  if (!cell || !state.snapshot) {
    return;
  }

  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  const snapshot = state.snapshot;

  if (snapshot.status !== "playing") {
    toast("当前对局还没开始，或者已经结束。");
    return;
  }
  if (!snapshot.yourSide) {
    toast("你现在是旁观者，不能落子。");
    return;
  }
  if (snapshot.currentTurn !== snapshot.yourSide) {
    toast("还没轮到你。");
    return;
  }

  if (snapshot.gameType === "gobang" || snapshot.gameType === "go") {
    if (snapshot.board[row][col]) {
      toast("这个位置已经有子了。");
      return;
    }
    sendMove({ row, col }).catch((err) => toast(err.message));
    return;
  }

  const value = snapshot.board[row][col];
  if (state.selected) {
    if (state.selected.row === row && state.selected.col === col) {
      state.selected = null;
      render(snapshot);
      return;
    }
    if (value && value.color === snapshot.yourSide) {
      state.selected = { row, col };
      render(snapshot);
      return;
    }
    sendMove({
      row: state.selected.row,
      col: state.selected.col,
      toRow: row,
      toCol: col,
    }).catch((err) => toast(err.message));
    return;
  }

  if (value && value.color === snapshot.yourSide) {
    state.selected = { row, col };
    render(snapshot);
    return;
  }
  toast("先点自己的棋子，再点目标位置。");
}

async function handleCreateClick(gameType) {
  try {
    await createRoom(gameType);
    toast(`已创建${GAME_LABELS[gameType]}房间。`);
  } catch (err) {
    toast(err.message);
  }
}

async function handlePracticeClick(gameType) {
  try {
    await createPracticeRoom(gameType);
    toast("已进入练习模式，执黑先行。");
  } catch (err) {
    toast(err.message);
  }
}

async function handleJoinClick() {
  const roomId = dom.roomInput.value.trim().toUpperCase();
  if (!roomId) {
    toast("请输入房间号。");
    return;
  }
  try {
    await joinRoom(roomId);
    toast(`已加入房间 ${roomId}。`);
  } catch (err) {
    toast(err.message);
  }
}

function updateActionAvailability() {
  const snapshot = state.snapshot;
  const canAct = Boolean(snapshot?.yourSide && snapshot.status === "playing");
  dom.resignBtn.disabled = !canAct;
  dom.passBtn.disabled = !(canAct && snapshot.gameType === "go");
  dom.restartBtn.disabled = !snapshot;
  dom.copyLinkBtn.disabled = !snapshot;
}

async function copyRoomLink() {
  if (!state.roomId) {
    toast("还没有可复制的房间。");
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("room", state.roomId);
  await navigator.clipboard.writeText(url.toString());
  toast("房间链接已复制。");
}

function logout() {
  localStorage.removeItem(sessionKey);
  window.location.href = "/login";
}

function bootAuth() {
  const session = requireAuth();
  if (!session) return;
  dom.usernameDisplay.textContent = session.username;
  dom.logoutBtn.addEventListener("click", logout);
}

function bootFromUrlOrStorage() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("client")) {
    params.delete("client");
    const url = new URL(window.location.href);
    url.search = params.toString();
    window.history.replaceState({}, "", url);
  }

  const fromUrl = params.get("room");
  const fromStorage = localStorage.getItem(roomIdKey);
  const roomId = (fromUrl || fromStorage || "").trim().toUpperCase();
  if (roomId) {
    dom.roomInput.value = roomId;
    joinRoom(roomId).catch((err) => {
      setConnection("离线", "offline");
      toast(err.message);
    });
  } else {
    setConnection("离线", "offline");
  }
}

function wireEvents() {
  document.querySelectorAll("[data-create]").forEach((button) => {
    button.addEventListener("click", () => {
      handleCreateClick(button.dataset.create);
    });
  });

  document.querySelectorAll("[data-practice]").forEach((button) => {
    button.addEventListener("click", () => {
      handlePracticeClick(button.dataset.practice);
    });
  });

  dom.joinBtn.addEventListener("click", () => {
    handleJoinClick();
  });

  dom.roomInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handleJoinClick();
    }
  });

  dom.board.addEventListener("click", handleBoardClick);

  dom.passBtn.addEventListener("click", () => {
    sendAction("pass").catch((err) => toast(err.message));
  });

  dom.resignBtn.addEventListener("click", () => {
    sendAction("resign").catch((err) => toast(err.message));
  });

  dom.restartBtn.addEventListener("click", () => {
    if (!state.snapshot) {
      return;
    }
    sendAction("restart").catch((err) => toast(err.message));
  });

  dom.copyLinkBtn.addEventListener("click", () => {
    copyRoomLink().catch((err) => toast(err.message));
  });

  window.addEventListener("beforeunload", closeStream);
  window.addEventListener("beforeunload", stopPolling);
}

function syncUiLoop() {
  updateActionAvailability();
  requestAnimationFrame(syncUiLoop);
}

bootAuth();
ensureClientId();
wireEvents();
bootFromUrlOrStorage();
syncUiLoop();
