import type { ProjectSnapshot } from "@takeboard/contracts";
import { useEffect, useMemo, useReducer } from "react";
import type { DemoPayload } from "./api";
import {
  type EdgeIdentity,
  emptySelection,
  type MenuPosition,
  reconcileSelection,
  reduceEditorSelection,
} from "./editor-selection";

export function useEditorSelection(
  snapshot: ProjectSnapshot | null,
  readDocument: () => DemoPayload | null,
) {
  const [stored, dispatch] = useReducer(reduceEditorSelection, emptySelection);
  const state = snapshot ? reconcileSelection(stored, snapshot) : emptySelection;
  useEffect(() => {
    if (snapshot) dispatch({ type: "reconcile", snapshot });
  }, [snapshot]);
  const selection = useMemo(
    () => ({
      activate: (snapshot: ProjectSnapshot) =>
        dispatch({ type: "activate", snapshot, reveal: window.innerWidth >= 1040 }),
      item: (itemId: string, menu?: MenuPosition) => {
        const snapshot = readDocument()?.snapshot;
        if (snapshot) dispatch({ type: "item", snapshot, itemId, ...(menu ? { menu } : {}) });
      },
      shot: (shotId: string) => {
        const snapshot = readDocument()?.snapshot;
        if (snapshot) dispatch({ type: "shot", snapshot, shotId });
      },
      edge: (id: string, identity: EdgeIdentity, menu?: MenuPosition) =>
        dispatch({ type: "edge", id, identity, ...(menu ? { menu } : {}) }),
      canvas: (menu?: MenuPosition) => dispatch({ type: "canvas", ...(menu ? { menu } : {}) }),
      dismissMenu: () => dispatch({ type: "dismiss_menu" }),
      adopted: () => dispatch({ type: "adopted" }),
      inspect: (visible: boolean | "toggle") => dispatch({ type: "inspector", visible }),
    }),
    [readDocument],
  );
  return {
    selection,
    canvasContextMenu: state.menu
      ? {
          ...state.menu,
          itemId: state.target.kind === "item" ? state.target.id : null,
          edge:
            state.target.kind === "edge"
              ? {
                  id: state.target.id,
                  ...state.target.identity,
                  immutable:
                    snapshot?.canvasEdges.find(
                      (edge) => state.target.kind === "edge" && edge.id === state.target.id,
                    )?.immutable ?? false,
                }
              : null,
        }
      : null,
    selectedShotId: state.shotContextId,
    selectedCanvasItemId: state.target.kind === "item" ? state.target.id : null,
    selectedEdgeId: state.target.kind === "edge" ? state.target.id : null,
    selectedEdgeIdentity: state.target.kind === "edge" ? state.target.identity : null,
    inspectorOpen: state.inspectorOpen,
  };
}
