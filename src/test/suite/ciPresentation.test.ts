import * as assert from "assert";
import {
  ciStatusLabel,
  externalCheckPresentation,
  extractGiteaRunId,
  normalizeCIState,
  runPresentation,
} from "../../features/ci/domain/ciPresentation";

suite("CI presentation semantics", () => {
  test("normalizes running, queued, skipped and terminal states", () => {
    assert.strictEqual(normalizeCIState("in_progress"), "running");
    assert.strictEqual(normalizeCIState("pending"), "queued");
    assert.strictEqual(normalizeCIState("waiting"), "queued");
    assert.strictEqual(normalizeCIState("skipped"), "skipped");
    assert.strictEqual(normalizeCIState("completed", "success"), "success");
    assert.strictEqual(normalizeCIState("completed", "failure"), "failure");
  });

  test("renders human readable status labels", () => {
    assert.strictEqual(ciStatusLabel("in_progress"), "in progress");
    assert.strictEqual(ciStatusLabel("completed", "request_changes"), "request changes");
  });

  test("derives run actions from lifecycle", () => {
    assert.deepStrictEqual(
      runPresentation("running", "", "https://gitea.test/o/r/actions/runs/42").actions,
      {
        openInBrowser: true,
        rerun: false,
        cancel: true,
        openLogs: false,
      },
    );
    assert.deepStrictEqual(
      runPresentation("completed", "success", "https://gitea.test/o/r/actions/runs/42").actions,
      {
        openInBrowser: true,
        rerun: true,
        cancel: false,
        openLogs: false,
      },
    );
  });

  test("recognizes Gitea run URLs without treating arbitrary checks as rerunnable", () => {
    assert.strictEqual(
      extractGiteaRunId("https://gitea.test/o/r/actions/runs/123"),
      123,
    );
    assert.strictEqual(extractGiteaRunId("https://ci.example.test/build/123"), undefined);
    assert.strictEqual(
      externalCheckPresentation("success", "https://ci.example.test/build/123").actions.rerun,
      false,
    );
  });
});
