import type { GiteaLabel, GiteaMilestone, GiteaUser } from "../../../api/types";
import type { RepoInfo } from "../../../context/repoManager";
import type { IssueTemplate } from "./issueTemplate";

export interface CreateIssueDraft {
  repoInfo: RepoInfo;
  title: string;
  body: string;
  assignees: GiteaUser[];
  labels: GiteaLabel[];
  milestone?: GiteaMilestone;
  templates: IssueTemplate[];
  template?: IssueTemplate;
  defaultBranch?: string;
}

export function reconcileTemplateRefresh(
  draft: CreateIssueDraft,
  templates: IssueTemplate[],
  defaultBranch?: string,
): CreateIssueDraft {
  const selectedTemplate = draft.template
    ? templates.find((template) => template.id === draft.template?.id)
    : undefined;

  return {
    ...draft,
    templates,
    defaultBranch,
    template: selectedTemplate,
  };
}

export function switchDraftRepository(
  draft: CreateIssueDraft,
  repoInfo: RepoInfo,
  templates: IssueTemplate[],
  defaultBranch?: string,
): CreateIssueDraft {
  return {
    ...draft,
    repoInfo,
    templates,
    defaultBranch,
    template: undefined,
    assignees: [],
    labels: [],
    milestone: undefined,
  };
}

export function applyTemplateSeed(
  draft: CreateIssueDraft,
  template: IssueTemplate,
  assignees: GiteaUser[],
  labels: GiteaLabel[],
): CreateIssueDraft {
  return {
    ...draft,
    template,
    title: template.title,
    body: template.body,
    assignees,
    labels,
  };
}

export function clearTemplateSelection(draft: CreateIssueDraft): CreateIssueDraft {
  return { ...draft, template: undefined };
}
