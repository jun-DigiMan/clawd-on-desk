#!/usr/bin/env node
"use strict";

const {
  postUsageLimitsToRunningServer,
} = require("./server-config");

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

function remainingFromWindow(win) {
  if (!win || typeof win !== "object") return null;
  const remaining = pct(win.remaining_percentage ?? win.remainingPercentage);
  if (remaining !== null) return remaining;
  const used = pct(win.used_percentage ?? win.usedPercentage);
  return used === null ? null : 100 - used;
}

function labelFromPayload(payload) {
  const envLabel = process.env.CLAWD_USAGE_LABEL || process.env.CLAWD_USAGE_ACCOUNT;
  if (typeof envLabel === "string" && envLabel.trim()) return envLabel.trim();
  const sessionName = payload && (payload.session_name || payload.sessionName);
  if (typeof sessionName === "string" && sessionName.trim()) return sessionName.trim();
  return "Claude";
}

function buildUsagePayload(input) {
  const payload = input && typeof input === "object" ? input : {};
  const limits = payload.rate_limits || payload.rateLimits || null;
  const contextWindow = payload.context_window || payload.contextWindow || null;
  if (!limits && !contextWindow) return null;
  return {
    agent_id: "claude-code",
    account_label: labelFromPayload(payload),
    session_id: payload.session_id || payload.sessionId || null,
    session_name: payload.session_name || payload.sessionName || null,
    model: payload.model && (payload.model.display_name || payload.model.id) || null,
    rate_limits: limits,
    context_window: contextWindow,
  };
}

function formatStatusLine(input) {
  const payload = input && typeof input === "object" ? input : {};
  const model = payload.model && (payload.model.display_name || payload.model.id) || "Claude";
  const five = remainingFromWindow(payload.rate_limits && payload.rate_limits.five_hour);
  const week = remainingFromWindow(payload.rate_limits && payload.rate_limits.seven_day);
  const ctx = pct(payload.context_window && payload.context_window.used_percentage);
  const parts = [];
  if (five !== null) parts.push(`5h ${Math.round(five)}% left`);
  if (week !== null) parts.push(`7d ${Math.round(week)}% left`);
  if (ctx !== null) parts.push(`ctx ${Math.round(ctx)}%`);
  return parts.length ? `[${model}] ${parts.join("  ")}` : `[${model}]`;
}

async function main() {
  const raw = await readStdin();
  let input = null;
  try { input = JSON.parse(raw); } catch {}

  const usagePayload = buildUsagePayload(input);
  if (usagePayload) {
    postUsageLimitsToRunningServer(
      usagePayload,
      { timeoutMs: 80 },
      () => process.stdout.write(`${formatStatusLine(input)}\n`)
    );
    return;
  }
  process.stdout.write(`${formatStatusLine(input)}\n`);
}

if (require.main === module) {
  main().catch(() => {
    process.stdout.write("[Claude]\n");
  });
}

module.exports = {
  buildUsagePayload,
  formatStatusLine,
  remainingFromWindow,
};
