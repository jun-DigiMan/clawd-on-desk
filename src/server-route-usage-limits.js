"use strict";

const { CLAWD_SERVER_HEADER, CLAWD_SERVER_ID } = require("../hooks/server-config");

const MAX_USAGE_LIMITS_BODY_BYTES = 8192;

function handleUsageLimitsPost(req, res, options = {}) {
  const updateUsageLimits = typeof options.updateUsageLimits === "function"
    ? options.updateUsageLimits
    : null;
  let body = "";
  let bodySize = 0;
  let tooLarge = false;

  req.on("data", (chunk) => {
    if (tooLarge) return;
    bodySize += chunk.length;
    if (bodySize > MAX_USAGE_LIMITS_BODY_BYTES) {
      tooLarge = true;
      return;
    }
    body += chunk;
  });

  req.on("end", () => {
    if (tooLarge) {
      res.writeHead(413);
      res.end("usage limit payload too large");
      return;
    }
    if (!updateUsageLimits) {
      res.writeHead(204, { [CLAWD_SERVER_HEADER]: CLAWD_SERVER_ID });
      res.end();
      return;
    }
    try {
      const payload = JSON.parse(body);
      const result = updateUsageLimits(payload);
      res.writeHead(result && result.status === "ok" ? 200 : 204, {
        [CLAWD_SERVER_HEADER]: CLAWD_SERVER_ID,
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify({ ok: result && result.status === "ok" }));
    } catch {
      res.writeHead(400);
      res.end("bad json");
    }
  });
}

module.exports = {
  MAX_USAGE_LIMITS_BODY_BYTES,
  handleUsageLimitsPost,
};
