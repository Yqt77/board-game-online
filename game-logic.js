const GOBANG_SIZE = 15;
const GO_SIZE = 19;
const CHESS_ROWS = 10;
const CHESS_COLS = 9;

const SEAT_ORDER = {
  gobang: ["black", "white"],
  go: ["black", "white"],
  chess: ["red", "black"],
};

function normalizeGameType(gameType) {
  if (!SEAT_ORDER[gameType]) {
    throw new Error("Unsupported game type");
  }
  return gameType;
}

function oppositeSide(gameType, side) {
  if (gameType === "chess") {
    return side === "red" ? "black" : "red";
  }
  return side === "black" ? "white" : "black";
}

function initialTurn(gameType) {
  return gameType === "chess" ? "red" : "black";
}

function createMatrix(rows, cols, fill = null) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
}

function cloneBoard(board) {
  return board.map((row) =>
    row.map((cell) => {
      if (!cell) {
        return null;
      }
      if (typeof cell === "object") {
        return { ...cell };
      }
      return cell;
    })
  );
}

function boardHash(board) {
  return board
    .map((row) =>
      row
        .map((cell) => {
          if (!cell) {
            return ".";
          }
          if (typeof cell === "string") {
            return cell[0];
          }
          return `${cell.color[0]}${cell.type}`;
        })
        .join("")
    )
    .join("/");
}

function createGobangBoard() {
  return createMatrix(GOBANG_SIZE, GOBANG_SIZE, null);
}

function createGoBoard() {
  return createMatrix(GO_SIZE, GO_SIZE, null);
}

function placeChess(board, row, col, color, type) {
  board[row][col] = { color, type };
}

function createChessBoard() {
  const board = createMatrix(CHESS_ROWS, CHESS_COLS, null);
  const top = "black";
  const bottom = "red";

  const order = ["R", "H", "E", "A", "K", "A", "E", "H", "R"];
  order.forEach((type, col) => placeChess(board, 0, col, top, type));
  [1, 7].forEach((col) => placeChess(board, 2, col, top, "C"));
  [0, 2, 4, 6, 8].forEach((col) => placeChess(board, 3, col, top, "S"));

  [0, 2, 4, 6, 8].forEach((col) => placeChess(board, 6, col, bottom, "S"));
  [1, 7].forEach((col) => placeChess(board, 7, col, bottom, "C"));
  order.forEach((type, col) => placeChess(board, 9, col, bottom, type));
  return board;
}

function createInitialRoomState(gameType) {
  normalizeGameType(gameType);
  const board =
    gameType === "gobang"
      ? createGobangBoard()
      : gameType === "go"
        ? createGoBoard()
        : createChessBoard();

  const seatNames = SEAT_ORDER[gameType];
  const undoCounts = {};
  seatNames.forEach((side) => { undoCounts[side] = 3; });

  const state = {
    gameType,
    status: "waiting",
    currentTurn: initialTurn(gameType),
    winner: null,
    draw: false,
    board,
    captures: { black: 0, white: 0 },
    passCount: 0,
    history: gameType === "go" ? [boardHash(board)] : [],
    resultText: "",
    lastMove: null,
    updatedAt: Date.now(),
    undoCounts,
    undoStack: [],
  };

  if (gameType === "chess") {
    state.captures = { red: 0, black: 0 };
  }

  return state;
}

function resetRoomState(room) {
  const fresh = createInitialRoomState(room.gameType);
  room.status = fresh.status;
  room.currentTurn = fresh.currentTurn;
  room.winner = fresh.winner;
  room.draw = fresh.draw;
  room.board = fresh.board;
  room.captures = fresh.captures;
  room.passCount = fresh.passCount;
  room.history = fresh.history;
  room.resultText = fresh.resultText;
  room.lastMove = fresh.lastMove;
  room.updatedAt = fresh.updatedAt;
  room.undoCounts = fresh.undoCounts;
  room.undoStack = fresh.undoStack;
}

function seatOrder(gameType) {
  return SEAT_ORDER[gameType].slice();
}

function serializeBoard(board, gameType) {
  if (gameType === "chess") {
    return board.map((row) =>
      row.map((cell) => {
        if (!cell) {
          return null;
        }
        return { color: cell.color, type: cell.type };
      })
    );
  }

  return board.map((row) => row.slice());
}

function findGeneral(board, color) {
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      const cell = board[row][col];
      if (cell && cell.color === color && cell.type === "K") {
        return { row, col };
      }
    }
  }
  return null;
}

function isInside(rows, cols, row, col) {
  return row >= 0 && row < rows && col >= 0 && col < cols;
}

function isChessPalace(color, row, col) {
  if (col < 3 || col > 5) {
    return false;
  }
  if (color === "red") {
    return row >= 7 && row <= 9;
  }
  return row >= 0 && row <= 2;
}

function sameSide(piece, side) {
  return piece && piece.color === side;
}

function pathClear(board, fromRow, fromCol, toRow, toCol) {
  const dr = Math.sign(toRow - fromRow);
  const dc = Math.sign(toCol - fromCol);
  let row = fromRow + dr;
  let col = fromCol + dc;
  while (row !== toRow || col !== toCol) {
    if (board[row][col]) {
      return false;
    }
    row += dr;
    col += dc;
  }
  return true;
}

function getChessPseudoMoves(board, row, col) {
  const piece = board[row][col];
  if (!piece) {
    return [];
  }

  const moves = [];
  const { color, type } = piece;
  const rows = board.length;
  const cols = board[0].length;
  const pushIfValid = (r, c, captureOnly = false) => {
    if (!isInside(rows, cols, r, c)) {
      return;
    }
    const target = board[r][c];
    if (target && target.color === color) {
      return;
    }
    if (captureOnly && !target) {
      return;
    }
    moves.push({ row: r, col: c });
  };

  if (type === "R") {
    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    dirs.forEach(([dr, dc]) => {
      let r = row + dr;
      let c = col + dc;
      while (isInside(rows, cols, r, c)) {
        if (!board[r][c]) {
          moves.push({ row: r, col: c });
        } else {
          if (board[r][c].color !== color) {
            moves.push({ row: r, col: c });
          }
          break;
        }
        r += dr;
        c += dc;
      }
    });
    return moves;
  }

  if (type === "C") {
    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    dirs.forEach(([dr, dc]) => {
      let r = row + dr;
      let c = col + dc;
      let screenFound = false;
      while (isInside(rows, cols, r, c)) {
        const target = board[r][c];
        if (!screenFound) {
          if (!target) {
            moves.push({ row: r, col: c });
          } else {
            screenFound = true;
          }
        } else if (target) {
          if (target.color !== color) {
            moves.push({ row: r, col: c });
          }
          break;
        }
        r += dr;
        c += dc;
      }
    });
    return moves;
  }

  if (type === "H") {
    const candidates = [
      [-2, -1, -1, 0],
      [-2, 1, -1, 0],
      [2, -1, 1, 0],
      [2, 1, 1, 0],
      [-1, -2, 0, -1],
      [-1, 2, 0, 1],
      [1, -2, 0, -1],
      [1, 2, 0, 1],
    ];
    candidates.forEach(([dr, dc, legDr, legDc]) => {
      const legRow = row + legDr;
      const legCol = col + legDc;
      const targetRow = row + dr;
      const targetCol = col + dc;
      if (!isInside(rows, cols, targetRow, targetCol)) {
        return;
      }
      if (board[legRow]?.[legCol]) {
        return;
      }
      pushIfValid(targetRow, targetCol);
    });
    return moves;
  }

  if (type === "E") {
    const candidates = [
      [-2, -2, -1, -1],
      [-2, 2, -1, 1],
      [2, -2, 1, -1],
      [2, 2, 1, 1],
    ];
    candidates.forEach(([dr, dc, eyeDr, eyeDc]) => {
      const targetRow = row + dr;
      const targetCol = col + dc;
      const eyeRow = row + eyeDr;
      const eyeCol = col + eyeDc;
      if (!isInside(rows, cols, targetRow, targetCol)) {
        return;
      }
      if (board[eyeRow]?.[eyeCol]) {
        return;
      }
      if (color === "red" && targetRow < 5) {
        return;
      }
      if (color === "black" && targetRow > 4) {
        return;
      }
      pushIfValid(targetRow, targetCol);
    });
    return moves;
  }

  if (type === "A") {
    const candidates = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];
    candidates.forEach(([dr, dc]) => {
      const targetRow = row + dr;
      const targetCol = col + dc;
      if (isChessPalace(color, targetRow, targetCol)) {
        pushIfValid(targetRow, targetCol);
      }
    });
    return moves;
  }

  if (type === "K") {
    const candidates = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    candidates.forEach(([dr, dc]) => {
      const targetRow = row + dr;
      const targetCol = col + dc;
      if (isChessPalace(color, targetRow, targetCol)) {
        pushIfValid(targetRow, targetCol);
      }
    });
    return moves;
  }

  if (type === "S") {
    const forward = color === "red" ? -1 : 1;
    const crossedRiver = color === "red" ? row <= 4 : row >= 5;
    pushIfValid(row + forward, col);
    if (crossedRiver) {
      pushIfValid(row, col - 1);
      pushIfValid(row, col + 1);
    }
    return moves;
  }

  return moves;
}

function isGeneralFacing(board) {
  const red = findGeneral(board, "red");
  const black = findGeneral(board, "black");
  if (!red || !black || red.col !== black.col) {
    return false;
  }
  const minRow = Math.min(red.row, black.row);
  const maxRow = Math.max(red.row, black.row);
  for (let row = minRow + 1; row < maxRow; row += 1) {
    if (board[row][red.col]) {
      return false;
    }
  }
  return true;
}

function isSquareAttacked(board, targetRow, targetCol, byColor) {
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      const piece = board[row][col];
      if (!piece || piece.color !== byColor) {
        continue;
      }
      const moves = getChessPseudoMoves(board, row, col);
      if (moves.some((move) => move.row === targetRow && move.col === targetCol)) {
        return true;
      }
    }
  }

  const enemyGeneral = findGeneral(board, byColor);
  if (enemyGeneral && enemyGeneral.col === targetCol) {
    const minRow = Math.min(enemyGeneral.row, targetRow);
    const maxRow = Math.max(enemyGeneral.row, targetRow);
    let clear = true;
    for (let row = minRow + 1; row < maxRow; row += 1) {
      if (board[row][targetCol]) {
        clear = false;
        break;
      }
    }
    if (clear) {
      return true;
    }
  }

  return false;
}

function isInCheck(board, color) {
  const general = findGeneral(board, color);
  if (!general) {
    return true;
  }
  const enemy = oppositeSide("chess", color);
  return isSquareAttacked(board, general.row, general.col, enemy);
}

function getChessLegalMoves(board, row, col) {
  const piece = board[row][col];
  if (!piece) {
    return [];
  }
  const pseudoMoves = getChessPseudoMoves(board, row, col);
  const legal = [];
  for (const move of pseudoMoves) {
    const nextBoard = cloneBoard(board);
    nextBoard[move.row][move.col] = { ...piece };
    nextBoard[row][col] = null;
    if (isGeneralFacing(nextBoard)) {
      continue;
    }
    if (isInCheck(nextBoard, piece.color)) {
      continue;
    }
    legal.push(move);
  }
  return legal;
}

function hasAnyLegalChessMove(board, color) {
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      const piece = board[row][col];
      if (!piece || piece.color !== color) {
        continue;
      }
      if (getChessLegalMoves(board, row, col).length > 0) {
        return true;
      }
    }
  }
  return false;
}

function createGoGroup(board, row, col, visited = new Set()) {
  const color = board[row][col];
  const key = `${row},${col}`;
  if (!color || visited.has(key)) {
    return { stones: [], liberties: new Set() };
  }
  const stones = [];
  const liberties = new Set();
  const stack = [[row, col]];
  visited.add(key);

  while (stack.length) {
    const [r, c] = stack.pop();
    stones.push([r, c]);
    const neighbors = [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ];
    neighbors.forEach(([nr, nc]) => {
      if (!isInside(board.length, board[0].length, nr, nc)) {
        return;
      }
      const neighbor = board[nr][nc];
      if (!neighbor) {
        liberties.add(`${nr},${nc}`);
        return;
      }
      if (neighbor !== color) {
        return;
      }
      const nKey = `${nr},${nc}`;
      if (!visited.has(nKey)) {
        visited.add(nKey);
        stack.push([nr, nc]);
      }
    });
  }

  return { stones, liberties };
}

function collectGoGroup(board, row, col) {
  return createGoGroup(board, row, col, new Set());
}

function removeGoGroup(board, group) {
  group.stones.forEach(([row, col]) => {
    board[row][col] = null;
  });
}

function calculateGoScore(board, captures) {
  let blackStones = 0;
  let whiteStones = 0;
  let blackTerritory = 0;
  let whiteTerritory = 0;
  const visited = new Set();

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      const cell = board[row][col];
      if (cell === "black") {
        blackStones += 1;
        continue;
      }
      if (cell === "white") {
        whiteStones += 1;
        continue;
      }
      const key = `${row},${col}`;
      if (visited.has(key)) {
        continue;
      }
      const region = [];
      const boundary = new Set();
      const queue = [[row, col]];
      visited.add(key);
      while (queue.length) {
        const [r, c] = queue.shift();
        region.push([r, c]);
        const neighbors = [
          [r - 1, c],
          [r + 1, c],
          [r, c - 1],
          [r, c + 1],
        ];
        neighbors.forEach(([nr, nc]) => {
          if (!isInside(board.length, board[0].length, nr, nc)) {
            return;
          }
          const neighbor = board[nr][nc];
          if (!neighbor) {
            const nKey = `${nr},${nc}`;
            if (!visited.has(nKey)) {
              visited.add(nKey);
              queue.push([nr, nc]);
            }
            return;
          }
          boundary.add(neighbor);
        });
      }
      if (boundary.size === 1) {
        const owner = [...boundary][0];
        if (owner === "black") {
          blackTerritory += region.length;
        } else if (owner === "white") {
          whiteTerritory += region.length;
        }
      }
    }
  }

  const blackScore = blackStones + blackTerritory + (captures.black || 0);
  const whiteScore = whiteStones + whiteTerritory + (captures.white || 0) + 6.5;
  return {
    blackScore,
    whiteScore,
    winner: blackScore > whiteScore ? "black" : "white",
    diff: Math.abs(blackScore - whiteScore),
  };
}

function getGobangWinner(board, row, col) {
  const color = board[row][col];
  if (!color) {
    return null;
  }
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (const [dr, dc] of dirs) {
    let count = 1;
    let r = row + dr;
    let c = col + dc;
    while (isInside(board.length, board[0].length, r, c) && board[r][c] === color) {
      count += 1;
      r += dr;
      c += dc;
    }
    r = row - dr;
    c = col - dc;
    while (isInside(board.length, board[0].length, r, c) && board[r][c] === color) {
      count += 1;
      r -= dr;
      c -= dc;
    }
    if (count >= 5) {
      return color;
    }
  }
  return null;
}

function isBoardFull(board) {
  return board.every((row) => row.every((cell) => cell));
}

function saveUndoState(room) {
  if (!room.undoStack) room.undoStack = [];
  room.undoStack.push({
    board: cloneBoard(room.board),
    currentTurn: room.currentTurn,
    lastMove: room.lastMove ? { ...room.lastMove } : null,
    captures: { ...room.captures },
    passCount: room.passCount,
    history: room.history ? [...room.history] : null,
  });
}

function applyUndo(room, side) {
  if (room.status !== "playing") return { ok: false, message: "对局已结束，无法悔棋。" };
  if (!room.undoStack || room.undoStack.length === 0) return { ok: false, message: "没有可以悔棋的步骤。" };
  if (!room.undoCounts) room.undoCounts = { black: 3, white: 3 };
  if ((room.undoCounts[side] || 0) <= 0) return { ok: false, message: "悔棋次数已用完。" };

  if (room.ai) {
    /* In AI mode, undo two steps (AI response + your last move) */
    if (room.undoStack.length < 2) return { ok: false, message: "没有可以悔棋的步骤。" };
    room.undoStack.pop();
  }

  const state = room.undoStack.pop();
  room.board = state.board;
  room.currentTurn = state.currentTurn;
  room.lastMove = state.lastMove;
  room.captures = state.captures;
  room.passCount = state.passCount;
  if (room.history && state.history) {
    room.history = state.history;
  }
  room.undoCounts[side]--;
  room.updatedAt = Date.now();
  return { ok: true, remaining: room.undoCounts[side] };
}

function applyGobangMove(room, side, row, col) {
  if (room.status !== "playing") {
    return { ok: false, message: "房间还没有开始或已经结束。" };
  }
  if (room.currentTurn !== side) {
    return { ok: false, message: "还没轮到你。" };
  }
  if (!isInside(room.board.length, room.board[0].length, row, col)) {
    return { ok: false, message: "落点超出棋盘。" };
  }
  if (room.board[row][col]) {
    return { ok: false, message: "这个位置已经有子了。" };
  }
  saveUndoState(room);
  room.board[row][col] = side;
  room.lastMove = { row, col, side };
  room.updatedAt = Date.now();

  const winner = getGobangWinner(room.board, row, col);
  if (winner) {
    room.status = "finished";
    room.winner = winner;
    room.resultText = `${winner === "black" ? "黑方" : "白方"}连成五子，获胜。`;
    return { ok: true, winner };
  }
  if (isBoardFull(room.board)) {
    room.status = "finished";
    room.draw = true;
    room.resultText = "棋盘已满，平局。";
    return { ok: true, draw: true };
  }

  room.currentTurn = oppositeSide(room.gameType, side);
  return { ok: true };
}

function applyGoMove(room, side, row, col) {
  if (room.status !== "playing") {
    return { ok: false, message: "房间还没有开始或已经结束。" };
  }
  if (room.currentTurn !== side) {
    return { ok: false, message: "还没轮到你。" };
  }
  if (!isInside(room.board.length, room.board[0].length, row, col)) {
    return { ok: false, message: "落点超出棋盘。" };
  }
  if (room.board[row][col]) {
    return { ok: false, message: "这个位置已经有子了。" };
  }

  const nextBoard = cloneBoard(room.board);
  nextBoard[row][col] = side;
  const opponent = oppositeSide(room.gameType, side);
  let captured = 0;
  const neighbors = [
    [row - 1, col],
    [row + 1, col],
    [row, col - 1],
    [row, col + 1],
  ];
  const processed = new Set();
  neighbors.forEach(([nr, nc]) => {
    if (!isInside(nextBoard.length, nextBoard[0].length, nr, nc)) {
      return;
    }
    if (nextBoard[nr][nc] !== opponent) {
      return;
    }
    const key = `${nr},${nc}`;
    if (processed.has(key)) {
      return;
    }
    const group = collectGoGroup(nextBoard, nr, nc);
    group.stones.forEach(([sr, sc]) => processed.add(`${sr},${sc}`));
    if (group.liberties.size === 0) {
      removeGoGroup(nextBoard, group);
      captured += group.stones.length;
    }
  });

  const selfGroup = collectGoGroup(nextBoard, row, col);
  if (selfGroup.liberties.size === 0) {
    return { ok: false, message: "不能自杀落子。" };
  }

  const nextHash = boardHash(nextBoard);
  if (room.history.length >= 2 && nextHash === room.history[room.history.length - 2]) {
    return { ok: false, message: "这一步会形成打劫，不能落子。" };
  }

  saveUndoState(room);
  room.board = nextBoard;
  room.captures[side] = (room.captures[side] || 0) + captured;
  room.currentTurn = opponent;
  room.passCount = 0;
  room.history.push(nextHash);
  room.lastMove = { row, col, side, captured };
  room.updatedAt = Date.now();
  return { ok: true, captured };
}

function applyChessMove(room, side, row, col, toRow, toCol) {
  if (room.status !== "playing") {
    return { ok: false, message: "房间还没有开始或已经结束。" };
  }
  if (room.currentTurn !== side) {
    return { ok: false, message: "还没轮到你。" };
  }
  if (!isInside(room.board.length, room.board[0].length, row, col) || !isInside(room.board.length, room.board[0].length, toRow, toCol)) {
    return { ok: false, message: "落点超出棋盘。" };
  }
  const piece = room.board[row][col];
  if (!piece || piece.color !== side) {
    return { ok: false, message: "请选择自己的棋子。" };
  }
  const legal = getChessLegalMoves(room.board, row, col);
  if (!legal.some((move) => move.row === toRow && move.col === toCol)) {
    return { ok: false, message: "这步棋不合法。" };
  }
  const target = room.board[toRow][toCol];
  if (target && target.color === side) {
    return { ok: false, message: "不能吃自己的棋子。" };
  }

  saveUndoState(room);
  room.board[toRow][toCol] = { ...piece };
  room.board[row][col] = null;
  room.currentTurn = oppositeSide(room.gameType, side);
  room.lastMove = { row, col, toRow, toCol, side, captured: target ? `${target.color}:${target.type}` : null };
  room.updatedAt = Date.now();
  if (target) {
    room.captures[side] = (room.captures[side] || 0) + 1;
  }

  const enemy = oppositeSide("chess", side);
  const enemyGeneral = findGeneral(room.board, enemy);
  if (!enemyGeneral) {
    room.status = "finished";
    room.winner = side;
    room.resultText = `${side === "red" ? "红方" : "黑方"}将死对方将帅，获胜。`;
    return { ok: true, winner: side };
  }
  if (isInCheck(room.board, enemy) && !hasAnyLegalChessMove(room.board, enemy)) {
    room.status = "finished";
    room.winner = side;
    room.resultText = `${side === "red" ? "红方" : "黑方"}将死对方，获胜。`;
    return { ok: true, winner: side };
  }
  if (!isInCheck(room.board, enemy) && !hasAnyLegalChessMove(room.board, enemy)) {
    room.status = "finished";
    room.winner = side;
    room.resultText = `${side === "red" ? "红方" : "黑方"}迫使对方无子可走，获胜。`;
    return { ok: true, winner: side };
  }
  return { ok: true };
}

function applyPass(room, side) {
  if (room.gameType !== "go") {
    return { ok: false, message: "只有围棋可以停一手。" };
  }
  if (room.status !== "playing") {
    return { ok: false, message: "房间还没有开始或已经结束。" };
  }
  if (room.currentTurn !== side) {
    return { ok: false, message: "还没轮到你。" };
  }
  saveUndoState(room);
  room.passCount += 1;
  room.lastMove = { side, action: "pass" };
  room.updatedAt = Date.now();
  if (room.passCount >= 2) {
    const score = calculateGoScore(room.board, room.captures);
    room.status = "finished";
    room.winner = score.winner;
    room.draw = false;
    room.resultText = `双方连续停一手，终局计分。黑方 ${score.blackScore.toFixed(1)}  :  白方 ${score.whiteScore.toFixed(1)}。${score.winner === "black" ? "黑方" : "白方"}获胜。`;
    room.score = score;
    return { ok: true, finished: true, score };
  }
  room.currentTurn = oppositeSide(room.gameType, side);
  return { ok: true };
}

function applyResign(room, side) {
  if (room.status !== "playing") {
    return { ok: false, message: "房间还没有开始或已经结束。" };
  }
  const winner = oppositeSide(room.gameType, side);
  room.status = "finished";
  room.winner = winner;
  room.resultText = `${side === "black" ? "黑方" : side === "red" ? "红方" : "白方"}认输，${winner === "black" ? "黑方" : winner === "red" ? "红方" : "白方"}获胜。`;
  room.lastMove = { side, action: "resign" };
  room.updatedAt = Date.now();
  return { ok: true, winner };
}

function restartRoom(room) {
  resetRoomState(room);
  room.status = room.players && room.players.black && room.players.white ? "playing" : "waiting";
  if (room.gameType === "chess") {
    room.status = room.players && room.players.red && room.players.black ? "playing" : "waiting";
  }
  room.resultText = room.status === "waiting" ? "等待对手加入。" : "新的一局已经开始。";
  room.updatedAt = Date.now();
  return { ok: true };
}

function ensureGameReady(room) {
  const seatNames = seatOrder(room.gameType);
  const hasPlayers = seatNames.every((side) => room.players[side]);
  if (hasPlayers && room.status === "waiting") {
    room.status = "playing";
    room.resultText = room.gameType === "chess" ? "红方先行。" : "黑方先行。";
    room.updatedAt = Date.now();
  }
}

function move(room, side, payload) {
  if (room.gameType === "gobang") {
    return applyGobangMove(room, side, payload.row, payload.col);
  }
  if (room.gameType === "go") {
    return applyGoMove(room, side, payload.row, payload.col);
  }
  return applyChessMove(room, side, payload.row, payload.col, payload.toRow, payload.toCol);
}

function action(room, side, payload) {
  if (payload.action === "pass") {
    return applyPass(room, side);
  }
  if (payload.action === "resign") {
    return applyResign(room, side);
  }
  if (payload.action === "restart") {
    return restartRoom(room);
  }
  if (payload.action === "undo") {
    return applyUndo(room, side);
  }
  return { ok: false, message: "未知操作。" };
}

function buildStatusMessage(room) {
  if (room.status === "waiting") {
    const seatNames = seatOrder(room.gameType);
    const emptySeat = seatNames.find((side) => !room.players[side]);
    if (emptySeat) {
      return `等待${emptySeat === "black" ? "黑" : emptySeat === "red" ? "红" : "白"}方加入。`;
    }
    return "等待对局开始。";
  }
  if (room.status === "finished") {
    return room.resultText || "对局结束。";
  }
  if (room.gameType === "chess") {
    return room.currentTurn === "red" ? "轮到红方行棋。" : "轮到黑方行棋。";
  }
  const turnSide = room.currentTurn === "black" ? "黑方" : "白方";
  if (room.ai) {
    const isAiTurn = room.players[room.currentTurn] === "AI";
    return isAiTurn ? `${turnSide}思考中...` : `轮到你行棋。`;
  }
  return `轮到${turnSide}行棋。`;
}

function buildSnapshot(room, clientId) {
  const seatNames = seatOrder(room.gameType);
  const yourSide = seatNames.find((side) => room.players[side] === clientId) || null;
  const players = {};
  seatNames.forEach((side) => {
    players[side] = Boolean(room.players[side]);
  });
  const state = {
    roomId: room.id,
    gameType: room.gameType,
    status: room.status,
    currentTurn: room.currentTurn,
    winner: room.winner,
    draw: room.draw,
    board: serializeBoard(room.board, room.gameType),
    players,
    yourSide,
    seatNames,
    captures: room.captures,
    passCount: room.passCount,
    lastMove: room.lastMove,
    resultText: room.resultText,
    message: buildStatusMessage(room),
    updatedAt: room.updatedAt,
    ai: room.ai || false,
    usernames: room.usernames || {},
    matchScore: room.matchScore || null,
    undoCounts: room.undoCounts || null,
    undoRemaining: yourSide ? (room.undoCounts?.[yourSide] || 0) : null,
  };
  if (room.gameType === "go" && room.score) {
    state.score = room.score;
  }
  return state;
}

function scoreGobangPosition(board, row, col, side) {
  let score = 0;
  const dirs = [[1,0],[0,1],[1,1],[1,-1]];
  for (const [dr, dc] of dirs) {
    let count = 1;
    let openEnds = 0;
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < board.length && c >= 0 && c < board[0].length && board[r][c] === side) {
      count++; r += dr; c += dc;
    }
    if (r >= 0 && r < board.length && c >= 0 && c < board[0].length && !board[r][c]) openEnds++;
    r = row - dr; c = col - dc;
    while (r >= 0 && r < board.length && c >= 0 && c < board[0].length && board[r][c] === side) {
      count++; r -= dr; c -= dc;
    }
    if (r >= 0 && r < board.length && c >= 0 && c < board[0].length && !board[r][c]) openEnds++;
    if (count >= 5) score += 100000;
    else if (count === 4 && openEnds === 2) score += 10000;
    else if (count === 4 && openEnds === 1) score += 5000;
    else if (count === 3 && openEnds === 2) score += 1000;
    else if (count === 3 && openEnds === 1) score += 500;
    else if (count === 2 && openEnds === 2) score += 100;
    else if (count === 2 && openEnds === 1) score += 50;
  }
  return score;
}

function computeGobangAiMove(board, side) {
  const opponent = side === "black" ? "white" : "black";
  let bestScore = -1;
  let bestMove = null;
  const center = Math.floor(board.length / 2);

  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      if (board[row][col]) continue;
      const attack = scoreGobangPosition(board, row, col, side);
      const defense = scoreGobangPosition(board, row, col, opponent);
      let s = Math.max(attack, defense);
      if (s === 0) {
        const dist = Math.abs(row - center) + Math.abs(col - center);
        s = Math.max(0, 14 - dist);
      }
      if (s > bestScore) {
        bestScore = s;
        bestMove = { row, col };
      }
    }
  }
  return bestMove;
}

module.exports = {
  seatOrder,
  normalizeGameType,
  oppositeSide,
  createInitialRoomState,
  resetRoomState,
  serializeBoard,
  buildSnapshot,
  buildStatusMessage,
  ensureGameReady,
  move,
  action,
  restartRoom,
  boardHash,
  calculateGoScore,
  getGobangWinner,
  getChessLegalMoves,
  hasAnyLegalChessMove,
  computeGobangAiMove,
  isInCheck,
};
