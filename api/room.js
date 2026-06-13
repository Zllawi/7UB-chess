import { readJson, methodNotAllowed, sendError } from "./_lib/http.js";
import {
  loadRoom,
  makeRoomMove,
  markJoined,
  resignRoom,
  saveRoom,
  serializeRoom,
  startRoom,
  touchTimeout
} from "./_lib/rooms.js";
import { usingPersistentStorage } from "./_lib/storage.js";

function requestOrigin(req) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return `${protocol}://${host}`;
}

async function handleGet(req, res) {
  const room = await loadRoom(req.query.id);
  const token = String(req.query.token || "");
  const joined = markJoined(room, token);
  await touchTimeout(room);
  if (joined) await saveRoom(room);
  res.status(200).json({
    ok: true,
    storage: usingPersistentStorage() ? "persistent" : "memory",
    room: serializeRoom(room, {
      token,
      includeLinks: true,
      origin: requestOrigin(req)
    })
  });
}

async function handlePost(req, res) {
  const body = await readJson(req);
  const action = String(body.action || "").trim().toLowerCase();
  const roomId = String(body.roomId || body.id || req.query.id || "");
  const token = String(body.token || "");

  if (action === "start") {
    const room = await startRoom(roomId, token);
    res.status(200).json({
      ok: true,
      room: serializeRoom(room, { token })
    });
    return;
  }

  if (action === "move") {
    const room = await makeRoomMove(roomId, {
      token,
      from: body.from,
      to: body.to,
      promotion: body.promotion
    });
    res.status(200).json({
      ok: true,
      room: serializeRoom(room, { token })
    });
    return;
  }

  if (action === "resign") {
    const room = await resignRoom(roomId, token);
    res.status(200).json({
      ok: true,
      room: serializeRoom(room, { token })
    });
    return;
  }

  res.status(400).json({
    ok: false,
    error: "Unknown room action.",
    code: "UNKNOWN_ACTION"
  });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      await handleGet(req, res);
      return;
    }

    if (req.method === "POST") {
      await handlePost(req, res);
      return;
    }

    methodNotAllowed(res, ["GET", "POST"]);
  } catch (error) {
    sendError(res, error);
  }
}
