"use strict";

const MAX_ENTRIES = 8;
const STALE_AFTER_MS = 30 * 60 * 1000;

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampPercent(value) {
  const n = finiteNumber(value);
  if (n === null) return null;
  return Math.max(0, Math.min(100, n));
}

function normalizeWindow(value) {
  if (!value || typeof value !== "object") return null;
  const usedPercentage = clampPercent(
    value.used_percentage ?? value.usedPercentage ?? value.used
  );
  const remainingPercentage = clampPercent(
    value.remaining_percentage ?? value.remainingPercentage ?? value.remaining
  );
  const resetsAt = finiteNumber(value.resets_at ?? value.resetsAt ?? value.reset_at ?? value.resetAt);
  if (usedPercentage === null && remainingPercentage === null && resetsAt === null) return null;
  return {
    usedPercentage,
    remainingPercentage,
    resetsAt,
  };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeAgentId(value) {
  const raw = firstString(value, "unknown").toLowerCase();
  if (raw === "claude" || raw === "claude_code") return "claude-code";
  if (raw === "codex-cli") return "codex";
  return raw;
}

function defaultLabel(agentId) {
  if (agentId === "claude-code") return "Claude";
  if (agentId === "codex") return "Codex";
  return agentId || "Usage";
}

function normalizeUsageLimitUpdate(payload, now = Date.now()) {
  if (!payload || typeof payload !== "object") return null;
  const agentId = normalizeAgentId(payload.agent_id ?? payload.agentId ?? payload.agent);
  const label = firstString(
    payload.account_label,
    payload.accountLabel,
    payload.label,
    payload.profile,
    payload.session_name,
    payload.sessionName,
    defaultLabel(agentId)
  );
  const sessionId = firstString(payload.session_id, payload.sessionId);
  const sourceId = firstString(payload.source_id, payload.sourceId, label, sessionId, agentId);
  const rawLimits = payload.rate_limits || payload.rateLimits || payload.usage_limits || payload.usageLimits || payload;
  const fiveHour = normalizeWindow(rawLimits.five_hour || rawLimits.fiveHour || rawLimits["5h"]);
  const sevenDay = normalizeWindow(rawLimits.seven_day || rawLimits.sevenDay || rawLimits.weekly || rawLimits["7d"]);
  const contextWindow = normalizeWindow(
    payload.context_window || payload.contextWindow || rawLimits.context_window || rawLimits.contextWindow
  );
  if (!fiveHour && !sevenDay && !contextWindow) return null;
  return {
    id: `${agentId}|${sourceId}`,
    agentId,
    label,
    sessionId: sessionId || null,
    model: firstString(payload.model && payload.model.display_name, payload.model_display_name, payload.modelDisplayName, payload.model) || null,
    fiveHour,
    sevenDay,
    contextWindow,
    updatedAt: Number.isFinite(Number(payload.updated_at ?? payload.updatedAt))
      ? Number(payload.updated_at ?? payload.updatedAt)
      : now,
  };
}

function createUsageLimitsStore(options = {}) {
  const nowFn = typeof options.now === "function" ? options.now : Date.now;
  const onChange = typeof options.onChange === "function" ? options.onChange : () => {};
  const entries = new Map();

  function prune() {
    const cutoff = nowFn() - STALE_AFTER_MS;
    for (const [id, entry] of entries) {
      if (!entry || Number(entry.updatedAt) < cutoff) entries.delete(id);
    }
  }

  function update(payload) {
    const entry = normalizeUsageLimitUpdate(payload, nowFn());
    if (!entry) return { status: "ignored" };
    prune();
    const before = JSON.stringify(entries.get(entry.id) || null);
    entries.set(entry.id, entry);
    while (entries.size > MAX_ENTRIES) {
      let oldestId = null;
      let oldestAt = Infinity;
      for (const [id, item] of entries) {
        const at = Number(item.updatedAt) || 0;
        if (at < oldestAt) {
          oldestAt = at;
          oldestId = id;
        }
      }
      if (!oldestId) break;
      entries.delete(oldestId);
    }
    const changed = before !== JSON.stringify(entry);
    if (changed) onChange(getSnapshot());
    return { status: "ok", entry };
  }

  function getSnapshot() {
    prune();
    return [...entries.values()]
      .sort((a, b) => {
        const byAgent = String(a.agentId).localeCompare(String(b.agentId));
        if (byAgent) return byAgent;
        return String(a.label).localeCompare(String(b.label));
      });
  }

  function clear() {
    if (!entries.size) return;
    entries.clear();
    onChange(getSnapshot());
  }

  return { update, getSnapshot, clear };
}

module.exports = createUsageLimitsStore;
module.exports.__test = {
  normalizeUsageLimitUpdate,
  normalizeWindow,
  constants: { MAX_ENTRIES, STALE_AFTER_MS },
};
