"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const POLL_INTERVAL_MS = 60_000;
const SCAN_RECENT_MS = 24 * 60 * 60 * 1000;
const ROLLOUT_TAIL_BYTES = 64 * 1024;

function defaultSessionsRoot() {
  return path.join(os.homedir(), ".codex", "sessions");
}

function listRecentRolloutFiles(root, now = Date.now(), limit = 8) {
  const out = [];
  let stack;
  try {
    stack = [root];
  } catch {
    return out;
  }
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.startsWith("rollout-") || !entry.name.endsWith(".jsonl")) continue;
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (now - stat.mtimeMs > SCAN_RECENT_MS) continue;
      out.push({ path: full, mtimeMs: stat.mtimeMs, size: stat.size });
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, limit);
}

function readTailLines(filePath, size) {
  const start = Math.max(0, size - ROLLOUT_TAIL_BYTES);
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return [];
  }
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8").split("\n");
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

function findLatestRateLimitEntry(filePath, size) {
  const lines = readTailLines(filePath, size);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.indexOf("rate_limits") === -1) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    const payload = parsed && parsed.payload;
    if (!payload || payload.type !== "token_count" || !payload.rate_limits) continue;
    return { entry: parsed, payload };
  }
  return null;
}

function buildUsagePayloadFromRollout(filePath, parsed) {
  if (!parsed || !parsed.payload || !parsed.payload.rate_limits) return null;
  const rateLimits = parsed.payload.rate_limits;
  const info = parsed.payload.info || {};
  const primary = rateLimits.primary || null;
  const secondary = rateLimits.secondary || null;
  if (!primary && !secondary) return null;

  const planType = typeof rateLimits.plan_type === "string" && rateLimits.plan_type
    ? rateLimits.plan_type
    : null;
  const planLabel = planType
    ? `Codex ${planType.charAt(0).toUpperCase()}${planType.slice(1)}`
    : "Codex";

  const sessionId = path.basename(filePath, ".jsonl");
  const rateLimitsForStore = {};
  if (primary && typeof primary.used_percent === "number") {
    rateLimitsForStore.five_hour = {
      used_percentage: primary.used_percent,
      resets_at: primary.resets_at,
    };
  }
  if (secondary && typeof secondary.used_percent === "number") {
    rateLimitsForStore.seven_day = {
      used_percentage: secondary.used_percent,
      resets_at: secondary.resets_at,
    };
  }

  let contextWindow = null;
  const last = info.last_token_usage;
  const ctxSize = Number(info.model_context_window);
  if (last && Number.isFinite(ctxSize) && ctxSize > 0) {
    const used = Number(last.input_tokens) + Number(last.cached_input_tokens || 0)
      + Number(last.output_tokens || 0) + Number(last.reasoning_output_tokens || 0);
    if (Number.isFinite(used) && used >= 0) {
      contextWindow = {
        used_percentage: Math.max(0, Math.min(100, (used / ctxSize) * 100)),
      };
    }
  }

  return {
    agent_id: "codex",
    account_label: planLabel,
    source_id: planLabel,
    session_id: sessionId,
    model: null,
    rate_limits: rateLimitsForStore,
    context_window: contextWindow,
  };
}

function scanLatestUsage(options = {}) {
  const sessionsRoot = options.sessionsRoot || defaultSessionsRoot();
  const now = typeof options.now === "function" ? options.now() : Date.now();
  const files = listRecentRolloutFiles(sessionsRoot, now);
  for (const file of files) {
    const hit = findLatestRateLimitEntry(file.path, file.size);
    if (!hit) continue;
    const payload = buildUsagePayloadFromRollout(file.path, hit.entry);
    if (payload) return { payload, sourceFile: file.path, mtimeMs: file.mtimeMs };
  }
  return null;
}

function startCodexUsageWatcher(options = {}) {
  const interval = options.intervalMs || POLL_INTERVAL_MS;
  const updateUsageLimits = typeof options.updateUsageLimits === "function"
    ? options.updateUsageLimits
    : null;
  if (!updateUsageLimits) return { stop: () => {} };
  let lastSignature = null;
  let timer = null;

  function tick() {
    let scan;
    try { scan = scanLatestUsage(options); } catch { scan = null; }
    if (!scan) return;
    const signature = JSON.stringify({
      rl: scan.payload.rate_limits,
      cw: scan.payload.context_window,
      label: scan.payload.account_label,
    });
    if (signature === lastSignature) return;
    lastSignature = signature;
    try { updateUsageLimits(scan.payload); } catch {}
  }

  tick();
  timer = setInterval(tick, interval);
  if (typeof timer.unref === "function") timer.unref();
  return { stop: () => { if (timer) clearInterval(timer); } };
}

module.exports = {
  startCodexUsageWatcher,
  scanLatestUsage,
  buildUsagePayloadFromRollout,
  findLatestRateLimitEntry,
  listRecentRolloutFiles,
};
