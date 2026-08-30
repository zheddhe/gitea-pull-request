import * as assert from "assert";
import type { GiteaCombinedStatus } from "../../api/types";
import { hasPendingChecks } from "../../features/pullRequests/services/conflictResolutionCoordinator";

suite("ConflictResolutionCoordinator", () => {
  test("suppresses guidance when an explicit check is pending", () => {
    assert.strictEqual(
      hasPendingChecks(status("pending", ["success", "pending"])),
      true,
    );
  });

  test("suppresses guidance when combined status is pending and checks exist", () => {
    assert.strictEqual(hasPendingChecks(status("pending", ["success"])), true);
  });

  test("does not suppress guidance for pending status without checks", () => {
    assert.strictEqual(hasPendingChecks(status("pending", [])), false);
  });

  test("does not suppress guidance after checks complete", () => {
    assert.strictEqual(hasPendingChecks(status("failure", ["failure"])), false);
    assert.strictEqual(hasPendingChecks(status("success", ["success"])), false);
  });
});

function status(
  state: GiteaCombinedStatus["state"],
  checkStates: GiteaCombinedStatus["statuses"][number]["state"][],
): GiteaCombinedStatus {
  return {
    state,
    total_count: checkStates.length,
    statuses: checkStates.map((checkState, index) => ({
      id: index + 1,
      state: checkState,
      context: `check-${index + 1}`,
      description: "",
      target_url: "",
      created_at: "",
    })),
  };
}
