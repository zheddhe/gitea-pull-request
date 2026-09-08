import * as assert from "assert";
import {
  CapabilityRegistry,
  capabilityForRequest,
} from "../../auth/capabilityRegistry";

suite("CapabilityRegistry", () => {
  test("isolates observed state per Gitea instance", () => {
    const registry = new CapabilityRegistry();
    const a = "https://gitea-a.example";
    const b = "https://gitea-b.example";

    registry.markVerified(a, "repository.read");
    registry.markDenied(b, "repository.read");

    assert.strictEqual(registry.get(a, "repository.read"), "verified");
    assert.strictEqual(registry.get(b, "repository.read"), "denied");
    assert.strictEqual(registry.get(a, "issues.read"), "unknown");
  });

  test("reset affects only the selected instance", () => {
    const registry = new CapabilityRegistry();
    const a = "https://gitea-a.example";
    const b = "https://gitea-b.example";

    registry.markVerified(a, "identity.read");
    registry.markVerified(b, "identity.read");
    registry.reset(a);

    assert.strictEqual(registry.get(a, "identity.read"), "unknown");
    assert.strictEqual(registry.get(b, "identity.read"), "verified");
  });

  test("supports explicit unsupported state without inferring it globally", () => {
    const registry = new CapabilityRegistry();
    const server = "https://gitea.example";

    registry.markUnsupported(server, "actions.read");

    assert.strictEqual(registry.get(server, "actions.read"), "unsupported");
    assert.strictEqual(registry.get(server, "repository.read"), "unknown");
  });

  test("maps API routes and methods to conceptual capabilities", () => {
    assert.strictEqual(capabilityForRequest("/user"), "identity.read");
    assert.strictEqual(
      capabilityForRequest("/repos/acme/app/pulls?state=open"),
      "repository.read",
    );
    assert.strictEqual(
      capabilityForRequest("/repos/acme/app/pulls", "POST"),
      "repository.write",
    );
    assert.strictEqual(
      capabilityForRequest("/repos/acme/app/issues/12/comments"),
      "issues.read",
    );
    assert.strictEqual(
      capabilityForRequest("/repos/acme/app/issues", "POST"),
      "issues.write",
    );
    assert.strictEqual(
      capabilityForRequest("/repos/acme/app/actions/runs"),
      "actions.read",
    );
    assert.strictEqual(
      capabilityForRequest("/repos/acme/app/actions/runs/3/rerun", "POST"),
      "actions.write",
    );
  });
});
