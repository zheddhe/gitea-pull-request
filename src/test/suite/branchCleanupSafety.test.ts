import * as assert from "assert";
import { localBranchDeleteArgs } from "../../features/pullRequests/services/branchCleanupService";

suite("Branch cleanup safety", () => {
  test("uses non-forced local branch deletion", () => {
    assert.deepStrictEqual(localBranchDeleteArgs("feature/work"), [
      "branch",
      "-d",
      "--",
      "feature/work",
    ]);
  });
});
