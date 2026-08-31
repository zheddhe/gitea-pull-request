export interface IssueTemplate {
  id: string;
  name: string;
  about?: string;
  title: string;
  body: string;
  labelNames: string[];
  assigneeNames: string[];
}

export function parseIssueTemplate(path: string, source: string): IssueTemplate {
  const normalized = source.replace(/\r\n/g, "\n");
  const fallbackName = path.split("/").pop()?.replace(/\.md$/i, "") || "Issue template";
  const frontMatter = readFrontMatter(normalized);
  const fields = frontMatter.fields;

  return {
    id: path,
    name: scalar(fields.get("name")) || fallbackName,
    about: scalar(fields.get("about")) || undefined,
    title: scalar(fields.get("title")),
    body: frontMatter.body,
    labelNames: list(fields.get("labels")),
    assigneeNames: list(fields.get("assignees")),
  };
}

function readFrontMatter(source: string): {
  fields: Map<string, string>;
  body: string;
} {
  const fields = new Map<string, string>();
  if (!source.startsWith("---\n")) return { fields, body: source };

  const end = source.indexOf("\n---\n", 4);
  if (end < 0) return { fields, body: source };

  const raw = source.slice(4, end);
  for (const line of raw.split("\n")) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    fields.set(match[1].toLowerCase(), match[2].trim());
  }

  return { fields, body: source.slice(end + 5) };
}

function scalar(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function list(value: string | undefined): string[] {
  if (!value) return [];
  let raw = value.trim();
  if (raw.startsWith("[") && raw.endsWith("]")) raw = raw.slice(1, -1);
  if (!raw) return [];

  return raw
    .split(",")
    .map((item) => scalar(item))
    .map((item) => item.trim())
    .filter(Boolean);
}
