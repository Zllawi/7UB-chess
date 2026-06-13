import { readJson, methodNotAllowed, sendError } from "./_lib/http.js";
import { createRoom, serializeRoom } from "./_lib/rooms.js";
import { usingPersistentStorage } from "./_lib/storage.js";

function requestOrigin(req) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return `${protocol}://${host}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    methodNotAllowed(res, ["POST"]);
    return;
  }

  try {
    const body = await readJson(req);
    const room = await createRoom({
      whiteName: body.whiteName,
      blackName: body.blackName,
      timeMinutes: body.timeMinutes
    });
    const origin = requestOrigin(req);
    res.status(201).json({
      ok: true,
      storage: usingPersistentStorage() ? "persistent" : "memory",
      room: serializeRoom(room, {
        token: room.players.w.token,
        includeLinks: true,
        origin
      })
    });
  } catch (error) {
    sendError(res, error);
  }
}
