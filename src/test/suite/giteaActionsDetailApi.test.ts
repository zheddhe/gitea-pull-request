import * as assert from "assert";
import { workflowArtifactsPath } from "../../features/ci/services/giteaActionsDetailApi";

suite("Gitea Actions detail API", () => {
  test("builds the authenticated run-scoped artifacts endpoint", () => {
    assert.strictEqual(
      workflowArtifactsPath({ owner: "acme", repo: "payments" } as never, 42),
      "/repos/acme/payments/actions/runs/42/artifacts",
    );
  });

  test("rejects invalid run identifiers instead of constructing ambiguous routes", () => {
    assert.throws(
      () => workflowArtifactsPath({ owner: "acme", repo: "payments" } as never, 0),
      /Invalid workflow run id/,
    );
  });
});
