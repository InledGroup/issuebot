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

/**
 * Creates a draft issue item on the designated GitHub Project Board
 */
export async function createProjectDraftIssue(
  env: Env,
  org: "pulsar" | "inled",
  title: string,
  body: string,
  type: "Error" | "Idea"
): Promise<{ itemId: string; boardUrl: string; orgName: string; type: string }> {
  const isPulsar = org === "pulsar";
  const projectId = isPulsar ? env.PULSAR_PROJECT_ID : env.INLED_PROJECT_ID;
  const boardUrl = isPulsar ? env.PULSAR_BOARD_URL : env.INLED_BOARD_URL;
  const orgName = isPulsar ? "Inled-Pulsar-OS" : "InledGroup";

  // 1. Crear el draft issue en el Project Board
  const addMutation = `
    mutation($projectId: ID!, $title: String!, $body: String) {
      addProjectV2DraftIssue(input: {
        projectId: $projectId
        title: $title
        body: $body
      }) {
        projectItem {
          id
        }
      }
    }
  `;

  const addData = await callGitHubGraphQL(env.GITHUB_TOKEN, addMutation, {
    projectId,
    title,
    body,
  });

  const itemId = addData.addProjectV2DraftIssue?.projectItem?.id;
  if (!itemId) {
    throw new Error("Could not retrieve created project item ID");
  }

  // 2. Si es Pulsar, asignar el campo 'Tipo' (Error o Idea)
  if (isPulsar && env.PULSAR_TIPO_FIELD_ID) {
    try {
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
    } catch (fieldErr) {
      console.warn("Could not set 'Tipo' field on Pulsar board:", fieldErr);
    }
  }

  return { itemId, boardUrl, orgName, type };
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
