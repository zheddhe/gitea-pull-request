import * as assert from "assert";
import {
  workflowArtifactDownloadPath,
  workflowArtifactsPath,
} from "../../features/ci/services/giteaActionsDetailApi";

suite("Gitea Actions detail API", () => {
  test("builds the authenticated run-scoped artifacts endpoint", () => {
    assert.strictEqual(
      workflowArtifactsPath({ owner: "acme", repo: "payments" } as never, 42),
      "/repos/acme/payments/actions/runs/42/artifacts",
    );
  });

  test("builds the explicit artifact zip download endpoint", () => {
    assert.strictEqual(
      workflowArtifactDownloadPath(
        { owner: "acme", repo: "payments" } as never,
        99,
      ),
      "/repos/acme/payments/actions/artifacts/99/zip",
    );
  });

  test("rejects invalid identifiers instead of constructing ambiguous routes", () => {
    assert.throws(
      () => workflowArtifactsPath({ owner: "acme", repo: "payments" } as never, 0),
      /Invalid workflow run id/,
    );
    assert.throws(
      () =>
        workflowArtifactDownloadPath(
          { owner: "acme", repo: "payments" } as never,
          -1,
        ),
      /Invalid artifact id/,
    );
  });
});
