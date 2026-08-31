import * as assert from "assert";
import type { GiteaLabel, GiteaMilestone, GiteaUser } from "../../api/types";
import type { RepoInfo } from "../../context/repoManager";
import {
  applyTemplateSeed,
  clearTemplateSelection,
  type CreateIssueDraft,
  reconcileTemplateRefresh,
  switchDraftRepository,
} from "../../features/issues/domain/createIssueDraft";
import type { IssueTemplate } from "../../features/issues/domain/issueTemplate";

suite("Create Issue draft reconciliation", () => {
  const repo = (key: string): RepoInfo => ({
    serverUrl: "https://gitea.example.test",
    owner: "acme",
    repo: key,
    rootPath: `/work/${key}`,
    label: `acme/${key}`,
    key: `https://gitea.example.test|acme/${key}`,
  });
  const user = (login: string) => ({ id: login.length, login } as GiteaUser);
  const label = (id: number, name: string) => ({ id, name, color: "ffffff" } as GiteaLabel);
  const milestone = { id: 7, title: "M1" } as GiteaMilestone;
  const template = (id: string, title: string, body: string): IssueTemplate => ({
    id,
    name: id,
    title,
    body,
    labelNames: [],
    assigneeNames: [],
  });

  const draft = (): CreateIssueDraft => ({
    repoInfo: repo("one"),
    title: "User title",
    body: "User body",
    assignees: [user("alice")],
    labels: [label(1, "bug")],
    milestone,
    templates: [template("bug.md", "[BUG] ", "Bug body")],
    template: template("bug.md", "[BUG] ", "Bug body"),
    defaultBranch: "main",
  });

  test("technical refresh never overwrites authored fields or metadata", () => {
    const previous = draft();
    const refreshedTemplate = template("bug.md", "[UPDATED] ", "Updated body");
    const next = reconcileTemplateRefresh(previous, [refreshedTemplate], "trunk");

    assert.strictEqual(next.title, "User title");
    assert.strictEqual(next.body, "User body");
    assert.deepStrictEqual(next.assignees, previous.assignees);
    assert.deepStrictEqual(next.labels, previous.labels);
    assert.strictEqual(next.milestone, milestone);
    assert.strictEqual(next.template, refreshedTemplate);
    assert.strictEqual(next.defaultBranch, "trunk");
  });

  test("refresh removes only the selected-template reference when it disappears", () => {
    const previous = draft();
    const next = reconcileTemplateRefresh(previous, [], "main");

    assert.strictEqual(next.template, undefined);
    assert.strictEqual(next.title, "User title");
    assert.strictEqual(next.body, "User body");
    assert.deepStrictEqual(next.assignees, previous.assignees);
    assert.deepStrictEqual(next.labels, previous.labels);
  });

  test("explicit template selection applies a new seed and resolved template metadata", () => {
    const previous = draft();
    const selected = template("feature.md", "[FEATURE] ", "Feature body");
    const assignees = [user("bob")];
    const labels = [label(2, "enhancement")];
    const next = applyTemplateSeed(previous, selected, assignees, labels);

    assert.strictEqual(next.template, selected);
    assert.strictEqual(next.title, "[FEATURE] ");
    assert.strictEqual(next.body, "Feature body");
    assert.deepStrictEqual(next.assignees, assignees);
    assert.deepStrictEqual(next.labels, labels);
    assert.strictEqual(next.milestone, milestone);
  });

  test("repository switch preserves portable author input and resets repository-bound state", () => {
    const previous = draft();
    const nextRepo = repo("two");
    const templates = [template("support.md", "", "Support body")];
    const next = switchDraftRepository(previous, nextRepo, templates, "develop");

    assert.strictEqual(next.repoInfo, nextRepo);
    assert.strictEqual(next.title, "User title");
    assert.strictEqual(next.body, "User body");
    assert.deepStrictEqual(next.assignees, []);
    assert.deepStrictEqual(next.labels, []);
    assert.strictEqual(next.milestone, undefined);
    assert.strictEqual(next.template, undefined);
    assert.deepStrictEqual(next.templates, templates);
    assert.strictEqual(next.defaultBranch, "develop");
  });

  test("choosing Blank issue clears only the template binding", () => {
    const previous = draft();
    const next = clearTemplateSelection(previous);

    assert.strictEqual(next.template, undefined);
    assert.strictEqual(next.title, previous.title);
    assert.strictEqual(next.body, previous.body);
    assert.deepStrictEqual(next.assignees, previous.assignees);
    assert.deepStrictEqual(next.labels, previous.labels);
    assert.strictEqual(next.milestone, milestone);
  });
});
