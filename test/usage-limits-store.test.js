const { describe, it } = require("node:test");
const assert = require("node:assert");

const createUsageLimitsStore = require("../src/usage-limits-store");
const {
  normalizeUsageLimitUpdate,
} = createUsageLimitsStore.__test;

describe("usage limits store", () => {
  it("normalizes Claude statusLine rate limit payloads", () => {
    const entry = normalizeUsageLimitUpdate({
      agent_id: "claude-code",
      account_label: "Claude Team",
      session_id: "s1",
      model: "Sonnet",
      rate_limits: {
        five_hour: { used_percentage: 25, resets_at: 100 },
        seven_day: { used_percentage: 40, resets_at: 200 },
      },
      context_window: { used_percentage: 12 },
    }, 1234);

    assert.strictEqual(entry.id, "claude-code|Claude Team");
    assert.strictEqual(entry.label, "Claude Team");
    assert.strictEqual(entry.fiveHour.usedPercentage, 25);
    assert.strictEqual(entry.sevenDay.usedPercentage, 40);
    assert.strictEqual(entry.contextWindow.usedPercentage, 12);
    assert.strictEqual(entry.updatedAt, 1234);
  });

  it("ignores payloads without usable usage fields", () => {
    assert.strictEqual(normalizeUsageLimitUpdate({ agent_id: "codex" }), null);
  });

  it("stores and prunes stale entries", () => {
    let now = 100000;
    let changes = 0;
    const store = createUsageLimitsStore({
      now: () => now,
      onChange: () => { changes += 1; },
    });

    assert.strictEqual(store.update({
      agent_id: "codex",
      account_label: "Codex",
      rate_limits: { five_hour: { remaining_percentage: 90 } },
    }).status, "ok");
    assert.strictEqual(store.getSnapshot().length, 1);

    now += 31 * 60 * 1000;
    assert.strictEqual(store.getSnapshot().length, 0);
    assert.strictEqual(changes, 1);
  });
});
