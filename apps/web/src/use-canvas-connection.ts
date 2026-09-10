import type { ProjectCommand, ProjectCommandPreview } from "@takeboard/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { type CommandResponse, projectApi } from "./api";

type ConnectCommand = Extract<ProjectCommand, { type: "canvas.connect_items" }>;
type PendingConnection = {
  key: string;
  command: ConnectCommand;
  preview: ProjectCommandPreview;
};

/** Both canvas gestures and library actions use the same preview/confirmation boundary. */
export function useCanvasConnection({
  projectKey,
  onApplied,
  onError,
}: {
  projectKey: string | null;
  onApplied: (payload: CommandResponse, command: ConnectCommand) => void;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState<PendingConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const scope = useRef(0);
  const activeKey = useRef(projectKey);
  const inFlight = useRef(false);
  useEffect(() => {
    activeKey.current = projectKey;
    scope.current += 1;
    inFlight.current = false;
    setPending(null);
    setBusy(false);
    return () => {
      activeKey.current = null;
      scope.current += 1;
    };
  }, [projectKey]);

  const run = useCallback(
    async (command: ConnectCommand, approved?: PendingConnection) => {
      if (
        !projectKey ||
        activeKey.current !== projectKey ||
        inFlight.current ||
        (approved && approved.key !== projectKey)
      )
        return;
      const ticket = scope.current;
      inFlight.current = true;
      setBusy(true);
      try {
        const preview =
          approved?.preview ?? (await projectApi.previewCommand(projectKey, command)).preview;
        if (ticket !== scope.current) return;
        if (preview.requiresConfirmation && !approved) {
          setPending({ key: projectKey, command, preview });
          return;
        }
        const result = await projectApi.executeCommand(projectKey, command, preview);
        if (ticket !== scope.current) return;
        setPending(null);
        onApplied(result, command);
      } catch (cause) {
        if (ticket === scope.current) {
          // A revision conflict must be previewed again, never silently approved with a new token.
          setPending(null);
          onError(cause instanceof Error ? cause.message : "连线保存失败");
        }
      } finally {
        if (ticket === scope.current) {
          inFlight.current = false;
          setBusy(false);
        }
      }
    },
    [projectKey, onApplied, onError],
  );

  const connect = useCallback(
    (sourceItemId: string, targetItemId: string, targetSlot: ConnectCommand["targetSlot"]) =>
      run({ type: "canvas.connect_items", sourceItemId, targetItemId, targetSlot }),
    [run],
  );

  return {
    pending: pending?.key === projectKey ? pending : null,
    busy,
    connect,
    confirm: () => (pending ? run(pending.command, pending) : Promise.resolve()),
    cancel: () => {
      if (!inFlight.current) setPending(null);
    },
  };
}
