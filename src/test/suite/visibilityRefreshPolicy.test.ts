import * as assert from "assert";
import { visibilityRefreshDecision } from "../../features/pullRequests/domain/visibilityRefreshPolicy";

suite("Visibility refresh policy", () => {
  const base = {
    visible: true,
    busy: false,
    hasDraft: false,
    inFlight: false,
    lastRefreshAt: 0,
    now: 100_000,
  };

  test("never initiates a network refresh after scheduler migration", () => {
    for (const context of [
      base,
      { ...base, visible: false },
      { ...base, busy: true },
      { ...base, hasDraft: true },
      { ...base, inFlight: true },
      { ...base, lastRefreshAt: 99_999 },
    ]) {
      assert.strictEqual(visibilityRefreshDecision(context), "fresh");
    }
  });
});
