const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  buildUsagePayload,
  formatStatusLine,
  remainingFromWindow,
  formatSubscriptionLabel,
} = require("../hooks/usage-statusline");

describe("usage statusLine hook", () => {
  it("builds a Clawd usage payload from Claude statusLine input", () => {
    const payload = buildUsagePayload({
      session_id: "abc",
      session_name: "Claude Personal",
      model: { display_name: "Sonnet" },
      rate_limits: {
        five_hour: { used_percentage: 10 },
        seven_day: { used_percentage: 20 },
      },
    }, { subscriptionType: null });

    assert.strictEqual(payload.agent_id, "claude-code");
    assert.strictEqual(payload.account_label, "Claude Personal");
    assert.strictEqual(payload.model, "Sonnet");
    assert.strictEqual(payload.rate_limits.five_hour.used_percentage, 10);
  });

  it("labels payloads by detected subscription type", () => {
    const team = buildUsagePayload({
      rate_limits: { five_hour: { used_percentage: 10 } },
    }, { subscriptionType: "team" });
    const pro = buildUsagePayload({
      rate_limits: { five_hour: { used_percentage: 10 } },
    }, { subscriptionType: "pro" });
    assert.strictEqual(team.account_label, "Claude Team");
    assert.strictEqual(pro.account_label, "Claude Pro");
    assert.strictEqual(formatSubscriptionLabel("max"), "Max");
    assert.strictEqual(formatSubscriptionLabel(""), null);
    assert.strictEqual(formatSubscriptionLabel(null), null);
  });

  it("formats remaining percentages for terminal display", () => {
    assert.strictEqual(remainingFromWindow({ used_percentage: 25 }), 75);
    assert.match(formatStatusLine({
      model: { display_name: "Opus" },
      rate_limits: {
        five_hour: { used_percentage: 25 },
        seven_day: { remaining_percentage: 91 },
      },
      context_window: { used_percentage: 12 },
    }), /5h 75% left  7d 91% left  ctx 12%/);
  });

  it("returns null for missing window values without coercing null to 0", () => {
    assert.strictEqual(remainingFromWindow({}), null);
    assert.strictEqual(remainingFromWindow({ used_percentage: null }), null);
    assert.strictEqual(remainingFromWindow({ remaining_percentage: null, used_percentage: 30 }), 70);
  });
});
