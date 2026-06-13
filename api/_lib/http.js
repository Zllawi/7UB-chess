export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) {
    return JSON.parse(req.body);
  }

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
  }
  return raw.trim() ? JSON.parse(raw) : {};
}

export function methodNotAllowed(res, allowed = ["GET"]) {
  res.setHeader("Allow", allowed.join(", "));
  res.status(405).json({
    ok: false,
    error: "Method not allowed."
  });
}

export function sendError(res, error) {
  res.status(error?.status || 400).json({
    ok: false,
    error: error?.message || "Request failed.",
    code: error?.code || "REQUEST_FAILED"
  });
}
