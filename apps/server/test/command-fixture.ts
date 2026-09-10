import { randomUUID } from "node:crypto";
import type { ProjectCommand } from "@takeboard/contracts";
import type { FastifyInstance } from "fastify";

/** Explicit test-user action through the same preview/execute API as the UI. */
export async function executeTestCommand(
  app: FastifyInstance,
  key: string,
  command: ProjectCommand,
  options: { confirm?: boolean } = {},
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${key}/commands/preview`,
    payload: { command },
  });
  if (response.statusCode !== 200) return response;
  const { preview } = response.json();
  return app.inject({
    method: "POST",
    url: `/api/projects/${key}/commands`,
    payload: {
      command,
      requestId: `test:${randomUUID()}`,
      expectedRevision: preview.currentRevision,
      ...(options.confirm ? { confirmationToken: preview.confirmationToken ?? undefined } : {}),
    },
  });
}
