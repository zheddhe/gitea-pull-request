import * as assert from "assert";
import { sanitizeLogMessage } from "../../debug/outputChannel";

suite("Logging sanitization", () => {
  test("redacts Authorization token credentials", () => {
    const message = sanitizeLogMessage(
      "[api] Authorization: token super-secret-value request failed",
    );
    assert.ok(!message.includes("super-secret-value"));
    assert.match(message, /Authorization: \[REDACTED\]/i);
  });

  test("redacts bearer credentials", () => {
    const message = sanitizeLogMessage(
      "[auth] bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
    );
    assert.ok(!message.includes("eyJhbGciOiJIUzI1NiJ9"));
    assert.match(message, /token \[REDACTED\]/i);
  });

  test("redacts token query parameters", () => {
    const message = sanitizeLogMessage(
      "[api] https://gitea.example/api?token=secret123&limit=20",
    );
    assert.ok(!message.includes("secret123"));
    assert.match(message, /token=\[REDACTED\]/i);
  });

  test("preserves ordinary diagnostic context", () => {
    const source = "[polling] repo=owner/name unchanged=4 reason=background";
    assert.strictEqual(sanitizeLogMessage(source), source);
  });
});
