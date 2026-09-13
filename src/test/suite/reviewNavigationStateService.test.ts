import * as assert from "assert";
import { ReviewNavigationStateService } from "../../features/pullRequests/services/reviewNavigationStateService";

suite("Review navigation state service", () => {
  test("preserves navigation mode while activating another pull request", () => {
    const service = new ReviewNavigationStateService();
    service.setMode("pending");

    service.activate("repo-a", 12);
    assert.deepStrictEqual(service.current, {
      repositoryKey: "repo-a",
      pullRequestNumber: 12,
      mode: "pending",
    });

    service.select("pending:one");
    service.activate("repo-b", 4);
    assert.deepStrictEqual(service.current, {
      repositoryKey: "repo-b",
      pullRequestNumber: 4,
      mode: "pending",
    });

    service.dispose();
  });

  test("switching mode resets the logical active item", () => {
    const service = new ReviewNavigationStateService();
    service.activate("repo", 3);
    service.select("conversation:42");

    service.setMode("pending");

    assert.deepStrictEqual(service.current, {
      repositoryKey: "repo",
      pullRequestNumber: 3,
      mode: "pending",
      activeItemId: undefined,
    });
    service.dispose();
  });

  test("reconcile keeps a valid active item and clears a removed item", () => {
    const service = new ReviewNavigationStateService();
    service.activate("repo", 3);
    service.select("conversation:42");

    service.reconcile(["conversation:12", "conversation:42"]);
    assert.strictEqual(service.current.activeItemId, "conversation:42");

    service.reconcile(["conversation:12"]);
    assert.strictEqual(service.current.activeItemId, undefined);
    service.dispose();
  });

  test("emits targeted reasons for cursor mutations", () => {
    const service = new ReviewNavigationStateService();
    const reasons: string[] = [];
    const subscription = service.onDidChange((change) => {
      reasons.push(change.reason);
    });

    service.activate("repo", 7);
    service.select("conversation:1");
    service.reconcile([]);
    service.setMode("pending");
    service.clear();

    assert.deepStrictEqual(reasons, [
      "activate",
      "selection",
      "reconcile",
      "mode",
      "clear",
    ]);

    subscription.dispose();
    service.dispose();
  });
});
