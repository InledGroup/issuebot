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
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { data?: any; errors?: Array<{ message: string }> };
  if (json.errors && json.errors.length > 0) {
    throw new Error(`GitHub GraphQL error: ${json.errors.map((e) => e.message).join(", ")}`);
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
  filterType?: "Error" | "Idea"
): Promise<{ items: ProjectIssueItem[]; boardUrl: string; orgName: string }> {
  const isPulsar = org === "pulsar";
  const projectId = isPulsar ? env.PULSAR_PROJECT_ID : env.INLED_PROJECT_ID;
  const boardUrl = isPulsar ? env.PULSAR_BOARD_URL : env.INLED_BOARD_URL;
  const orgName = isPulsar ? "Inled-Pulsar-OS" : "InledGroup";

  const query = `
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          title
          items(first: 40) {
            nodes {
              id
              type
              fieldValues(first: 8) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    field {
                      ... on ProjectV2SingleSelectField {
                        name
                      }
                    }
                    name
                  }
                }
              }
              content {
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

  const data = await callGitHubGraphQL(env.GITHUB_TOKEN, query, { projectId });
  const rawNodes = data.node?.items?.nodes || [];

  const items: ProjectIssueItem[] = [];

  for (const node of rawNodes) {
    const content = node.content;
    if (!content) continue;

    // Obtener valor del campo 'Tipo' si existe
    let itemType: string | undefined;
    if (node.fieldValues?.nodes) {
      for (const fv of node.fieldValues.nodes) {
        if (fv.field?.name === "Tipo") {
          itemType = fv.name;
          break;
        }
      }
    }

    // Filtrar estado: solo mostrar los abiertos (o draft)
    const isClosed = content.state === "CLOSED" || content.state === "MERGED";
    if (isClosed) continue;

    // Si se especificó filtro de tipo (por ejemplo solo Errores en Pulsar)
    if (filterType && itemType && itemType.toLowerCase() !== filterType.toLowerCase()) {
      continue;
    }

    items.push({
      id: node.id,
      title: content.title || "Untitled",
      url: content.url || boardUrl,
      state: content.state || "OPEN",
      type: itemType,
      number: content.number,
    });
  }

  return { items, boardUrl, orgName };
}
