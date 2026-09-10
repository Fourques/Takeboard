import { useCallback } from "react";
import type { GenerationContext } from "./generation-context";
import { useGenerationDraft } from "./use-generation-draft";
import { useGenerationEnvironment } from "./use-generation-environment";
import { useGenerationSession } from "./use-generation-session";

/** The workspace supplies document/selection context and receives view data + user intents. */
export function useShotGeneration(context: GenerationContext) {
  const environment = useGenerationEnvironment(context.onError, context.onNotice);
  const draft = useGenerationDraft(context, environment.workflows);
  const session = useGenerationSession(
    context,
    draft,
    environment.comfyEditorUrl,
    environment.workflows,
  );
  const appendPrompt = useCallback(
    (body: string) => {
      draft.editSettings((current) => ({
        ...current,
        prompt: [current.prompt.trim(), body.trim()].filter(Boolean).join("\n\n"),
      }));
    },
    [draft.editSettings],
  );
  return { ...environment, ...draft, ...session, appendPrompt };
}
