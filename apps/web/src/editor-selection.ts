import type { ProjectSnapshot } from "@takeboard/contracts";

export type EdgeIdentity = Pick<
  ProjectSnapshot["canvasEdges"][number],
  "sourceItemId" | "targetItemId" | "targetSlot"
>;
export type MenuPosition = { clientX: number; clientY: number; flowX: number; flowY: number };
export type EditorSelection = {
  projectId: string | null;
  target:
    | { kind: "canvas" }
    | { kind: "item"; id: string }
    | { kind: "edge"; id: string; identity: EdgeIdentity };
  shotContextId: string | null;
  inspectorOpen: boolean;
  menu: MenuPosition | null;
};
export const emptySelection: EditorSelection = {
  projectId: null,
  target: { kind: "canvas" },
  shotContextId: null,
  inspectorOpen: false,
  menu: null,
};
export type SelectionAction =
  | { type: "activate"; snapshot: ProjectSnapshot; reveal: boolean }
  | { type: "reconcile"; snapshot: ProjectSnapshot }
  | { type: "item"; snapshot: ProjectSnapshot; itemId: string; menu?: MenuPosition }
  | { type: "shot"; snapshot: ProjectSnapshot; shotId: string }
  | { type: "edge"; id: string; identity: EdgeIdentity; menu?: MenuPosition }
  | { type: "canvas"; menu?: MenuPosition }
  | { type: "dismiss_menu" }
  | { type: "adopted" }
  | { type: "inspector"; visible: boolean | "toggle" };

export function reconcileSelection(
  state: EditorSelection,
  snapshot: ProjectSnapshot,
): EditorSelection {
  if (state.projectId !== snapshot.project.id)
    return { ...emptySelection, projectId: snapshot.project.id };
  const shotContextId = snapshot.shots.some((shot) => shot.id === state.shotContextId)
    ? state.shotContextId
    : null;
  if (
    (state.target.kind === "item" &&
      !snapshot.canvasItems.some(
        (item) => state.target.kind === "item" && item.id === state.target.id,
      )) ||
    (state.target.kind === "edge" &&
      !snapshot.canvasEdges.some(
        (edge) => state.target.kind === "edge" && edge.id === state.target.id,
      ))
  ) {
    return { ...emptySelection, projectId: snapshot.project.id };
  }
  return shotContextId === state.shotContextId
    ? state
    : {
        ...state,
        shotContextId,
        inspectorOpen: state.target.kind === "item" && state.inspectorOpen,
      };
}

/** Each user intent changes target, shot context and panel visibility atomically. */
export function reduceEditorSelection(
  state: EditorSelection,
  action: SelectionAction,
): EditorSelection {
  switch (action.type) {
    case "activate": {
      const base = { ...emptySelection, projectId: action.snapshot.project.id };
      const shot = action.snapshot.shots[0];
      const next = shot
        ? reduceEditorSelection(base, { type: "shot", snapshot: action.snapshot, shotId: shot.id })
        : base;
      return { ...next, inspectorOpen: action.reveal && Boolean(shot) };
    }
    case "reconcile": {
      return reconcileSelection(state, action.snapshot);
    }
    case "item": {
      const next = reconcileSelection(state, action.snapshot);
      const item = action.snapshot.canvasItems.find((item) => item.id === action.itemId);
      if (!item) return next;
      return {
        ...next,
        target: { kind: "item", id: item.id },
        menu: action.menu ?? null,
        inspectorOpen: true,
        shotContextId:
          item.refType === "shot" || item.refType === "take_stack"
            ? item.refId
            : next.shotContextId,
      };
    }
    case "shot": {
      if (!action.snapshot.shots.some((shot) => shot.id === action.shotId))
        return reconcileSelection(state, action.snapshot);
      const item = action.snapshot.canvasItems.find(
        (item) => item.refType === "shot" && item.refId === action.shotId,
      );
      return {
        projectId: action.snapshot.project.id,
        target: item ? { kind: "item", id: item.id } : { kind: "canvas" },
        shotContextId: action.shotId,
        inspectorOpen: true,
        menu: null,
      };
    }
    case "edge":
      return {
        ...state,
        target: { kind: "edge", id: action.id, identity: action.identity },
        menu: action.menu ?? null,
        shotContextId: null,
        inspectorOpen: false,
      };
    case "canvas":
      return { ...emptySelection, projectId: state.projectId, menu: action.menu ?? null };
    case "dismiss_menu":
      return state.menu ? { ...state, menu: null } : state;
    case "adopted":
      return { ...state, target: { kind: "canvas" } };
    case "inspector":
      return {
        ...state,
        inspectorOpen: action.visible === "toggle" ? !state.inspectorOpen : action.visible,
      };
  }
}
