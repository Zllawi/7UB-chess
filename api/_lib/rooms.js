import crypto from "node:crypto";
import { Chess } from "chess.js";
import { getRoom, setRoom } from "./storage.js";

const ROOM_TTL_SECONDS = 24 * 60 * 60;
const MIN_TIME_MINUTES = 1;
const MAX_TIME_MINUTES = 120;
const DEFAULT_TIME_MINUTES = 10;

function serviceError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function createId(size = 7) {
  return crypto.randomBytes(size).toString("base64url");
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function cleanName(value, fallback) {
  const normalized = String(value || "").trim().slice(0, 24);
  return normalized || fallback;
}

function colorLabel(color) {
  return color === "w" ? "الأبيض" : "الأسود";
}

function opponentColor(color) {
  return color === "w" ? "b" : "w";
}

function hydrateChess(room) {
  const chess = new Chess();
  for (const move of room.moves || []) {
    chess.move({
      from: move.from,
      to: move.to,
      promotion: move.promotion || undefined
    });
  }
  return chess;
}

function serializeBoard(chess) {
  return chess.board().map((row) =>
    row.map((piece) =>
      piece
        ? {
            color: piece.color,
            type: piece.type
          }
        : null
    )
  );
}

function serializeMove(move) {
  return {
    color: move.color,
    from: move.from,
    to: move.to,
    san: move.san,
    lan: move.lan,
    piece: move.piece,
    captured: move.captured || "",
    promotion: move.promotion || "",
    flags: move.flags || ""
  };
}

function resolveRole(room, token) {
  if (token && token === room.players.w.token) return { role: "white", color: "w", owner: true };
  if (token && token === room.players.b.token) return { role: "black", color: "b", owner: false };
  return { role: "spectator", color: null, owner: false };
}

function displayedRemainingMs(room, now = Date.now()) {
  const remaining = {
    w: Number(room.remainingMs?.w || 0),
    b: Number(room.remainingMs?.b || 0)
  };
  if (room.status !== "active" || !room.activeTurnStartedAt) return remaining;
  const turn = hydrateChess(room).turn();
  remaining[turn] = Math.max(0, remaining[turn] - Math.max(0, now - room.activeTurnStartedAt));
  return remaining;
}

function applyClock(room, now = Date.now()) {
  if (room.status !== "active" || !room.activeTurnStartedAt) return null;
  const turn = hydrateChess(room).turn();
  const elapsed = Math.max(0, now - room.activeTurnStartedAt);
  room.remainingMs[turn] = Math.max(0, Number(room.remainingMs[turn] || 0) - elapsed);
  room.activeTurnStartedAt = now;
  return { color: turn, remainingMs: room.remainingMs[turn] };
}

function finishRoom(room, result) {
  room.status = "finished";
  room.finishedAt = Date.now();
  room.activeTurnStartedAt = null;
  room.result = {
    winnerColor: result.winnerColor || null,
    reason: result.reason || "finished",
    summary: result.summary || "انتهت المباراة."
  };
  room.updatedAt = Date.now();
  return room;
}

function resultSummary(room, winnerColor, reason) {
  const winnerName = room.players[winnerColor]?.name || colorLabel(winnerColor);
  const loserColor = opponentColor(winnerColor);
  const loserName = room.players[loserColor]?.name || colorLabel(loserColor);
  return `الفائز: ${winnerName} ضد ${loserName}. ${reason}`;
}

function checkTimeout(room) {
  if (room.status !== "active") return false;
  const clock = applyClock(room);
  if (!clock || clock.remainingMs > 0) return false;
  const winnerColor = opponentColor(clock.color);
  finishRoom(room, {
    winnerColor,
    reason: "timeout",
    summary: resultSummary(room, winnerColor, `انتهى وقت ${colorLabel(clock.color)}.`)
  });
  return true;
}

function assertSquare(value) {
  const square = String(value || "").trim().toLowerCase();
  if (!/^[a-h][1-8]$/.test(square)) {
    throw serviceError("bad_square", "Invalid square.");
  }
  return square;
}

export async function createRoom({ whiteName, blackName, timeMinutes }) {
  const time = clampInteger(timeMinutes, MIN_TIME_MINUTES, MAX_TIME_MINUTES, DEFAULT_TIME_MINUTES);
  const now = Date.now();
  const room = {
    id: createId(),
    status: "waiting",
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    timeControlSeconds: time * 60,
    activeTurnStartedAt: null,
    remainingMs: {
      w: time * 60 * 1000,
      b: time * 60 * 1000
    },
    players: {
      w: {
        name: cleanName(whiteName, "White"),
        token: createId(18),
        joinedAt: now
      },
      b: {
        name: cleanName(blackName, "Black"),
        token: createId(18),
        joinedAt: null
      }
    },
    moves: [],
    result: null
  };
  await setRoom(room.id, room, ROOM_TTL_SECONDS);
  return room;
}

export async function loadRoom(roomId) {
  const room = await getRoom(String(roomId || ""));
  if (!room) throw serviceError("not_found", "Room not found.", 404);
  return room;
}

export async function saveRoom(room) {
  room.updatedAt = Date.now();
  await setRoom(room.id, room, ROOM_TTL_SECONDS);
}

export function markJoined(room, token) {
  const role = resolveRole(room, token);
  if (role.color && !room.players[role.color].joinedAt) {
    room.players[role.color].joinedAt = Date.now();
    room.updatedAt = Date.now();
    return true;
  }
  return false;
}

export function serializeRoom(room, { token = "", includeLinks = false, origin = "" } = {}) {
  const chess = hydrateChess(room);
  const role = resolveRole(room, token);
  const remaining = displayedRemainingMs(room);
  const legalMoves =
    room.status === "active" && role.color === chess.turn()
      ? chess.moves({ verbose: true }).map(serializeMove)
      : [];
  const links =
    includeLinks && role.owner && origin
      ? {
          white: `${origin}/?room=${encodeURIComponent(room.id)}&token=${encodeURIComponent(room.players.w.token)}`,
          black: `${origin}/?room=${encodeURIComponent(room.id)}&token=${encodeURIComponent(room.players.b.token)}`,
          watch: `${origin}/?room=${encodeURIComponent(room.id)}`
        }
      : null;

  return {
    id: room.id,
    status: room.status,
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    finishedAt: room.finishedAt,
    timeControlSeconds: room.timeControlSeconds,
    turn: room.status === "active" ? chess.turn() : null,
    board: serializeBoard(chess),
    fen: chess.fen(),
    inCheck: chess.isCheck(),
    legalMoves,
    moves: room.moves || [],
    lastMove: room.moves?.at(-1) || null,
    role: role.role,
    playerColor: role.color,
    isOwner: role.owner,
    canStart: role.owner && room.status === "waiting" && Boolean(room.players.b.joinedAt),
    canResign: Boolean(role.color && room.status === "active"),
    canMove: Boolean(role.color && room.status === "active" && role.color === chess.turn()),
    canShare: Boolean(role.owner),
    players: {
      white: {
        name: room.players.w.name,
        joined: Boolean(room.players.w.joinedAt)
      },
      black: {
        name: room.players.b.name,
        joined: Boolean(room.players.b.joinedAt)
      }
    },
    clocks: {
      whiteMs: remaining.w,
      blackMs: remaining.b,
      serverNow: Date.now(),
      activeTurnStartedAt: room.status === "active" ? room.activeTurnStartedAt : null
    },
    result: room.result,
    links
  };
}

export async function startRoom(roomId, token) {
  const room = await loadRoom(roomId);
  const role = resolveRole(room, token);
  if (!role.owner) throw serviceError("not_owner", "Only the invite owner can start the game.", 403);
  if (room.status !== "waiting") throw serviceError("not_waiting", "This room cannot be started.");
  if (!room.players.b.joinedAt) {
    throw serviceError("black_not_joined", "Wait until the black player opens their link.", 409);
  }
  room.status = "active";
  room.startedAt = Date.now();
  room.activeTurnStartedAt = room.startedAt;
  await saveRoom(room);
  return room;
}

export async function makeRoomMove(roomId, { token, from, to, promotion }) {
  const room = await loadRoom(roomId);
  if (checkTimeout(room)) {
    await saveRoom(room);
    throw serviceError("timeout", "The active clock ran out.", 409);
  }
  if (room.status !== "active") throw serviceError("not_active", "This game is not active.");

  const role = resolveRole(room, token);
  if (!role.color) throw serviceError("not_player", "Only players can move.", 403);
  let chess = hydrateChess(room);
  if (chess.turn() !== role.color) throw serviceError("not_turn", "It is not your turn.", 409);

  const clock = applyClock(room);
  if (clock && clock.remainingMs <= 0) {
    const winnerColor = opponentColor(clock.color);
    finishRoom(room, {
      winnerColor,
      reason: "timeout",
      summary: resultSummary(room, winnerColor, `انتهى وقت ${colorLabel(clock.color)}.`)
    });
    await saveRoom(room);
    throw serviceError("timeout", "Your clock ran out.", 409);
  }

  chess = hydrateChess(room);
  const moveFrom = assertSquare(from);
  const moveTo = assertSquare(to);
  const requestedPromotion = String(promotion || "").trim().toLowerCase();
  const legalMoves = chess
    .moves({ verbose: true })
    .filter((move) => move.from === moveFrom && move.to === moveTo);
  const selectedMove =
    legalMoves.find((move) => move.promotion && move.promotion === requestedPromotion) ||
    legalMoves.find((move) => !move.promotion) ||
    legalMoves.find((move) => move.promotion === "q") ||
    legalMoves[0];

  if (!selectedMove) throw serviceError("illegal_move", "Illegal move.");
  const move = chess.move({
    from: moveFrom,
    to: moveTo,
    promotion: selectedMove.promotion || requestedPromotion || undefined
  });
  if (!move) throw serviceError("illegal_move", "Illegal move.");

  room.moves.push({
    at: Date.now(),
    color: move.color,
    from: move.from,
    to: move.to,
    san: move.san,
    lan: move.lan,
    piece: move.piece,
    captured: move.captured || "",
    promotion: move.promotion || "",
    flags: move.flags || ""
  });

  if (chess.isCheckmate()) {
    finishRoom(room, {
      winnerColor: move.color,
      reason: "checkmate",
      summary: resultSummary(room, move.color, "كش مات.")
    });
  } else if (chess.isDraw()) {
    let reason = "انتهت المباراة بالتعادل.";
    if (chess.isStalemate()) reason = "تعادل: لا توجد حركة قانونية.";
    else if (chess.isInsufficientMaterial()) reason = "تعادل: قطع غير كافية للمات.";
    else if (chess.isThreefoldRepetition()) reason = "تعادل: تكرار الوضع ثلاث مرات.";
    finishRoom(room, {
      winnerColor: null,
      reason: "draw",
      summary: `${room.players.w.name} ضد ${room.players.b.name}. ${reason}`
    });
  } else {
    room.activeTurnStartedAt = Date.now();
  }

  await saveRoom(room);
  return room;
}

export async function resignRoom(roomId, token) {
  const room = await loadRoom(roomId);
  if (room.status !== "active") throw serviceError("not_active", "This game is not active.");
  const role = resolveRole(room, token);
  if (!role.color) throw serviceError("not_player", "Only players can resign.", 403);
  applyClock(room);
  const winnerColor = opponentColor(role.color);
  finishRoom(room, {
    winnerColor,
    reason: "resign",
    summary: resultSummary(room, winnerColor, `${room.players[role.color].name} انسحب.`)
  });
  await saveRoom(room);
  return room;
}

export async function touchTimeout(room) {
  const timedOut = checkTimeout(room);
  if (timedOut) await saveRoom(room);
  return timedOut;
}
