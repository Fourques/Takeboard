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
      items: (itemIds: string[], menu?: MenuPosition) => {
        const snapshot = readDocument()?.snapshot;
        if (snapshot) dispatch({ type: "items", snapshot, itemIds, ...(menu ? { menu } : {}) });
      },
      activate: (snapshot: ProjectSnapshot) =>
        dispatch({ type: "activate", snapshot, reveal: false }),
      quick: (itemId: string, toggle = true) => {
        const snapshot = readDocument()?.snapshot;
        if (snapshot) dispatch({ type: "quick", snapshot, itemId, toggle });
      },
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
  const selectedCanvasItemIds = useMemo(
    () =>
      state.target.kind === "items"
        ? state.target.ids
        : state.target.kind === "item"
          ? [state.target.id]
          : [],
    [state.target],
  );
  return {
    selection,
    canvasContextMenu: state.menu
      ? {
          ...state.menu,
          itemId:
            state.target.kind === "item"
              ? state.target.id
              : state.target.kind === "items"
                ? state.target.ids[0]
                : null,
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
    selectedCanvasItemIds,
    selectedEdgeId: state.target.kind === "edge" ? state.target.id : null,
    selectedEdgeIdentity: state.target.kind === "edge" ? state.target.identity : null,
    inspectorOpen: state.inspectorOpen,
  };
}
