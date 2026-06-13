import { readJson, methodNotAllowed, sendError } from "../../_lib/http.js";
import { serializeRoom, startRoom } from "../../_lib/rooms.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    methodNotAllowed(res, ["POST"]);
    return;
  }

  try {
    const body = await readJson(req);
    const token = String(body.token || "");
    const room = await startRoom(req.query.id, token);
    res.status(200).json({
      ok: true,
      room: serializeRoom(room, { token })
    });
  } catch (error) {
    sendError(res, error);
  }
}
