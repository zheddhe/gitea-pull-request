import * as assert from "assert";
import {
  evaluateGiteaServerCapabilities,
  isAtLeastVersion,
} from "../../features/pullRequests/domain/giteaServerCapabilities";

suite("GiteaServerCapabilities", () => {
  test("enables inline review replies from Gitea 1.27.0", () => {
    assert.strictEqual(
      evaluateGiteaServerCapabilities("1.27.0").inlineReviewReplies,
      true,
    );
    assert.strictEqual(
      evaluateGiteaServerCapabilities("1.27.3").inlineReviewReplies,
      true,
    );
  });

  test("keeps inline review replies disabled on older servers", () => {
    assert.strictEqual(
      evaluateGiteaServerCapabilities("1.26.4").inlineReviewReplies,
      false,
    );
    assert.strictEqual(
      evaluateGiteaServerCapabilities("1.24.7").inlineReviewReplies,
      false,
    );
  });

  test("accepts version suffixes and rejects unparseable versions conservatively", () => {
    assert.strictEqual(isAtLeastVersion("1.27.0+gitea-1", [1, 27, 0]), true);
    assert.strictEqual(isAtLeastVersion("1.27.0-dev", [1, 27, 0]), true);
    assert.strictEqual(isAtLeastVersion("unknown", [1, 27, 0]), false);
  });
});
