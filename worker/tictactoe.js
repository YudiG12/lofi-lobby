export const TTT_SEAT_X = 16;
export const TTT_SEAT_O = 17;
export const isTttSeat = (seat) => seat === TTT_SEAT_X || seat === TTT_SEAT_O;

export const WIN_LINES = Object.freeze(
  [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ].map((line) => Object.freeze(line)),
);

const normalizePlayerId = (id) => (typeof id === "string" && id.length > 0 ? id : null);
const nextRev = (rev) => (Number.isSafeInteger(rev) && rev >= 0 ? rev : 0) + 1;

export function createGame() {
  return {
    rev: 0,
    players: { X: null, O: null },
    board: Array(9).fill(null),
    turn: "X",
    starter: "X",
    status: "waiting",
    winner: null,
    winLine: null,
    score: { X: 0, O: 0, draws: 0 },
    rematch: { X: false, O: false },
    notice: null,
  };
}

export function findWinLine(board) {
  const line = WIN_LINES.find(([a, b, c]) => {
    const mark = board[a];
    return (mark === "X" || mark === "O") && mark === board[b] && mark === board[c];
  });
  return line ?? null;
}

export function syncSeats(state, seatXPlayerId, seatOPlayerId) {
  const xId = normalizePlayerId(seatXPlayerId);
  const oId = seatOPlayerId === xId ? null : normalizePlayerId(seatOPlayerId);
  if (state.players.X === xId && state.players.O === oId) return { state, changed: false };

  const next = createGame();
  next.rev = nextRev(state.rev);
  next.players = { X: xId, O: oId };
  if (xId && oId) {
    next.status = "playing";
  } else {
    const remainingId = xId ?? oId;
    const previous = state.players;
    if (previous.X && previous.O && (remainingId === previous.X || remainingId === previous.O)) {
      next.notice = "opponent left";
    }
  }
  return { state: next, changed: true };
}

export function applyMove(state, playerId, cell, expectedRev) {
  const mark = playerMark(state.players, playerId);
  if (
    state.status !== "playing" ||
    !mark ||
    mark !== state.turn ||
    (expectedRev !== undefined && (!Number.isSafeInteger(expectedRev) || expectedRev !== state.rev)) ||
    !Number.isInteger(cell) ||
    cell < 0 ||
    cell > 8 ||
    state.board[cell] !== null
  ) {
    return { ok: false, state };
  }

  const board = state.board.slice();
  board[cell] = mark;
  const next = { ...state, rev: nextRev(state.rev), board };
  const winLine = findWinLine(board);
  if (winLine) {
    next.status = "won";
    next.winner = mark;
    next.winLine = winLine;
    next.score = { ...state.score, [mark]: state.score[mark] + 1 };
  } else if (!board.includes(null)) {
    next.status = "draw";
    next.score = { ...state.score, draws: state.score.draws + 1 };
  } else {
    next.turn = otherMark(mark);
  }
  return { ok: true, state: next };
}

export function requestRematch(state, playerId, expectedRev) {
  const mark = playerMark(state.players, playerId);
  if (
    !mark ||
    (state.status !== "won" && state.status !== "draw") ||
    (expectedRev !== undefined && (!Number.isSafeInteger(expectedRev) || expectedRev !== state.rev))
  ) {
    return { ok: false, changed: false, state };
  }
  if (state.rematch[mark]) return { ok: true, changed: false, state };

  const rematch = { ...state.rematch, [mark]: true };
  if (!rematch.X || !rematch.O) {
    return { ok: true, changed: true, state: { ...state, rematch } };
  }

  const starter = otherMark(state.starter);
  return {
    ok: true,
    changed: true,
    state: {
      ...createGame(),
      rev: nextRev(state.rev),
      players: state.players,
      turn: starter,
      starter,
      status: "playing",
      score: state.score,
    },
  };
}

function playerMark(players, playerId) {
  if (playerId === null) return null;
  if (playerId === players.X) return "X";
  return playerId === players.O ? "O" : null;
}

const otherMark = (mark) => (mark === "X" ? "O" : "X");
