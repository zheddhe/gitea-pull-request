import * as assert from "assert";
import { localBranchDeleteArgs } from "../../features/pullRequests/services/branchCleanupService";

suite("Branch cleanup safety", () => {
  test("uses non-forced local branch deletion by default", () => {
    assert.deepStrictEqual(localBranchDeleteArgs("feature/work"), [
      "branch",
      "-d",
      "--",
      "feature/work",
    ]);
  });

  test("uses forced deletion only when safety was verified by the caller", () => {
    assert.deepStrictEqual(localBranchDeleteArgs("feature/work", true), [
      "branch",
      "-D",
      "--",
      "feature/work",
    ]);
  });
});
