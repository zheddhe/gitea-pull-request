import * as assert from "assert";
import {
  IssueCreationSessionService,
  type IssueContextKeySetter,
} from "../../features/issues/services/issueCreationSessionService";

suite("IssueCreationSessionService", () => {
  function fixture() {
    const values = new Map<string, unknown>();
    const setter: IssueContextKeySetter = async (key, value) => {
      values.set(key, value);
    };
    const service = new IssueCreationSessionService(setter);
    return { service, values };
  }

  test("initializes idle context keys", async () => {
    const { service, values } = fixture();
    await service.initialize();

    assert.deepStrictEqual(service.current, { kind: "idle" });
    assert.strictEqual(values.get("gitea.issueCreation.active"), false);
    assert.strictEqual(values.get("gitea.issueCreation.repositoryKey"), undefined);

    service.dispose();
  });

  test("transitions from idle to creating and back", async () => {
    const { service, values } = fixture();
    const repository = {
      key: "https://gitea.example.test/owner/repo",
      owner: "owner",
      name: "repo",
      fullName: "owner/repo",
    };

    await service.start(repository);
    assert.deepStrictEqual(service.current, { kind: "creating", repository });
    assert.strictEqual(values.get("gitea.issueCreation.active"), true);
    assert.strictEqual(
      values.get("gitea.issueCreation.repositoryKey"),
      repository.key,
    );

    await service.clear();
    assert.deepStrictEqual(service.current, { kind: "idle" });
    assert.strictEqual(values.get("gitea.issueCreation.active"), false);
    assert.strictEqual(values.get("gitea.issueCreation.repositoryKey"), undefined);

    service.dispose();
  });

  test("keeps creation active while repository remains available", async () => {
    const { service } = fixture();
    const repository = {
      key: "repo-key",
      owner: "owner",
      name: "repo",
      fullName: "owner/repo",
    };
    await service.start(repository);

    const invalidated = await service.invalidateIfRepositoryUnavailable([
      "another-repo",
      "repo-key",
    ]);

    assert.strictEqual(invalidated, false);
    assert.strictEqual(service.current.kind, "creating");
    service.dispose();
  });

  test("clears creation when repository disappears", async () => {
    const { service } = fixture();
    await service.start({
      key: "repo-key",
      owner: "owner",
      name: "repo",
      fullName: "owner/repo",
    });

    const invalidated = await service.invalidateIfRepositoryUnavailable([
      "another-repo",
    ]);

    assert.strictEqual(invalidated, true);
    assert.deepStrictEqual(service.current, { kind: "idle" });
    service.dispose();
  });
});
