import * as assert from "assert";
import type { PendingReviewSession } from "../../features/pullRequests/domain/pendingReviewSession";
import { PRDetailReviewSyncBridge } from "../../features/pullRequests/services/prDetailReviewSyncBridge";

suite("PR Detail review sync bridge", () => {
  test("posts normalized pending session to the matching PR detail sink", async () => {
    const messages: unknown[] = [];
    const bridge = new PRDetailReviewSyncBridge((repositoryKey, pullRequestNumber) => {
      assert.strictEqual(repositoryKey, "repo-key");
      assert.strictEqual(pullRequestNumber, 12);
      return {
        postMessage: async (message: unknown) => {
          messages.push(message);
          return true;
        },
      };
    });
    const session: PendingReviewSession = {
      inlineComments: [
        {
          id: "inline-1",
          path: "src/a.ts",
          new_position: 8,
          old_position: 0,
          body: "pending",
        },
      ],
      replies: [],
      conversationActions: [],
    };

    const delivered = await bridge.publishPendingSession(
      "repo-key",
      12,
      session,
    );

    assert.strictEqual(delivered, true);
    assert.deepStrictEqual(messages, [
      {
        type: "pendingReviewSessionChanged",
        session,
      },
    ]);
  });

  test("does nothing when the PR detail panel is not open", async () => {
    const bridge = new PRDetailReviewSyncBridge(() => undefined);

    const delivered = await bridge.publishPendingSession("repo-key", 12, {
      inlineComments: [],
      replies: [],
      conversationActions: [],
    });

    assert.strictEqual(delivered, false);
  });
});
