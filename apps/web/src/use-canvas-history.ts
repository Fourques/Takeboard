import { useCallback, useRef } from "react";
import { type DemoPayload, projectApi } from "./api";

export function useCanvasHistory({
  projectKey,
  readDocument,
  acceptPayload,
  onError,
  onNotice,
}: {
  projectKey: string | null;
  readDocument: () => DemoPayload | null;
  acceptPayload: (payload: DemoPayload) => unknown;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const state = useRef({
    key: projectKey,
    busy: false,
    revision: -1,
    redo: [] as string[],
  });
  return useCallback(
    async (direction: "undo" | "redo") => {
      if (!projectKey || state.current.busy) return;
      if (state.current.key !== projectKey)
        state.current = {
          key: projectKey,
          busy: false,
          revision: -1,
          redo: [],
        };
      const history = state.current;
      history.busy = true;
      const projectId = readDocument()?.snapshot.project.id;
      try {
        const audit = await projectApi.audit(projectKey, 200);
        if (readDocument()?.snapshot.project.id !== projectId) return;
        if (history.revision !== audit.revision) history.redo = [];
        const candidate =
          direction === "redo"
            ? history.redo.at(-1)
            : audit.entries.find(
                (entry) =>
                  entry.status === "applied" &&
                  entry.undoable &&
                  entry.commandType !== "command.undo",
              )?.id;
        if (!candidate) {
          onNotice(direction === "redo" ? "没有可重做的操作" : "没有可撤销的操作");
          return;
        }
        const payload = await projectApi.undo(projectKey, candidate);
        history.revision = payload.revision;
        if (direction === "undo") history.redo.push(payload.commandId);
        else {
          history.redo.pop();
        }
        if (readDocument()?.snapshot.project.id !== projectId) return;
        acceptPayload(payload);
        onNotice(direction === "undo" ? "已撤销" : "已重做");
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : "操作未完成，请重试");
      } finally {
        history.busy = false;
      }
    },
    [projectKey, readDocument, acceptPayload, onError, onNotice],
  );
}
