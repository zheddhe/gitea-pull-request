import * as assert from "assert";
import { PollingLifecycleState } from "../../features/polling/domain/pollingLifecycleState";

suite("PollingLifecycleState", () => {
  test("builds context from centralized lifecycle signals", () => {
    const state = new PollingLifecycleState();

    state.setWindowActive(false);
    state.setLifecycle("active");
    state.setSurfaceVisible("pull-request-review", true);

    assert.deepStrictEqual(
      state.contextFor("pull-request", "pull-request-review", 1_000),
      {
        resourceKind: "pull-request",
        windowActive: false,
        visible: true,
        activity: "idle",
        lifecycle: "active",
      },
    );
  });

  test("pending editing takes precedence over recent action", () => {
    const state = new PollingLifecycleState();
    state.setLifecycle("active");
    state.markRecentAction(1_000, 10_000);
    state.setEditing(true);

    assert.strictEqual(state.snapshot(2_000).activity, "editing");
    state.setEditing(false);
    assert.strictEqual(state.snapshot(2_000).activity, "recent-action");
    assert.strictEqual(state.snapshot(12_000).activity, "idle");
  });

  test("tracks surface visibility independently", () => {
    const state = new PollingLifecycleState();
    state.setSurfaceVisible("pull-request-review", true);

    assert.strictEqual(
      state.contextFor("pull-request", "pull-request-review", 0).visible,
      true,
    );
    assert.strictEqual(
      state.contextFor("issues", "issues", 0).visible,
      false,
    );

    state.setSurfaceVisible("pull-request-review", false);
    assert.strictEqual(state.snapshot(0).visibleSurfaces.size, 0);
  });

  test("reports whether signal changes are meaningful", () => {
    const state = new PollingLifecycleState();

    assert.strictEqual(state.setWindowActive(true), false);
    assert.strictEqual(state.setWindowActive(false), true);
    assert.strictEqual(state.setWindowActive(false), false);

    assert.strictEqual(state.setLifecycle("terminal"), false);
    assert.strictEqual(state.setLifecycle("creation"), true);

    assert.strictEqual(state.setEditing(false), false);
    assert.strictEqual(state.setEditing(true), true);

    assert.strictEqual(state.setSurfaceVisible("ci-runs", true), true);
    assert.strictEqual(state.setSurfaceVisible("ci-runs", true), false);
  });
});
