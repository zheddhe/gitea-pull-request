import * as assert from "assert";
import {
  VISIBILITY_REFRESH_MIN_INTERVAL_MS,
  visibilityRefreshDecision,
} from "../../features/pullRequests/domain/visibilityRefreshPolicy";

suite("Visibility refresh policy", () => {
  const base = {
    visible: true,
    busy: false,
    hasDraft: false,
    inFlight: false,
    lastRefreshAt: 0,
    now: 100_000,
  };

  test("refreshes a visible idle view", () => {
    assert.strictEqual(visibilityRefreshDecision(base), "refresh");
  });

  test("never refreshes a hidden view", () => {
    assert.strictEqual(
      visibilityRefreshDecision({ ...base, visible: false }),
      "hidden",
    );
  });

  test("defers while busy or while a draft exists", () => {
    assert.strictEqual(
      visibilityRefreshDecision({ ...base, busy: true }),
      "busy",
    );
    assert.strictEqual(
      visibilityRefreshDecision({ ...base, hasDraft: true }),
      "draft",
    );
  });

  test("deduplicates in-flight and recently completed refreshes", () => {
    assert.strictEqual(
      visibilityRefreshDecision({ ...base, inFlight: true }),
      "in-flight",
    );
    assert.strictEqual(
      visibilityRefreshDecision({
        ...base,
        lastRefreshAt: base.now - VISIBILITY_REFRESH_MIN_INTERVAL_MS + 1,
      }),
      "fresh",
    );
    assert.strictEqual(
      visibilityRefreshDecision({
        ...base,
        lastRefreshAt: base.now - VISIBILITY_REFRESH_MIN_INTERVAL_MS,
      }),
      "refresh",
    );
  });
});
