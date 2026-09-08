import * as assert from "assert";
import {
  classifyHttpFailure,
  GiteaApiError,
  sanitizeGiteaErrorDetail,
} from "../../api/giteaApiError";

suite("Gitea API error classification", () => {
  test("classifies authentication and authorization separately", () => {
    assert.strictEqual(classifyHttpFailure(401), "authentication");
    assert.strictEqual(classifyHttpFailure(403), "authorization");
  });

  test("classifies retryable HTTP failures as transient", () => {
    assert.strictEqual(classifyHttpFailure(408), "transient");
    assert.strictEqual(classifyHttpFailure(429), "transient");
    assert.strictEqual(classifyHttpFailure(500), "transient");
    assert.strictEqual(classifyHttpFailure(503), "transient");
  });

  test("keeps endpoint-specific statuses generic", () => {
    assert.strictEqual(classifyHttpFailure(404), "api");
    assert.strictEqual(classifyHttpFailure(405), "api");
    assert.strictEqual(classifyHttpFailure(422), "api");
  });

  test("sanitizes Gitea JSON messages", () => {
    assert.strictEqual(
      sanitizeGiteaErrorDetail('{"message":"permission denied"}'),
      "permission denied",
    );
  });

  test("redacts echoed authorization material", () => {
    const sanitized = sanitizeGiteaErrorDetail(
      "Authorization: token super-secret-value\ntoken another-secret",
    );
    assert.ok(sanitized);
    assert.ok(!sanitized.includes("super-secret-value"));
    assert.ok(!sanitized.includes("another-secret"));
  });

  test("formats authorization diagnostics without credentials", () => {
    const error = new GiteaApiError({
      kind: "authorization",
      serverUrl: "https://gitea.example.com",
      path: "/repos/acme/project/issues",
      status: 403,
      statusText: "Forbidden",
      detail: "insufficient permission",
    });

    assert.strictEqual(error.kind, "authorization");
    assert.strictEqual(error.status, 403);
    assert.match(error.message, /permission denied/i);
    assert.match(error.message, /403 Forbidden/);
    assert.ok(!/authorization:/i.test(error.message));
  });
});
