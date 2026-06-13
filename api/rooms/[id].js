import { methodNotAllowed, sendError } from "../_lib/http.js";
import { loadRoom, markJoined, saveRoom, serializeRoom, touchTimeout } from "../_lib/rooms.js";
import { usingPersistentStorage } from "../_lib/storage.js";

function requestOrigin(req) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return `${protocol}://${host}`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    methodNotAllowed(res, ["GET"]);
    return;
  }

  try {
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
  } catch (error) {
    sendError(res, error);
  }
}
