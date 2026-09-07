import * as assert from "assert";
import type { RepoInfo } from "../../context/repoManager";
import {
  CIArtifactItem,
  CIArtifactsGroupItem,
  formatArtifactSize,
} from "../../views/ciRunsProvider";

const repoInfo = {
  serverUrl: "https://gitea.test",
  owner: "o",
  repo: "r",
  rootPath: "/tmp/r",
  label: "o/r",
  key: "https://gitea.test|o/r",
} as RepoInfo;

suite("CI artifact presentation", () => {
  test("formats artifact sizes compactly", () => {
    assert.strictEqual(formatArtifactSize(512), "512 B");
    assert.strictEqual(formatArtifactSize(2048), "2.0 KiB");
    assert.strictEqual(formatArtifactSize(2 * 1024 * 1024), "2.0 MiB");
  });

  test("groups only discovered artifacts", () => {
    const group = new CIArtifactsGroupItem(
      [{ id: 1, name: "coverage", expired: false }],
      7,
      repoInfo,
    );
    assert.strictEqual(group.label, "Artifacts (1)");
  });

  test("available artifact exposes explicit download while expired artifact does not", () => {
    const available = new CIArtifactItem(
      { id: 1, name: "coverage", expired: false, sizeInBytes: 1024 },
      7,
      repoInfo,
    );
    const expired = new CIArtifactItem(
      { id: 2, name: "old-coverage", expired: true },
      7,
      repoInfo,
    );

    assert.strictEqual(available.command?.command, "gitea.downloadArtifact");
    assert.strictEqual(expired.command, undefined);
    assert.strictEqual(expired.contextValue, "ciArtifact_expired");
  });
});
