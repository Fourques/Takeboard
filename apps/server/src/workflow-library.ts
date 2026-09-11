import { type WorkflowLibraryEntry, workflowLibrarySchema } from "@takeboard/contracts";

// Presentation preferences only: never move workflow files or grant execution trust.
export { workflowLibrarySchema };

function metadataUrl(endpoint: string, path: string) {
  return `${endpoint}/api/userdata/${encodeURIComponent(`takeboard/library/${Buffer.from(path).toString("base64url")}.json`)}`;
}

export async function readWorkflowLibraryEntry(
  endpoint: string,
  path: string,
): Promise<WorkflowLibraryEntry> {
  const response = await fetch(metadataUrl(endpoint, path), { signal: AbortSignal.timeout(5000) });
  if (response.status === 404) return {};
  if (!response.ok) throw new Error(`工作流列表偏好读取失败 (${response.status})`);
  return workflowLibrarySchema.parse(await response.json());
}

export async function writeWorkflowLibraryEntry(
  endpoint: string,
  path: string,
  entry: WorkflowLibraryEntry,
) {
  const response = await fetch(metadataUrl(endpoint, path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(workflowLibrarySchema.parse(entry)),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`工作流列表偏好保存失败 (${response.status})`);
}

// Serialize partial updates within this instance; never overwrite other fields
// with a stale read from a concurrent rename/favorite request.
const updates = new Map<string, Promise<WorkflowLibraryEntry>>();
export async function updateWorkflowLibraryEntry(
  endpoint: string,
  path: string,
  patch: WorkflowLibraryEntry,
) {
  const key = metadataUrl(endpoint, path);
  const previous = updates.get(key);
  const pending = (async () => {
    await previous?.catch(() => undefined);
    const entry = { ...(await readWorkflowLibraryEntry(endpoint, path)), ...patch };
    await writeWorkflowLibraryEntry(endpoint, path, entry);
    return entry;
  })();
  updates.set(key, pending);
  try {
    return await pending;
  } finally {
    if (updates.get(key) === pending) updates.delete(key);
  }
}
