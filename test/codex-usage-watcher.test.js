"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  scanLatestUsage,
  buildUsagePayloadFromRollout,
  startCodexUsageWatcher,
} = require("../src/codex-usage-watcher");

function mkTmpRolloutDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-usage-test-"));
  const dayDir = path.join(root, "2026", "05", "15");
  fs.mkdirSync(dayDir, { recursive: true });
  return { root, dayDir };
}

function writeRollout(dayDir, name, lines) {
  const file = path.join(dayDir, name);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

function sampleTokenCountEntry(overrides = {}) {
  return {
    timestamp: "2026-05-15T04:53:34.707Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 48771,
          cached_input_tokens: 0,
          output_tokens: 313,
          reasoning_output_tokens: 0,
          total_tokens: 49084,
        },
        model_context_window: 258400,
      },
      rate_limits: {
        limit_id: "codex",
        primary: { used_percent: 9, window_minutes: 300, resets_at: 1778836769 },
        secondary: { used_percent: 67, window_minutes: 10080, resets_at: 1779260945 },
        plan_type: "plus",
        rate_limit_reached_type: null,
      },
      ...overrides,
    },
  };
}

describe("codex-usage-watcher", () => {
  it("maps rollout payload to clawd usage store shape", () => {
    const file = "/tmp/fake-rollout.jsonl";
    const payload = buildUsagePayloadFromRollout(file, sampleTokenCountEntry());
    assert.strictEqual(payload.agent_id, "codex");
    assert.strictEqual(payload.account_label, "Codex Plus");
    assert.strictEqual(payload.rate_limits.five_hour.used_percentage, 9);
    assert.strictEqual(payload.rate_limits.five_hour.resets_at, 1778836769);
    assert.strictEqual(payload.rate_limits.seven_day.used_percentage, 67);
    assert.ok(payload.context_window.used_percentage > 18 && payload.context_window.used_percentage < 20);
  });

  it("scans the newest rollout across nested day folders", () => {
    const { root, dayDir } = mkTmpRolloutDir();
    const older = writeRollout(dayDir, "rollout-2026-05-15T00-00-00-aaaaaaaa.jsonl", [
      sampleTokenCountEntry(),
    ]);
    const newerEntry = sampleTokenCountEntry();
    newerEntry.payload.rate_limits.primary.used_percent = 42;
    const newer = writeRollout(dayDir, "rollout-2026-05-15T10-00-00-bbbbbbbb.jsonl", [
      newerEntry,
    ]);
    fs.utimesSync(older, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    fs.utimesSync(newer, new Date(), new Date());

    const result = scanLatestUsage({ sessionsRoot: root });
    assert.ok(result, "expected scan to find a rollout file");
    assert.strictEqual(result.payload.rate_limits.five_hour.used_percentage, 42);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("ignores rollouts without rate_limits entries", () => {
    const { root, dayDir } = mkTmpRolloutDir();
    writeRollout(dayDir, "rollout-2026-05-15T10-00-00-cccccccc.jsonl", [
      { timestamp: "x", type: "event_msg", payload: { type: "user_message", text: "hi" } },
    ]);
    const result = scanLatestUsage({ sessionsRoot: root });
    assert.strictEqual(result, null);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("startCodexUsageWatcher forwards a fresh payload only when it changes", () => {
    const { root, dayDir } = mkTmpRolloutDir();
    writeRollout(dayDir, "rollout-2026-05-15T10-00-00-dddddddd.jsonl", [sampleTokenCountEntry()]);
    let calls = 0;
    const handle = startCodexUsageWatcher({
      sessionsRoot: root,
      intervalMs: 1_000_000,
      updateUsageLimits: () => { calls += 1; },
    });
    assert.strictEqual(calls, 1, "initial scan should fire once");
    handle.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
