import { Env, ProjectIssueItem } from "./types";

const GITHUB_GRAPHQL = "https://api.github.com/graphql";

export async function callGitHubGraphQL(
  token: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<any> {
  const res = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "IssueBot-Discord-Bridge/1.0",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    const safeText = text.replace(/gh[opars]_[a-zA-Z0-9_]+/g, "[REDACTED]");
    throw new Error(`GitHub API error ${res.status}: ${safeText}`);
  }

  const json = (await res.json()) as { data?: any; errors?: Array<{ message: string }> };
  if (json.errors && json.errors.length > 0) {
    const safeErr = json.errors.map((e) => e.message).join(", ").replace(/gh[opars]_[a-zA-Z0-9_]+/g, "[REDACTED]");
    throw new Error(`GitHub GraphQL error: ${safeErr}`);
  }

  return json.data;
}

const repoIdCache = new Map<string, string>();

/**
 * Resolves repository ID given owner and repo name
 */
export async function getRepositoryId(
  env: Env,
  owner: string,
  repo: string
): Promise<string> {
  const cacheKey = `${owner}/${repo}`.toLowerCase();
  if (repoIdCache.has(cacheKey)) {
    return repoIdCache.get(cacheKey)!;
  }

  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        id
      }
    }
  `;

  const data = await callGitHubGraphQL(env.GITHUB_TOKEN, query, { owner, name: repo });
  const id = data.repository?.id;
  if (!id) {
    throw new Error(`Repository ${owner}/${repo} not found on GitHub`);
  }
  repoIdCache.set(cacheKey, id);
  return id;
}

/**
 * Creates a real GitHub repository issue and links it to the designated GitHub Project Board
 */
export async function createProjectIssue(
  env: Env,
  org: "pulsar" | "inled",
  title: string,
  body: string,
  type: "Error" | "Idea",
  targetRepo?: string
): Promise<{
  itemId?: string;
  issueId: string;
  issueNumber: number;
  issueUrl: string;
  title: string;
  boardUrl: string;
  orgName: string;
  type: string;
}> {
  const isPulsar = org === "pulsar";
  const projectId = isPulsar ? env.PULSAR_PROJECT_ID : env.INLED_PROJECT_ID;
  const boardUrl = isPulsar ? env.PULSAR_BOARD_URL : env.INLED_BOARD_URL;
  const orgName = isPulsar ? "Inled-Pulsar-OS" : "InledGroup";

  const owner = isPulsar ? "Inled-Pulsar-OS" : "InledGroup";
  const repoName = targetRepo || (isPulsar ? "PKG" : "reports");

  // 1. Get Repository GraphQL ID
  const repositoryId = await getRepositoryId(env, owner, repoName);

  // 2. Create the real GitHub issue in the repository
  const createIssueMutation = `
    mutation($repositoryId: ID!, $title: String!, $body: String) {
      createIssue(input: {
        repositoryId: $repositoryId
        title: $title
        body: $body
      }) {
        issue {
          id
          number
          url
          title
        }
      }
    }
  `;

  const issueData = await callGitHubGraphQL(env.GITHUB_TOKEN, createIssueMutation, {
    repositoryId,
    title,
    body,
  });

  const createdIssue = issueData.createIssue?.issue;
  if (!createdIssue?.id) {
    throw new Error("Could not create GitHub issue in repository " + owner + "/" + repoName);
  }

  let itemId: string | undefined = undefined;

  // 3. Add the created issue to the Project Board
  try {
    const addToProjectMutation = `
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: {
          projectId: $projectId
          contentId: $contentId
        }) {
          item {
            id
          }
        }
      }
    `;

    const projectItemData = await callGitHubGraphQL(env.GITHUB_TOKEN, addToProjectMutation, {
      projectId,
      contentId: createdIssue.id,
    });

    itemId = projectItemData.addProjectV2ItemById?.item?.id;

    // 4. Set the 'Tipo' field (Error or Idea) on the Project Board item
    if (isPulsar && env.PULSAR_TIPO_FIELD_ID && itemId) {
      const optionId = type === "Error" ? env.PULSAR_TIPO_ERROR_ID : env.PULSAR_TIPO_IDEA_ID;
      const updateFieldMutation = `
        mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: {
              singleSelectOptionId: $optionId
            }
          }) {
            projectV2Item {
              id
            }
          }
        }
      `;

      await callGitHubGraphQL(env.GITHUB_TOKEN, updateFieldMutation, {
        projectId,
        itemId,
        fieldId: env.PULSAR_TIPO_FIELD_ID,
        optionId,
      });
    }
  } catch (projErr) {
    console.warn("Issue created on repo, but failed linking to project board:", projErr);
  }

  return {
    itemId,
    issueId: createdIssue.id,
    issueNumber: createdIssue.number,
    issueUrl: createdIssue.url,
    title: createdIssue.title,
    boardUrl,
    orgName,
    type,
  };
}

/**
 * Fetches open issues/items from the GitHub Project Board
 */
export async function fetchProjectIssues(
  env: Env,
  org: "pulsar" | "inled",
  filterType?: string
): Promise<{ items: ProjectIssueItem[]; boardUrl: string; orgName: string }> {
  const isPulsar = org === "pulsar";
  const projectId = isPulsar ? env.PULSAR_PROJECT_ID : env.INLED_PROJECT_ID;
  const boardUrl = isPulsar ? env.PULSAR_BOARD_URL : env.INLED_BOARD_URL;
  const orgName = isPulsar ? "Inled-Pulsar-OS" : "InledGroup";

  const items: ProjectIssueItem[] = [];
  let after: string | null = null;
  let pageCount = 0;
  const MAX_PAGES = 3;

  const query = `
    query($projectId: ID!, $after: String) {
      node(id: $projectId) {
        ... on ProjectV2 {
          title
          items(first: 100, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              type
              fieldValues(first: 10) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    field {
                      ... on ProjectV2SingleSelectField {
                        name
                      }
                    }
                    name
                  }
                  ... on ProjectV2ItemFieldTextValue {
                    field {
                      ... on ProjectV2Field {
                        name
                      }
                    }
                    text
                  }
                }
              }
              content {
                __typename
                ... on Issue {
                  title
                  url
                  state
                  number
                }
                ... on DraftIssue {
                  title
                  body
                }
                ... on PullRequest {
                  title
                  url
                  state
                  number
                }
              }
            }
          }
        }
      }
    }
  `;

  while (pageCount < MAX_PAGES) {
    pageCount++;
    const data = await callGitHubGraphQL(env.GITHUB_TOKEN, query, { projectId, after });
    const project = data.node;
    const pageItems = project?.items?.nodes || [];

    for (const node of pageItems) {
      const content = node.content;

      // Extract field values
      let itemType: string | undefined;
      let itemStatus: string | undefined;
      let textTitle: string | undefined;

      if (node.fieldValues?.nodes) {
        for (const fv of node.fieldValues.nodes) {
          if (fv.field?.name === "Tipo") {
            itemType = fv.name;
          } else if (fv.field?.name === "Status") {
            itemStatus = fv.name;
          } else if (fv.field?.name === "Title") {
            textTitle = fv.text;
          }
        }
      }

      // Check if item is closed or completed
      const isContentClosed =
        content &&
        (content.state === "CLOSED" || content.state === "MERGED");
      const isStatusClosed =
        itemStatus === "Completados" ||
        itemStatus === "Done" ||
        itemStatus === "Closed";

      if (isContentClosed || isStatusClosed) {
        continue;
      }

      const title = content?.title || textTitle || "Untitled";

      // If Tipo is not explicitly set, detect [BUG] / [IDEA] / [TASK] in title
      let effectiveType = itemType;
      if (!effectiveType) {
        const upper = title.toUpperCase();
        if (upper.includes("[BUG]") || upper.includes("ERROR")) {
          effectiveType = "Error";
        } else if (upper.includes("[IDEA]") || upper.includes("SUGGESTION")) {
          effectiveType = "Idea";
        } else if (upper.includes("[TASK]") || upper.includes("AYUDA") || upper.includes("HELP")) {
          effectiveType = "Ayuda";
        }
      }

      // If user specified a filterType, match case-insensitively
      if (filterType) {
        if (!effectiveType || effectiveType.toLowerCase() !== filterType.toLowerCase()) {
          continue;
        }
      }

      const url = content && "url" in content && content.url ? content.url : boardUrl;
      const number = content && "number" in content ? content.number : undefined;

      items.push({
        id: node.id,
        title,
        url,
        state: "OPEN",
        type: effectiveType,
        number,
      });
    }

    if (!project?.items?.pageInfo?.hasNextPage) {
      break;
    }
    after = project.items.pageInfo.endCursor;
  }

  return { items, boardUrl, orgName };
}

/**
 * Resolves an issue from project boards by number or falls back to Inled-Pulsar-OS/PKG
 */
export async function findIssueByNumber(
  env: Env,
  issueNum: number
): Promise<{
  item: ProjectIssueItem;
  owner: string;
  repo: string;
  number: number;
  isDraft: boolean;
  org: "pulsar" | "inled";
}> {
  // First search in Pulsar
  const pulsar = await fetchProjectIssues(env, "pulsar");
  const pulsarItem = pulsar.items.find((i) => i.number === issueNum);
  if (pulsarItem && pulsarItem.url) {
    const m = pulsarItem.url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (m) {
      return {
        item: pulsarItem,
        owner: m[1],
        repo: m[2],
        number: parseInt(m[3], 10),
        isDraft: false,
        org: "pulsar",
      };
    }
  }

  // Then search in Inled
  const inled = await fetchProjectIssues(env, "inled");
  const inledItem = inled.items.find((i) => i.number === issueNum);
  if (inledItem && inledItem.url) {
    const m = inledItem.url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (m) {
      return {
        item: inledItem,
        owner: m[1],
        repo: m[2],
        number: parseInt(m[3], 10),
        isDraft: false,
        org: "inled",
      };
    }
  }

  // Fallback to Inled-Pulsar-OS/PKG
  return {
    item: {
      id: "",
      title: `#${issueNum}`,
      number: issueNum,
      url: `https://github.com/Inled-Pulsar-OS/PKG/issues/${issueNum}`,
    },
    owner: "Inled-Pulsar-OS",
    repo: "PKG",
    number: issueNum,
    isDraft: false,
    org: "pulsar",
  };
}

/**
 * Adds a comment to a GitHub issue
 */
export async function addIssueComment(
  env: Env,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
  authorName?: string
): Promise<{ commentUrl: string }> {
  const authorPrefix = authorName ? `**💬 Comment from Discord by @${authorName}:**\n\n` : "";
  const commentBody = `${authorPrefix}${body}`;

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "IssueBot-Discord-Bridge/1.0",
      Accept: "application/vnd.github.v3+json",
    },
    body: JSON.stringify({ body: commentBody }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to add comment on ${owner}/${repo}#${issueNumber}: ${res.status} ${errText}`);
  }

  const json = (await res.json()) as { html_url: string };
  return { commentUrl: json.html_url };
}

/**
 * Closes an issue on GitHub
 */
export async function closeGitHubIssue(
  env: Env,
  owner: string,
  repo: string,
  issueNumber: number,
  reason?: string,
  authorName?: string
): Promise<{ issueUrl: string; title: string }> {
  if (reason) {
    try {
      await addIssueComment(
        env,
        owner,
        repo,
        issueNumber,
        `🔒 **Issue closed via Discord**${authorName ? ` by @${authorName}` : ""}.\n\n*Reason:* ${reason}`
      );
    } catch {
      // Ignorar fallo de comentario previo
    }
  }

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "IssueBot-Discord-Bridge/1.0",
      Accept: "application/vnd.github.v3+json",
    },
    body: JSON.stringify({ state: "closed", state_reason: "completed" }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to close issue ${owner}/${repo}#${issueNumber}: ${res.status} ${errText}`);
  }

  const json = (await res.json()) as { html_url: string; title: string };
  return { issueUrl: json.html_url, title: json.title };
}
