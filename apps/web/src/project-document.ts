import type { DemoPayload } from "./api";

/** A response may advance the active document, never silently switch projects. */
export function nextProjectDocument(
  current: DemoPayload | null,
  incoming: DemoPayload,
  activate = false,
): DemoPayload | null {
  if (!current) return activate ? incoming : null;
  if (current.snapshot.project.id !== incoming.snapshot.project.id)
    return activate ? incoming : current;
  return incoming.revision > current.revision ? incoming : current;
}
