import {
  applyNodeChanges,
  Background,
  type Connection,
  Controls,
  type Edge,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  CommandAuditEntry,
  ProjectCommand,
  ProjectCommandPreview,
  Shot,
} from "@takeboard/contracts";
import {
  lazy,
  type MouseEvent as ReactMouseEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type CommandResponse,
  demoApi,
  type ProjectCatalogItem,
  projectApi,
  type TrashedProjectItem,
} from "./api";
import { AccountButton, useAuth } from "./auth-ui";
import { type BoardNode, boardNodeTypes } from "./board-nodes";
import { optionalLocalStorage, optionalSessionStorage } from "./browser-storage";
import {
  boardEdges,
  boardNodes,
  type CanvasEdgeIdentity,
  canvasSnapGrid,
  edgeIdentityFromPointer,
  gentlyAlignedPosition,
  resolveSnapshotEdge,
  retainNodeMeasurements,
} from "./canvas-projection";
import { CommandConfirmation } from "./command-confirmation";
import { DeviceIndicator } from "./device-indicator";
import { findWorkflow } from "./generation-model";
import { NumericInput } from "./numeric-input";
import { SettingsButton } from "./settings-center";
import { useCanvasConnection } from "./use-canvas-connection";
import { useEditorSelection } from "./use-editor-selection";
import { useProjectDocument } from "./use-project-document";
import { useShotGeneration } from "./use-shot-generation";
import { VideoThumbnail } from "./video-preview";

const Inspector = lazy(() =>
  import("./workspace-inspector").then((module) => ({ default: module.Inspector })),
);
const NodeContextInspector = lazy(() =>
  import("./workspace-inspector").then((module) => ({ default: module.NodeContextInspector })),
);

const AssetLibrary = lazy(() =>
  import("./asset-library").then((module) => ({ default: module.AssetLibrary })),
);
const CommandHistory = lazy(() =>
  import("./command-history").then((module) => ({ default: module.CommandHistory })),
);
const RecipeStudio = lazy(() =>
  import("./recipe-studio").then((module) => ({ default: module.RecipeStudio })),
);
const Storyboard = lazy(() =>
  import("./storyboard").then((module) => ({ default: module.Storyboard })),
);
const ExtensionLibrary = lazy(() =>
  import("./extension-library").then((module) => ({ default: module.ExtensionLibrary })),
);
const OperationsCenter = lazy(() =>
  import("./operations-center").then((module) => ({ default: module.OperationsCenter })),
);
const ProjectHub = lazy(() =>
  import("./project-hub").then((module) => ({ default: module.ProjectHub })),
);

type CanvasClipboardState = {
  itemId: string;
  mode: "copy" | "cut";
};

type NodeEditDraft = {
  itemId: string;
  kind: "text" | "entity" | "asset" | "shot";
  title: string;
  body: string;
  durationSeconds: number | null;
  aspectRatio: Shot["aspectRatio"] | null;
};

type PendingCanvasRemoval = {
  itemId: string;
  preview: ProjectCommandPreview;
};

export function App() {
  const { user: authUser } = useAuth();
  const {
    document: projectDocument,
    read: readProjectDocument,
    receive: acceptPayload,
    beginNavigation,
    isCurrentNavigation,
    activate: activateDocument,
    editLocalSnapshot,
  } = useProjectDocument();
  const snapshot = projectDocument?.snapshot ?? null;
  const revision = projectDocument?.revision ?? 0;
  const [nodes, setNodes] = useState<BoardNode[]>([]);
  const {
    selection,
    selectedShotId,
    selectedCanvasItemId,
    selectedEdgeId,
    selectedEdgeIdentity,
    canvasContextMenu,
    inspectorOpen,
  } = useEditorSelection(snapshot, readProjectDocument);
  const [canvasGuideOpen, setCanvasGuideOpen] = useState(false);
  const [commandHistoryOpen, setCommandHistoryOpen] = useState(false);
  const [commandHistory, setCommandHistory] = useState<CommandAuditEntry[]>([]);
  const [commandHistoryBusy, setCommandHistoryBusy] = useState(false);
  const [commandHistoryError, setCommandHistoryError] = useState<string | null>(null);
  const [blankCanvasGuideOpen, setBlankCanvasGuideOpen] = useState(false);
  const [canvasClipboard, setCanvasClipboard] = useState<CanvasClipboardState | null>(null);
  const [deletingShotItemId, setDeletingShotItemId] = useState<string | null>(null);
  const [deletingShotPreview, setDeletingShotPreview] = useState<ProjectCommandPreview | null>(
    null,
  );
  const [pendingCanvasRemoval, setPendingCanvasRemoval] = useState<PendingCanvasRemoval | null>(
    null,
  );
  const [pendingCanvasArrange, setPendingCanvasArrange] = useState<
    (ProjectCommandPreview & { command: ProjectCommand }) | null
  >(null);
  const [nodeEditDraft, setNodeEditDraft] = useState<NodeEditDraft | null>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<BoardNode> | null>(null);
  const [actionBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [projectMode, setProjectMode] = useState<"demo" | "project">("project");
  const [projects, setProjects] = useState<ProjectCatalogItem[]>([]);
  const [trashedProjects, setTrashedProjects] = useState<TrashedProjectItem[]>([]);
  const [showHub, setShowHub] = useState(true);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [storyboardOpen, setStoryboardOpen] = useState(false);
  const [extensionLibraryOpen, setExtensionLibraryOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"current" | "updated" | "pending" | "offline">(
    "current",
  );
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1120);
  const [focusMode, setFocusMode] = useState(false);
  const [comfortableDensity, setComfortableDensity] = useState(
    () => optionalLocalStorage.getItem("takeboard.density") !== "compact",
  );
  const [shotQuery, setShotQuery] = useState("");
  const [shotFilter, setShotFilter] = useState<"all" | "todo" | "approved">("all");
  const assetInput = useRef<HTMLInputElement>(null);
  const pendingAssetPosition = useRef<{ x: number; y: number } | null>(null);
  const projectCatalogRequestRef = useRef(0);
  const pendingSyncRef = useRef<NonNullable<Awaited<ReturnType<typeof projectApi.sync>>> | null>(
    null,
  );
  const interactionActiveRef = useRef(false);
  const nodeClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelNodeClick = useCallback(() => {
    if (nodeClickTimer.current !== null) clearTimeout(nodeClickTimer.current);
    nodeClickTimer.current = null;
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: cancel a pending click when leaving this project.
  useEffect(() => cancelNodeClick, [cancelNodeClick, projectKey, showHub]);
  interactionActiveRef.current = Boolean(
    nodeEditDraft ||
      pendingCanvasRemoval ||
      pendingCanvasArrange ||
      deletingShotPreview ||
      renameOpen,
  );
  const activeProjectRole =
    projectMode === "project" && projectKey
      ? (projects.find((project) => project.key === projectKey)?.role ?? "owner")
      : "owner";
  const canEditProject = projectMode === "demo" || activeProjectRole !== "viewer";
  const selectedShot = snapshot?.shots.find((shot) => shot.id === selectedShotId) ?? null;

  const {
    worker,
    workerBusy,
    workflows,
    workflowWarnings,
    comfyEditorUrl,
    refreshWorkflows,
    importWorkflow,
    inventoryBusy,
    generationSettings,
    editSettings,
    selectedWorkflow,
    selectedModelProfile,
    workflowLocked,
    promptMentions,
    selectedInputCounts,
    selectedReferenceImageIds,
    selectedReferenceVideoIds,
    selectedReferenceAudioIds,
    generationDisabledReason,
    candidateCount,
    setCandidateCount,
    bindWorkflow,
    bindingBusy,
    updateSelectedShot,
    activeRun,
    generationBusy,
    generationCancelling,
    canCancelGeneration,
    generationProgress,
    requestShotGeneration,
    retryGenerationRun,
    cancelGeneration,
    detach: detachGeneration,
    appendPrompt,
  } = useShotGeneration({
    snapshot,
    selectedShot,
    projectKey,
    projectMode,
    visible: !showHub,
    canEdit: canEditProject,
    readDocument: readProjectDocument,
    acceptPayload,
    onError: setError,
    onNotice: setNotice,
  });

  const applyPendingSync = useCallback(() => {
    const payload = pendingSyncRef.current;
    if (!payload || !projectKey) return;
    pendingSyncRef.current = null;
    if (acceptPayload(payload)) projectApi.markRevision(projectKey, payload.revision);
    setSyncStatus("updated");
    setNotice("已载入其他设备的更新");
  }, [acceptPayload, projectKey]);

  const refreshCommandHistory = useCallback(async () => {
    if (!projectKey || projectMode !== "project") return;
    setCommandHistoryBusy(true);
    setCommandHistoryError(null);
    try {
      const payload = await projectApi.audit(projectKey);
      setCommandHistory(payload.entries);
    } catch (cause) {
      setCommandHistoryError(cause instanceof Error ? cause.message : "无法读取操作记录");
    } finally {
      setCommandHistoryBusy(false);
    }
  }, [projectKey, projectMode]);

  const openCommandHistory = useCallback(() => {
    setCanvasGuideOpen(false);
    setCommandHistoryOpen(true);
    void refreshCommandHistory();
  }, [refreshCommandHistory]);

  const undoProjectCommand = useCallback(
    async (commandId: string) => {
      if (!projectKey || projectMode !== "project") return;
      setCommandHistoryBusy(true);
      setCommandHistoryError(null);
      try {
        const payload = await projectApi.undo(projectKey, commandId);
        acceptPayload(payload);
        const audit = await projectApi.audit(projectKey);
        setCommandHistory(audit.entries);
        setNotice("操作已撤销");
      } catch (cause) {
        setCommandHistoryError(cause instanceof Error ? cause.message : "撤销失败");
      } finally {
        setCommandHistoryBusy(false);
      }
    },
    [acceptPayload, projectKey, projectMode],
  );

  useEffect(() => {
    let active = true;
    const catalogRequestId = ++projectCatalogRequestRef.current;
    void Promise.allSettled([projectApi.list(), projectApi.trash()]).then(([catalog, trash]) => {
      if (!active) return;
      if (catalog.status === "fulfilled") {
        if (projectCatalogRequestRef.current === catalogRequestId) {
          setProjects(catalog.value.projects);
        }
      } else {
        setError(catalog.reason instanceof Error ? catalog.reason.message : "无法载入项目列表");
      }
      if (trash.status === "fulfilled" && projectCatalogRequestRef.current === catalogRequestId) {
        setTrashedProjects(trash.value.projects);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      showHub ||
      projectMode !== "project" ||
      !projectKey ||
      !readProjectDocument()?.snapshot.project.id
    )
      return;
    let stopped = false;
    let syncing = false;
    let timer = 0;
    const synchronize = async () => {
      if (stopped || syncing) return;
      if (document.visibilityState === "hidden") {
        timer = window.setTimeout(() => void synchronize(), 5_000);
        return;
      }
      syncing = true;
      try {
        const payload = await projectApi.sync(projectKey, readProjectDocument()?.revision ?? 0);
        if (stopped) return;
        if (payload) {
          if (interactionActiveRef.current) {
            pendingSyncRef.current = payload;
            setSyncStatus("pending");
          } else if (acceptPayload(payload)) {
            projectApi.markRevision(projectKey, payload.revision);
            setSyncStatus("updated");
          }
        } else if (!pendingSyncRef.current) {
          setSyncStatus("current");
        }
      } catch {
        if (!stopped) setSyncStatus("offline");
      } finally {
        syncing = false;
        if (!stopped) timer = window.setTimeout(() => void synchronize(), 4_000);
      }
    };
    const syncNow = () => {
      window.clearTimeout(timer);
      void synchronize();
    };
    timer = window.setTimeout(() => void synchronize(), 1_500);
    window.addEventListener("focus", syncNow);
    document.addEventListener("visibilitychange", syncNow);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", syncNow);
      document.removeEventListener("visibilitychange", syncNow);
    };
  }, [acceptPayload, projectKey, projectMode, showHub, readProjectDocument]);

  useEffect(() => {
    const recoverConflict = (event: Event) => {
      if (!projectKey || projectMode !== "project") return;
      const detail = (event as CustomEvent<{ path?: string }>).detail;
      if (!detail?.path?.includes(`/api/projects/${encodeURIComponent(projectKey)}`)) return;
      void projectApi
        .open(projectKey)
        .then((payload) => {
          acceptPayload(payload);
          pendingSyncRef.current = null;
          setSyncStatus("updated");
          setError("项目刚刚在其他设备发生变化；已载入最新版本，请确认后再次执行刚才的操作。");
        })
        .catch(() => setSyncStatus("offline"));
    };
    window.addEventListener("takeboard:revision-conflict", recoverConflict);
    return () => window.removeEventListener("takeboard:revision-conflict", recoverConflict);
  }, [acceptPayload, projectKey, projectMode]);

  useEffect(() => {
    if (showHub || projectMode !== "demo" || !snapshot) return;
    optionalSessionStorage.setItem("takeboard.resumeDemo", "1");
  }, [projectMode, showHub, snapshot]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    optionalLocalStorage.setItem(
      "takeboard.density",
      comfortableDensity ? "comfortable" : "compact",
    );
  }, [comfortableDensity]);

  useEffect(() => {
    const effectiveWidth = () => {
      const scale = Number(document.documentElement.style.getPropertyValue("--ui-scale")) || 1.12;
      return window.innerWidth / scale;
    };
    let narrow = effectiveWidth() <= 1120;
    const adaptWorkspacePanels = () => {
      const nextNarrow = effectiveWidth() <= 1120;
      if (nextNarrow === narrow) return;
      narrow = nextNarrow;
      if (nextNarrow) {
        setSidebarOpen(false);
        selection.inspect(false);
      }
    };
    window.addEventListener("resize", adaptWorkspacePanels);
    window.addEventListener("takeboard:display-scale", adaptWorkspacePanels);
    return () => {
      window.removeEventListener("resize", adaptWorkspacePanels);
      window.removeEventListener("takeboard:display-scale", adaptWorkspacePanels);
    };
  }, [selection.inspect]);

  const edges = useMemo(
    () =>
      snapshot
        ? boardEdges(snapshot, workflows, selectedWorkflow, selectedShotId, selectedEdgeId)
        : [],
    [selectedEdgeId, selectedShotId, selectedWorkflow, snapshot, workflows],
  );
  const selectedCanvasItem =
    snapshot?.canvasItems.find((item) => item.id === selectedCanvasItemId) ?? null;
  const inspectorHasContent = Boolean(selectedCanvasItem || selectedShot);
  const inspectorVisible = !focusMode && inspectorOpen && inspectorHasContent;
  const toggleFocus = useCallback(() => {
    setFocusMode((current) => !current);
    setSidebarOpen(focusMode && window.innerWidth >= 1120);
    selection.inspect(false);
  }, [focusMode, selection.inspect]);
  const selectedTakes = snapshot?.takes.filter((take) => take.shotId === selectedShotId) ?? [];
  const visibleShots = useMemo(() => {
    const normalizedQuery = shotQuery.trim().toLocaleLowerCase("zh-CN");
    const sceneOrder = new Map(snapshot?.scenes.map((scene) => [scene.id, scene.order]) ?? []);
    return (snapshot?.shots ?? [])
      .filter(
        (shot) =>
          `${shot.label} ${shot.intent}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery) &&
          (shotFilter === "all" ||
            (shotFilter === "approved" && shot.status === "approved") ||
            (shotFilter === "todo" && shot.status !== "approved")),
      )
      .sort(
        (left, right) =>
          (sceneOrder.get(left.sceneId) ?? 0) - (sceneOrder.get(right.sceneId) ?? 0) ||
          left.order - right.order ||
          left.id.localeCompare(right.id),
      );
  }, [shotFilter, shotQuery, snapshot?.scenes, snapshot?.shots]);
  const approvedCount = snapshot?.shots.filter((shot) => shot.status === "approved").length ?? 0;
  const totalDuration = snapshot?.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0) ?? 0;
  const activeScene =
    snapshot?.scenes.find((scene) => scene.id === selectedShot?.sceneId) ?? snapshot?.scenes[0];
  const contextEdge = canvasContextMenu?.edge ?? null;
  const deletingShotItem = snapshot?.canvasItems.find(
    (item) => item.id === deletingShotItemId && item.refType === "shot",
  );
  const deletingShot = snapshot?.shots.find((shot) => shot.id === deletingShotItem?.refId);
  const deletingShotRunCount =
    snapshot?.runs.filter((run) => run.shotId === deletingShot?.id).length ?? 0;

  const onNodesChange = useCallback((changes: NodeChange<BoardNode>[]) => {
    setNodes((currentNodes) =>
      applyNodeChanges(
        changes.filter((change) => change.type !== "select"),
        currentNodes,
      ),
    );
  }, []);

  const onNodeClick: NodeMouseHandler<BoardNode> = useCallback(
    (event, node) => {
      if (event.detail > 1) return;
      if (!snapshot) return;
      const item = snapshot.canvasItems.find((candidate) => candidate.id === node.id);
      if (!item) return;
      cancelNodeClick();
      // Opening/closing a panel changes the canvas bounds. Wait briefly so the
      // first click of a double-click cannot move its target out from under it.
      nodeClickTimer.current = setTimeout(() => {
        nodeClickTimer.current = null;
        selection.quick(item.id);
      }, 220);
    },
    [snapshot, selection.quick, cancelNodeClick],
  );

  const openNodeEditor = useCallback(
    (itemId: string) => {
      if (!canEditProject) {
        setNotice("Viewer 权限为只读；可以查看节点，但不能修改内容");
        return;
      }
      if (projectMode !== "project") {
        setNotice("示例画布为只读；新建或打开项目后即可编辑节点");
        return;
      }
      const item = snapshot?.canvasItems.find((candidate) => candidate.id === itemId);
      if (!snapshot || !item) return;
      if (item.refType === "take_stack") {
        setNotice("候选组由运行记录自动管理，可删除画布卡片但不能直接改写");
        return;
      }
      if (item.refType === "text") {
        const text = snapshot.textItems.find((candidate) => candidate.id === item.refId);
        if (text) {
          setNodeEditDraft({
            itemId,
            kind: "text",
            title: text.title,
            body: text.body,
            durationSeconds: null,
            aspectRatio: null,
          });
        }
        return;
      }
      if (item.refType === "entity") {
        const entity = snapshot.entities.find((candidate) => candidate.id === item.refId);
        if (entity) {
          setNodeEditDraft({
            itemId,
            kind: "entity",
            title: entity.name,
            body: entity.description,
            durationSeconds: null,
            aspectRatio: null,
          });
        }
        return;
      }
      if (item.refType === "asset") {
        const asset = snapshot.assets.find((candidate) => candidate.id === item.refId);
        if (asset) {
          setNodeEditDraft({
            itemId,
            kind: "asset",
            title: asset.originalName,
            body: "",
            durationSeconds: null,
            aspectRatio: null,
          });
        }
        return;
      }
      const shot = snapshot.shots.find((candidate) => candidate.id === item.refId);
      if (shot) {
        setNodeEditDraft({
          itemId,
          kind: "shot",
          title: shot.label,
          body: shot.intent,
          durationSeconds: shot.durationSeconds,
          aspectRatio: shot.aspectRatio,
        });
      }
    },
    [canEditProject, projectMode, snapshot],
  );

  const saveNodeEditor = useCallback(async () => {
    if (!projectKey || !nodeEditDraft || !canEditProject) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await projectApi.editCanvasItem(projectKey, nodeEditDraft.itemId, {
        title: nodeEditDraft.title,
        body: nodeEditDraft.body,
        ...(nodeEditDraft.durationSeconds !== null
          ? { durationSeconds: nodeEditDraft.durationSeconds }
          : {}),
        ...(nodeEditDraft.aspectRatio !== null ? { aspectRatio: nodeEditDraft.aspectRatio } : {}),
      });
      acceptPayload(payload);
      setNodeEditDraft(null);
      setNotice("节点内容已更新");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "节点编辑失败");
    } finally {
      setBusy(false);
    }
  }, [acceptPayload, canEditProject, nodeEditDraft, projectKey]);

  const removeCanvasItem = useCallback(
    async (itemId: string, preview: ProjectCommandPreview) => {
      if (!projectKey || projectMode !== "project" || !canEditProject) {
        setNotice("功能示例不会删除节点");
        return;
      }
      const item = snapshot?.canvasItems.find((candidate) => candidate.id === itemId);
      if (!item) return;
      setBusy(true);
      setError(null);
      try {
        const payload = (await projectApi.executeCommand(
          projectKey,
          { type: "canvas.remove_item", itemId },
          preview,
        )) as Awaited<ReturnType<typeof projectApi.deleteCanvasItem>>;
        acceptPayload(payload);
        setCanvasClipboard((current) => (current?.itemId === itemId ? null : current));
        selection.dismissMenu();
        setPendingCanvasRemoval(null);
        setNotice("已从画布移除；底层项目数据与原始文件仍然保留");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "节点删除失败");
      } finally {
        setBusy(false);
      }
    },
    [
      acceptPayload,
      canEditProject,
      projectKey,
      projectMode,
      snapshot?.canvasItems,
      selection.dismissMenu,
    ],
  );

  const previewCanvasArrange = useCallback(async () => {
    if (!projectKey || projectMode !== "project" || !activeScene || !canEditProject) return;
    setBusy(true);
    setError(null);
    try {
      const command: ProjectCommand = {
        type: "canvas.arrange_scene",
        sceneId: activeScene.id,
        nodeSizes: nodes.flatMap((node) =>
          node.measured?.width && node.measured?.height
            ? [{ itemId: node.id, width: node.measured.width, height: node.measured.height }]
            : [],
        ),
      };
      const { preview } = await projectApi.previewCommand(projectKey, command);
      setPendingCanvasArrange({ ...preview, command });
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "当前画布无法自动整理");
    } finally {
      setBusy(false);
    }
  }, [activeScene, canEditProject, projectKey, projectMode, nodes]);

  const confirmCanvasArrange = useCallback(async () => {
    if (
      !projectKey ||
      projectMode !== "project" ||
      !activeScene ||
      !pendingCanvasArrange ||
      !canEditProject
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const payload = await projectApi.executeCommand(
        projectKey,
        pendingCanvasArrange.command,
        pendingCanvasArrange,
      );
      acceptPayload(payload);
      setPendingCanvasArrange(null);
      setNotice("已轻量对齐，可在“记录”中撤销");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "画布整理失败");
    } finally {
      setBusy(false);
    }
  }, [acceptPayload, activeScene, canEditProject, pendingCanvasArrange, projectKey, projectMode]);

  const deleteCanvasItem = useCallback(
    (itemId: string) => {
      if (!canEditProject) return;
      const item = snapshot?.canvasItems.find((candidate) => candidate.id === itemId);
      if (!item) return;
      selection.dismissMenu();
      if (item.refType === "shot") {
        setError(null);
        setDeletingShotPreview(null);
        setDeletingShotItemId(item.id);
        const shot = snapshot?.shots.find((candidate) => candidate.id === item.refId);
        const hasRuns = snapshot?.runs.some((run) => run.shotId === shot?.id);
        if (projectKey && projectMode === "project" && shot && !hasRuns) {
          void projectApi
            .previewCommand(projectKey, { type: "shot.delete", shotId: shot.id })
            .then(({ preview }) => setDeletingShotPreview(preview))
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : "无法预览删除影响"),
            );
        }
        return;
      }
      if (!projectKey || projectMode !== "project") {
        setNotice("功能示例不会删除节点");
        return;
      }
      setBusy(true);
      setError(null);
      void projectApi
        .previewCommand(projectKey, { type: "canvas.remove_item", itemId: item.id })
        .then(({ preview }) => setPendingCanvasRemoval({ itemId: item.id, preview }))
        .catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : "无法预览移除影响"),
        )
        .finally(() => setBusy(false));
    },
    [canEditProject, projectKey, projectMode, snapshot, selection.dismissMenu],
  );

  const confirmDeleteShot = useCallback(async () => {
    if (
      !projectKey ||
      projectMode !== "project" ||
      !deletingShotItem ||
      !deletingShot ||
      !canEditProject
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const payload = (await projectApi.executeCommand(
        projectKey,
        { type: "shot.delete", shotId: deletingShot.id },
        deletingShotPreview ?? undefined,
      )) as Awaited<ReturnType<typeof projectApi.deleteShot>>;
      acceptPayload(payload);
      setCanvasClipboard((current) =>
        current && payload.removedItemIds.includes(current.itemId) ? null : current,
      );
      setDeletingShotItemId(null);
      setDeletingShotPreview(null);
      selection.inspect(false);
      setNotice(`镜头“${deletingShot.label}”已删除，镜头列表与画布已同步`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "镜头删除失败");
    } finally {
      setBusy(false);
    }
  }, [
    acceptPayload,
    canEditProject,
    deletingShot,
    deletingShotItem,
    deletingShotPreview,
    projectKey,
    projectMode,
    selection.inspect,
  ]);

  const deleteCanvasEdge = useCallback(
    async (edgeId: string, requestedIdentity?: CanvasEdgeIdentity) => {
      if (!projectKey || projectMode !== "project" || !snapshot || !canEditProject) return;
      const identity = requestedIdentity ?? selectedEdgeIdentity;
      const edge =
        (identity
          ? snapshot.canvasEdges.find(
              (candidate) =>
                candidate.sourceItemId === identity.sourceItemId &&
                candidate.targetItemId === identity.targetItemId &&
                candidate.targetSlot === identity.targetSlot,
            )
          : null) ?? snapshot.canvasEdges.find((candidate) => candidate.id === edgeId);
      if (edge?.immutable) {
        setNotice("生成溯源连线需要保留，不能删除");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        if (!edge) throw new Error("连线已经不存在，请刷新画布后重试");
        const payload = await projectApi.disconnect(projectKey, edge.id);
        acceptPayload(payload);
        selection.dismissMenu();
        setNotice("连线已删除，输入位置已释放");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "连线删除失败");
      } finally {
        setBusy(false);
      }
    },
    [
      acceptPayload,
      canEditProject,
      projectKey,
      projectMode,
      snapshot,
      selectedEdgeIdentity,
      selection.dismissMenu,
    ],
  );

  const duplicateCanvasItem = useCallback(
    async (itemId: string, position?: { x: number; y: number }) => {
      if (!projectKey || projectMode !== "project" || !canEditProject) {
        setNotice("功能示例不会复制节点");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.duplicateCanvasItem(
          projectKey,
          itemId,
          position?.x,
          position?.y,
        );
        acceptPayload(payload);
        selection.item(payload.itemId);
        selection.dismissMenu();
        setNotice(
          payload.copyMode === "independent"
            ? "已创建可独立编辑的副本；素材文件不会重复占用空间"
            : "已创建引用副本；底层素材文件不会重复占用空间",
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "节点复制失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, canEditProject, projectKey, projectMode, selection.item, selection.dismissMenu],
  );

  const copyCanvasItem = useCallback(
    (itemId: string, mode: "copy" | "cut") => {
      if (!canEditProject) return;
      setCanvasClipboard({ itemId, mode });
      selection.dismissMenu();
      setNotice(mode === "copy" ? "节点已复制，右键空白处粘贴" : "节点已剪切，粘贴前不会移除");
    },
    [canEditProject, selection.dismissMenu],
  );

  const pasteCanvasItem = useCallback(
    async (position?: { x: number; y: number }) => {
      if (
        !canvasClipboard ||
        !snapshot ||
        !projectKey ||
        projectMode !== "project" ||
        !canEditProject
      )
        return;
      const source = snapshot.canvasItems.find((item) => item.id === canvasClipboard.itemId);
      if (!source) {
        setCanvasClipboard(null);
        setError("剪贴板中的节点已经不存在");
        return;
      }
      const target = position ?? { x: source.x + 36, y: source.y + 36 };
      if (canvasClipboard.mode === "copy") {
        await duplicateCanvasItem(source.id, target);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.move(projectKey, source.id, target.x, target.y);
        acceptPayload(payload);
        selection.item(source.id);
        setCanvasClipboard(null);
        selection.dismissMenu();
        setNotice("节点已移动到新的位置");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "节点粘贴失败");
      } finally {
        setBusy(false);
      }
    },
    [
      acceptPayload,
      canEditProject,
      canvasClipboard,
      duplicateCanvasItem,
      projectKey,
      projectMode,
      snapshot,
      selection.item,
      selection.dismissMenu,
    ],
  );

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.key === "Escape") {
        cancelNodeClick();
        const overlayOpen = Boolean(
          canvasContextMenu ||
            canvasGuideOpen ||
            commandHistoryOpen ||
            pendingCanvasRemoval ||
            pendingCanvasArrange ||
            deletingShotItemId ||
            nodeEditDraft ||
            recipeOpen ||
            assetLibraryOpen ||
            storyboardOpen ||
            renameOpen,
        );
        selection.dismissMenu();
        setCanvasGuideOpen(false);
        setCommandHistoryOpen(false);
        setPendingCanvasRemoval(null);
        setPendingCanvasArrange(null);
        setDeletingShotItemId(null);
        setDeletingShotPreview(null);
        setNodeEditDraft(null);
        setRecipeOpen(false);
        setAssetLibraryOpen(false);
        setStoryboardOpen(false);
        setRenameOpen(false);
        if (!overlayOpen) {
          selection.canvas();
        }
        return;
      }
      if (
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "[") {
        setSidebarOpen((current) => !current);
        return;
      }
      if (event.key === "]") {
        if (inspectorHasContent) selection.inspect("toggle");
        return;
      }
      if (event.key === "\\") {
        toggleFocus();
        return;
      }
      const command = event.metaKey || event.ctrlKey;
      if (!canEditProject) return;
      if (command && event.key.toLowerCase() === "c" && selectedCanvasItemId) {
        event.preventDefault();
        copyCanvasItem(selectedCanvasItemId, "copy");
      } else if (command && event.key.toLowerCase() === "x" && selectedCanvasItemId) {
        event.preventDefault();
        copyCanvasItem(selectedCanvasItemId, "cut");
      } else if (command && event.key.toLowerCase() === "v" && canvasClipboard) {
        event.preventDefault();
        void pasteCanvasItem();
      } else if (command && event.key.toLowerCase() === "d" && selectedCanvasItemId) {
        event.preventDefault();
        void duplicateCanvasItem(selectedCanvasItemId);
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedEdgeId) {
        event.preventDefault();
        void deleteCanvasEdge(selectedEdgeId);
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedCanvasItemId) {
        event.preventDefault();
        void deleteCanvasItem(selectedCanvasItemId);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    canvasClipboard,
    canEditProject,
    canvasContextMenu,
    canvasGuideOpen,
    commandHistoryOpen,
    pendingCanvasRemoval,
    pendingCanvasArrange,
    deletingShotItemId,
    copyCanvasItem,
    deleteCanvasEdge,
    deleteCanvasItem,
    duplicateCanvasItem,
    pasteCanvasItem,
    selectedCanvasItemId,
    selectedEdgeId,
    inspectorHasContent,
    nodeEditDraft,
    recipeOpen,
    assetLibraryOpen,
    storyboardOpen,
    renameOpen,
    selection.canvas,
    selection.inspect,
    selection.dismissMenu,
    toggleFocus,
    cancelNodeClick,
  ]);

  const openNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: BoardNode) => {
      event.preventDefault();
      cancelNodeClick();
      if (!canEditProject) return;
      const point = flowInstance?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? {
        x: node.position.x,
        y: node.position.y,
      };
      selection.item(node.id, {
        clientX: event.clientX,
        clientY: event.clientY,
        flowX: point.x,
        flowY: point.y,
      });
    },
    [canEditProject, flowInstance, selection.item, cancelNodeClick],
  );

  const openPaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      event.preventDefault();
      cancelNodeClick();
      if (!canEditProject) return;
      const point = flowInstance?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? {
        x: 180,
        y: 180,
      };
      selection.canvas({
        clientX: event.clientX,
        clientY: event.clientY,
        flowX: point.x,
        flowY: point.y,
      });
    },
    [canEditProject, flowInstance, selection.canvas, cancelNodeClick],
  );

  const openEdgeContextMenu = useCallback(
    (event: ReactMouseEvent, edge: Edge) => {
      event.preventDefault();
      cancelNodeClick();
      const currentSnapshot = readProjectDocument()?.snapshot;
      const snapshotEdge = currentSnapshot ? resolveSnapshotEdge(currentSnapshot, edge) : null;
      const resolvedEdgeId = snapshotEdge?.id ?? edge.id;
      const targetSlot =
        snapshotEdge?.targetSlot ??
        (edge.targetHandle === "first_frame" ||
        edge.targetHandle === "last_frame" ||
        edge.targetHandle === "reference" ||
        edge.targetHandle === "reference_video" ||
        edge.targetHandle === "reference_audio"
          ? edge.targetHandle
          : null);
      const identity =
        edgeIdentityFromPointer(event) ??
        ({
          sourceItemId: snapshotEdge?.sourceItemId ?? edge.source,
          targetItemId: snapshotEdge?.targetItemId ?? edge.target,
          targetSlot,
        } satisfies CanvasEdgeIdentity);
      const point = flowInstance?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? {
        x: 180,
        y: 180,
      };
      selection.edge(resolvedEdgeId, identity, {
        clientX: event.clientX,
        clientY: event.clientY,
        flowX: point.x,
        flowY: point.y,
      });
    },
    [flowInstance, readProjectDocument, selection.edge, cancelNodeClick],
  );

  const applyConnection = useCallback(
    (
      payload: CommandResponse,
      command: Extract<ProjectCommand, { type: "canvas.connect_items" }>,
    ) => {
      if (!acceptPayload(payload)) return;
      const slot = command.targetSlot;
      const targetItem = payload.snapshot.canvasItems.find(
        (item) => item.id === command.targetItemId,
      );
      if (targetItem?.refType === "shot") {
        selection.item(targetItem.id);
      }
      setNotice(
        `已连接为${slot === "first_frame" ? "首帧" : slot === "last_frame" ? "尾帧" : slot === "reference_video" ? "参考视频" : slot === "reference_audio" ? "参考音频" : "参考图"}`,
      );
    },
    [acceptPayload, selection.item],
  );
  const {
    connect: connectCanvasItems,
    pending: pendingConnection,
    busy: connectionBusy,
    confirm: confirmConnection,
    cancel: cancelConnection,
  } = useCanvasConnection({
    projectKey: !showHub && projectMode === "project" && canEditProject ? projectKey : null,
    onApplied: applyConnection,
    onError: setError,
  });
  const busy = actionBusy || connectionBusy || bindingBusy;

  const onConnect = useCallback(
    (connection: Connection) => {
      if (
        !projectKey ||
        projectMode !== "project" ||
        !connection.source ||
        !connection.target ||
        !canEditProject
      ) {
        setNotice("功能示例中的连线不会写入项目");
        return;
      }
      const slot = connection.targetHandle;
      if (
        slot !== "first_frame" &&
        slot !== "last_frame" &&
        slot !== "reference" &&
        slot !== "reference_video" &&
        slot !== "reference_audio"
      ) {
        setError("请连接到镜头的图片、视频或音频输入端口");
        return;
      }
      setError(null);
      void connectCanvasItems(connection.source, connection.target, slot);
    },
    [canEditProject, projectKey, projectMode, connectCanvasItems],
  );

  const connectAssetFromLibrary = useCallback(
    async (
      assetId: string,
      slot: "first" | "last" | "reference" | "referenceVideo" | "referenceAudio",
    ) => {
      if (!projectKey || projectMode !== "project" || !snapshot || !selectedShot || !canEditProject)
        return;
      const target = snapshot.canvasItems.find(
        (item) => item.refType === "shot" && item.refId === selectedShot.id,
      );
      if (!target) return;
      setBusy(true);
      setError(null);
      try {
        let source = snapshot.canvasItems.find(
          (item) =>
            (item.refType === "asset" && item.refId === assetId) ||
            (item.refType === "entity" &&
              snapshot.entities
                .find((entity) => entity.id === item.refId)
                ?.referenceAssetIds.includes(assetId)),
        );
        if (!source) {
          const added = await projectApi.addCanvasItem(projectKey, {
            refType: "asset",
            refId: assetId,
            sceneId: selectedShot.sceneId,
            x: target.x - 300,
            y: target.y + 36,
          });
          acceptPayload(added);
          source = added.snapshot.canvasItems.find((item) => item.id === added.itemId);
        }
        if (!source) throw new Error("素材无法加入当前画布");
        const targetSlot =
          slot === "first"
            ? "first_frame"
            : slot === "last"
              ? "last_frame"
              : slot === "referenceVideo"
                ? "reference_video"
                : slot === "referenceAudio"
                  ? "reference_audio"
                  : "reference";
        await connectCanvasItems(source.id, target.id, targetSlot);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "素材连接失败");
      } finally {
        setBusy(false);
      }
    },
    [
      acceptPayload,
      canEditProject,
      projectKey,
      projectMode,
      selectedShot,
      snapshot,
      connectCanvasItems,
    ],
  );

  const addAssetToCanvasFromLibrary = useCallback(
    async (assetId: string) => {
      if (!projectKey || projectMode !== "project" || !snapshot || !canEditProject) {
        return { ok: false, error: "请先打开一个本地项目" };
      }
      const existing = snapshot.canvasItems.find(
        (item) =>
          (item.refType === "asset" && item.refId === assetId) ||
          (item.refType === "entity" &&
            snapshot.entities
              .find((entity) => entity.id === item.refId)
              ?.referenceAssetIds.includes(assetId)),
      );
      if (existing) {
        selection.item(existing.id);
        setAssetLibraryOpen(false);
        setNotice("素材已经在画布中，已为你定位");
        return { ok: true };
      }
      const target = selectedShot
        ? snapshot.canvasItems.find(
            (item) => item.refType === "shot" && item.refId === selectedShot.id,
          )
        : null;
      const sceneId = selectedShot?.sceneId ?? activeScene?.id ?? snapshot.scenes[0]?.id;
      if (!sceneId) return { ok: false, error: "当前项目还没有可用画布" };
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.addCanvasItem(projectKey, {
          refType: "asset",
          refId: assetId,
          sceneId,
          x: target ? target.x - 320 : 120,
          y: target ? target.y + target.height + 56 : 160,
        });
        acceptPayload(payload);
        selection.item(payload.itemId);
        setAssetLibraryOpen(false);
        setNotice("素材已加入当前画布");
        return { ok: true };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "素材加入画布失败";
        setError(message);
        return { ok: false, error: message };
      } finally {
        setBusy(false);
      }
    },
    [
      acceptPayload,
      activeScene?.id,
      canEditProject,
      projectKey,
      projectMode,
      selectedShot,
      snapshot,
      selection.item,
    ],
  );

  const updateAssetMetadata = useCallback(
    async (
      assetId: string,
      input: {
        title?: string;
        customTags?: string[];
        libraryKind?: "character" | "location" | "prop" | null;
      },
    ) => {
      if (!projectKey || projectMode !== "project" || !canEditProject) {
        return { ok: false, error: "示例项目不会保存资产修改" };
      }
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.updateAsset(projectKey, assetId, input);
        acceptPayload(payload);
        setNotice(
          input.title !== undefined
            ? "素材名称已更新"
            : input.libraryKind !== undefined
              ? "素材分类已更新"
              : "素材标签已更新",
        );
        return { ok: true };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "素材信息保存失败";
        setError(message);
        return { ok: false, error: message };
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, canEditProject, projectKey, projectMode],
  );

  const inspectHistoricalAssetMetadata = useCallback(async () => {
    if (!projectKey || projectMode !== "project" || !canEditProject) {
      return { ok: false, error: "示例项目不会修改资产信息" };
    }
    setBusy(true);
    setError(null);
    try {
      const payload = await projectApi.inspectAssetMetadata(projectKey);
      acceptPayload(payload);
      const warning = payload.warnings.length
        ? `；${payload.warnings.length} 个文件暂时无法识别`
        : "";
      setNotice(`已补全 ${payload.updatedAssetIds.length} 段视频的信息${warning}`);
      return {
        ok: true,
        updated: payload.updatedAssetIds.length,
        warnings: payload.warnings.length,
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "视频信息识别失败";
      setError(message);
      return { ok: false, error: message };
    } finally {
      setBusy(false);
    }
  }, [acceptPayload, canEditProject, projectKey, projectMode]);

  const setAssetCustomTags = useCallback(
    async (assetId: string, customTags: string[]) => {
      if (!canEditProject) return;
      const asset = snapshot?.assets.find((candidate) => candidate.id === assetId);
      if (!asset) return;

      if (projectMode !== "project" || !projectKey) {
        editLocalSnapshot((current) => ({
          ...current,
          assets: current.assets.map((candidate) =>
            candidate.id === assetId ? { ...candidate, customTags } : candidate,
          ),
        }));
        setNotice("自定义标签已更新");
        return;
      }

      await updateAssetMetadata(assetId, { customTags });
    },
    [
      canEditProject,
      projectKey,
      projectMode,
      snapshot?.assets,
      updateAssetMetadata,
      editLocalSnapshot,
    ],
  );

  const openProject = useCallback(
    async (key: string) => {
      const navigationTicket = beginNavigation();
      detachGeneration();
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.open(key);
        if (!activateDocument(payload, navigationTicket)) return;
        selection.activate(payload.snapshot);
        pendingSyncRef.current = null;
        setSyncStatus("current");
        optionalSessionStorage.removeItem("takeboard.resumeDemo");
        setBlankCanvasGuideOpen(false);
        setProjectKey(key);
        setProjectMode("project");
        setShowHub(false);
      } catch (cause) {
        if (isCurrentNavigation(navigationTicket))
          setError(cause instanceof Error ? cause.message : "项目打开失败");
      } finally {
        if (isCurrentNavigation(navigationTicket)) setBusy(false);
      }
    },
    [activateDocument, beginNavigation, isCurrentNavigation, selection.activate, detachGeneration],
  );

  const createProject = useCallback(
    async (input: Parameters<typeof projectApi.create>[0]) => {
      const navigationTicket = beginNavigation();
      const catalogRequestId = ++projectCatalogRequestRef.current;
      detachGeneration();
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.create(input);
        if (!activateDocument(payload, navigationTicket)) return;
        selection.activate(payload.snapshot);
        pendingSyncRef.current = null;
        setSyncStatus("current");
        optionalSessionStorage.removeItem("takeboard.resumeDemo");
        let showFirstGuide = false;
        try {
          showFirstGuide = optionalLocalStorage.getItem("takeboard.blankCanvasGuideSeen") !== "1";
          optionalLocalStorage.setItem("takeboard.blankCanvasGuideSeen", "1");
        } catch {
          // Storage may be unavailable in privacy-restricted browser sessions.
        }
        setBlankCanvasGuideOpen(showFirstGuide);
        setProjectKey(payload.key);
        setProjectMode("project");
        setShowHub(false);
        const catalog = await projectApi.list();
        if (projectCatalogRequestRef.current === catalogRequestId) setProjects(catalog.projects);
      } catch (cause) {
        if (isCurrentNavigation(navigationTicket))
          setError(cause instanceof Error ? cause.message : "项目创建失败");
      } finally {
        if (isCurrentNavigation(navigationTicket)) setBusy(false);
      }
    },
    [activateDocument, beginNavigation, isCurrentNavigation, selection.activate, detachGeneration],
  );

  const importProject = useCallback(async (file: File) => {
    const catalogRequestId = ++projectCatalogRequestRef.current;
    setBusy(true);
    setError(null);
    try {
      const imported = await projectApi.importPackage(file);
      const catalog = await projectApi.list();
      if (projectCatalogRequestRef.current === catalogRequestId) setProjects(catalog.projects);
      setNotice(`“${imported.title}”已完成校验并导入`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "项目包导入失败");
      throw cause;
    } finally {
      setBusy(false);
    }
  }, []);

  const renameProject = useCallback(
    async (key: string, title: string) => {
      const catalogRequestId = ++projectCatalogRequestRef.current;
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.rename(key, title);
        if (projectKey === key) acceptPayload(payload);
        const catalog = await projectApi.list();
        if (projectCatalogRequestRef.current === catalogRequestId) setProjects(catalog.projects);
        setNotice("项目名称已更新");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "项目重命名失败");
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, projectKey],
  );

  const deleteProject = useCallback(
    async (key: string) => {
      const catalogRequestId = ++projectCatalogRequestRef.current;
      setBusy(true);
      setError(null);
      try {
        await projectApi.delete(key);
        if (projectKey === key) setProjectKey(null);
        const catalog = await projectApi.list();
        if (projectCatalogRequestRef.current === catalogRequestId) setProjects(catalog.projects);
        const trash = await projectApi.trash();
        if (projectCatalogRequestRef.current === catalogRequestId) {
          setTrashedProjects(trash.projects);
        }
        setNotice("项目已移到回收区");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "项目删除失败");
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [projectKey],
  );

  const restoreProject = useCallback(async (trashKey: string) => {
    const catalogRequestId = ++projectCatalogRequestRef.current;
    setBusy(true);
    setError(null);
    try {
      const restored = await projectApi.restore(trashKey);
      const [catalog, trash] = await Promise.all([projectApi.list(), projectApi.trash()]);
      if (projectCatalogRequestRef.current === catalogRequestId) {
        setProjects(catalog.projects);
        setTrashedProjects(trash.projects);
      }
      setNotice(`“${restored.title}”已恢复`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "项目恢复失败");
      throw cause;
    } finally {
      setBusy(false);
    }
  }, []);

  const openDemo = useCallback(async () => {
    const navigationTicket = beginNavigation();
    detachGeneration();
    setBusy(true);
    setError(null);
    try {
      const payload = await demoApi.get();
      if (!activateDocument(payload, navigationTicket)) return;
      selection.activate(payload.snapshot);
      pendingSyncRef.current = null;
      setSyncStatus("current");
      setProjectKey(null);
      setProjectMode("demo");
      setShowHub(false);
    } catch (cause) {
      if (isCurrentNavigation(navigationTicket))
        setError(cause instanceof Error ? cause.message : "Demo 打开失败");
    } finally {
      if (isCurrentNavigation(navigationTicket)) setBusy(false);
    }
  }, [
    activateDocument,
    beginNavigation,
    isCurrentNavigation,
    selection.activate,
    detachGeneration,
  ]);

  useEffect(() => {
    if (optionalSessionStorage.getItem("takeboard.resumeDemo") !== "1") return;
    optionalSessionStorage.removeItem("takeboard.resumeDemo");
    void openDemo();
  }, [openDemo]);

  const createShot = useCallback(
    async (position?: { x: number; y: number }) => {
      if (!projectKey || projectMode !== "project" || !canEditProject) return;
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.createShot(projectKey, position);
        setBlankCanvasGuideOpen(false);
        acceptPayload(payload);
        selection.item(payload.itemId);
        setNotice("已添加一个空白镜头；在右侧设置镜头内容与工作流");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "镜头创建失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, canEditProject, projectKey, projectMode, selection.item],
  );

  const createTextNode = useCallback(
    async (position: { x: number; y: number }) => {
      if (!projectKey || projectMode !== "project" || !canEditProject) return;
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.createTextNode(projectKey, {
          title: "新笔记",
          x: position.x,
          y: position.y,
          ...(activeScene ? { sceneId: activeScene.id } : {}),
        });
        acceptPayload(payload);
        selection.item(payload.itemId);
        selection.dismissMenu();
        setNotice("笔记已加入画布；右键可编辑");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "笔记创建失败");
      } finally {
        setBusy(false);
      }
    },
    [
      acceptPayload,
      activeScene,
      canEditProject,
      projectKey,
      projectMode,
      selection.item,
      selection.dismissMenu,
    ],
  );

  const uploadAsset = useCallback(
    async (
      file: File,
      metadata?: {
        kind?: "character" | "location" | "prop";
        name?: string;
        x?: number;
        y?: number;
        addToCanvas?: boolean;
      },
    ) => {
      if (!projectKey) return { ok: false, error: "请先打开一个项目" };
      if (!canEditProject) return { ok: false, error: "Viewer 权限为只读" };
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.uploadAsset(projectKey, file, metadata);
        acceptPayload(payload);
        setNotice(
          metadata?.kind
            ? `已存入${metadata.kind === "character" ? "人物" : metadata.kind === "location" ? "场景" : "道具"}资产：${metadata.name || file.name}`
            : `已导入参考素材：${file.name}`,
        );
        const importedAssetId = payload.snapshot.assets.at(-1)?.id;
        return { ok: true, ...(importedAssetId ? { assetId: importedAssetId } : {}) };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "素材导入失败";
        setError(message);
        return { ok: false, error: message };
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, canEditProject, projectKey],
  );

  const runAction = useCallback(
    async (action: () => ReturnType<typeof demoApi.get>, message: string) => {
      setBusy(true);
      setError(null);
      try {
        const payload = await action();
        acceptPayload(payload);
        setNotice(message);
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "操作失败");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload],
  );

  useEffect(() => {
    if (!snapshot) return;
    const availableWorkflows = [...workflows];
    if (
      selectedWorkflow &&
      !availableWorkflows.some((workflow) => workflow.path === selectedWorkflow.path)
    ) {
      availableWorkflows.push(selectedWorkflow);
    }
    const projectedNodes = boardNodes(
      snapshot,
      selectedCanvasItemId,
      projectMode === "project" ? projectKey : null,
      workflows,
      selectedWorkflow,
      selectedShotId,
      selectedShot && canEditProject && !inspectorVisible
        ? {
            settings: generationSettings,
            workflows: availableWorkflows,
            workflowLocked,
            mentionAliases: promptMentions.map((mention) => mention.alias),
            busy: busy || generationBusy || Boolean(activeRun),
            progress: generationProgress,
            disabledReason:
              projectMode === "project" && selectedWorkflow?.execution === "comfy_only"
                ? "这个工作流需要在 ComfyUI 中运行"
                : generationDisabledReason,
            onWorkflowChange: (path) => {
              const workflow = findWorkflow(path, availableWorkflows);
              if (workflow) void bindWorkflow(workflow);
            },
            onSettingsChange: (input) => editSettings((current) => ({ ...current, ...input })),
            onGenerate: (input) => {
              void requestShotGeneration(selectedShot, input);
            },
            onOpenDetails: () => {
              if (focusMode) setNotice("退出专注后可查看详细设置");
              else selection.inspect(true);
            },
            onCommitTitle: (title) =>
              void updateSelectedShot({
                title,
                body: selectedShot.intent,
                durationSeconds: selectedShot.durationSeconds,
                aspectRatio: selectedShot.aspectRatio,
              }),
          }
        : null,
    );
    setNodes((previous) => retainNodeMeasurements(previous, projectedNodes));
  }, [
    activeRun,
    busy,
    canEditProject,
    generationBusy,
    generationProgress,
    generationSettings,
    projectKey,
    projectMode,
    promptMentions,
    requestShotGeneration,
    selectedCanvasItemId,
    selectedShot,
    selectedShotId,
    selectedWorkflow,
    snapshot,
    updateSelectedShot,
    workflowLocked,
    workflows,
    selection.inspect,
    editSettings,
    generationDisabledReason,
    bindWorkflow,
    inspectorVisible,
    focusMode,
  ]);

  if (showHub) {
    return (
      <Suspense fallback={<main className="loading-screen">正在打开 TakeBoard…</main>}>
        <ProjectHub
          busy={busy}
          error={error}
          notice={notice}
          onCreate={createProject}
          onDelete={deleteProject}
          onImport={importProject}
          onOpen={openProject}
          onRename={renameProject}
          onRestore={restoreProject}
          projects={projects}
          trashedProjects={trashedProjects}
          worker={worker}
          workerBusy={workerBusy}
        />
      </Suspense>
    );
  }

  if (!snapshot) {
    return (
      <main className="loading-screen">
        <div className="loading-mark">T</div>
        <strong>正在打开 TakeBoard Demo</strong>
        <span>{error ?? "读取本地项目与开放快照…"}</span>
      </main>
    );
  }

  return (
    <main
      className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-collapsed"} ${inspectorVisible ? "inspector-open" : "inspector-collapsed"} ${comfortableDensity ? "density-comfortable" : "density-compact"}`}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" title="TakeBoard">
            T
          </span>
          <DeviceIndicator
            projectKey={projectMode === "project" ? (projectKey ?? undefined) : undefined}
          />
        </div>
        <button
          className={`project-heading ${canEditProject ? "" : "read-only"}`}
          type="button"
          title={canEditProject ? "修改项目名称" : "Viewer 权限为只读"}
          onClick={() => {
            if (projectMode !== "project" || !canEditProject) return;
            setRenameTitle(snapshot.project.title);
            setRenameOpen(true);
          }}
        >
          <span className="project-dot" />
          <div>
            <strong>{snapshot.project.title}</strong>
            <span>
              {snapshot.scenes[0]?.title || "工作画板"} ·{" "}
              {projectMode === "demo" ? "功能示例" : "本地优先项目"}
            </span>
          </div>
          {projectMode === "project" && canEditProject ? (
            <span className="project-heading-edit">✎</span>
          ) : null}
        </button>
        <div className="top-actions">
          {!canEditProject ? <span className="read-only-badge">VIEW ONLY</span> : null}
          {syncStatus === "pending" ? (
            <button
              className="save-status"
              type="button"
              onClick={applyPendingSync}
              title="当前编辑完成后，点击载入其他设备的更新"
            >
              ↻ 有新版本 · 当前 r{revision}
            </button>
          ) : (
            <span
              className="save-status"
              title={syncStatus === "offline" ? "暂时无法检查其他设备的更新" : "项目已保存"}
            >
              {syncStatus === "offline"
                ? `○ 同步待重连 · r${revision}`
                : syncStatus === "updated"
                  ? `✓ 已同步 · r${revision}`
                  : `✓ 已保存 · r${revision}`}
            </span>
          )}
          <Suspense fallback={null}>
            <OperationsCenter onOpenProject={openProject} />
          </Suspense>
          <button
            className="density-button"
            type="button"
            onClick={() => setExtensionLibraryOpen(true)}
            title="打开扩展库与项目质检"
          >
            <span aria-hidden="true">◇</span>
            扩展
          </button>
          <SettingsButton />
          <button
            className="density-button"
            type="button"
            onClick={() => setComfortableDensity((current) => !current)}
            title={comfortableDensity ? "切换为紧凑密度" : "切换为舒适密度"}
            aria-label={comfortableDensity ? "切换为紧凑密度" : "切换为舒适密度"}
          >
            <span aria-hidden="true">{comfortableDensity ? "舒" : "紧"}</span>
            {comfortableDensity ? "舒适" : "紧凑"}
          </button>
          <AccountButton
            compact
            projectKey={projectMode === "project" ? (projectKey ?? undefined) : undefined}
            projectTitle={projectMode === "project" ? snapshot.project.title : undefined}
            projectRole={projectMode === "project" ? activeProjectRole : undefined}
          />
          <button
            className="reset-button"
            type="button"
            onClick={() => {
              detachGeneration();
              optionalSessionStorage.removeItem("takeboard.resumeDemo");
              beginNavigation();
              setBusy(false);
              setShowHub(true);
            }}
          >
            切换项目
          </button>
          {projectMode === "demo" ? (
            <button
              className={resetArmed ? "reset-button armed" : "reset-button"}
              type="button"
              onClick={() => {
                if (!resetArmed) {
                  setResetArmed(true);
                  window.setTimeout(() => setResetArmed(false), 3000);
                  return;
                }
                setResetArmed(false);
                void runAction(() => demoApi.reset(), "Demo 已恢复初始状态");
              }}
            >
              {resetArmed ? "确认重置" : "重置 Demo"}
            </button>
          ) : null}
        </div>
      </header>

      <nav className="sidebar" aria-label="项目镜头导航">
        <div className="scene-section">
          <span className="section-kicker">PROJECT</span>
          <div className="project-cover">
            <span className="cover-number">01</span>
            <div>
              <strong>{snapshot.project.title}</strong>
              <span>
                {snapshot.scenes.length} 场 · {totalDuration.toFixed(totalDuration % 1 ? 1 : 0)} 秒
              </span>
            </div>
          </div>
        </div>
        <div className="progress-card">
          <div>
            <span>镜头完成度</span>
            <strong>
              {approvedCount}/{snapshot.shots.length}
            </strong>
          </div>
          <div className="progress-track">
            <span
              style={{
                width: `${snapshot.shots.length ? (approvedCount / snapshot.shots.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
        <div className="shot-list-heading">
          <span className="section-kicker">SHOTS</span>
          <div className="shot-list-heading-actions">
            <span>{snapshot.shots.length}</span>
            <button
              type="button"
              aria-label="打开分镜墙"
              title="打开分镜墙"
              onClick={() => setStoryboardOpen(true)}
            >
              ▦
            </button>
            {projectMode === "project" && canEditProject ? (
              <button
                type="button"
                aria-label="添加镜头"
                title="添加镜头"
                disabled={busy}
                onClick={() => void createShot()}
              >
                ＋
              </button>
            ) : null}
          </div>
        </div>
        <div className="shot-navigator-tools">
          <label>
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={shotQuery}
              onChange={(event) => setShotQuery(event.target.value)}
              placeholder="搜索镜头"
              aria-label="搜索镜头"
            />
          </label>
          <fieldset>
            <legend className="visually-hidden">筛选镜头</legend>
            {(["all", "todo", "approved"] as const).map((filter) => (
              <button
                type="button"
                key={filter}
                className={shotFilter === filter ? "active" : ""}
                onClick={() => setShotFilter(filter)}
              >
                {filter === "all" ? "全部" : filter === "todo" ? "待办" : "完成"}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="shot-list">
          {visibleShots.map((shot) => {
            const shotTakes = snapshot.takes.filter((take) => take.shotId === shot.id);
            const previewTake =
              shotTakes.find((take) => take.id === shot.approvedTakeId) ??
              [...shotTakes].reverse().find((take) => take.status !== "rejected");
            const previewAsset = snapshot.assets.find((asset) => asset.id === previewTake?.assetId);
            const previewUrl =
              projectKey && previewAsset
                ? projectApi.assetUrl(
                    projectKey,
                    previewAsset.id,
                    previewAsset.mediaType === "image",
                  )
                : null;
            return (
              <button
                type="button"
                key={shot.id}
                className={selectedShotId === shot.id ? "active" : ""}
                onClick={() => {
                  selection.shot(shot.id);
                  const shotItem = snapshot.canvasItems.find(
                    (item) => item.refType === "shot" && item.refId === shot.id,
                  );
                  if (shotItem) {
                    selection.item(shotItem.id);
                  } else if (projectMode === "project" && projectKey && canEditProject) {
                    setBusy(true);
                    void projectApi
                      .addCanvasItem(projectKey, {
                        refType: "shot",
                        refId: shot.id,
                        x: 420,
                        y: 120 + shot.order * 240,
                      })
                      .then((payload) => {
                        acceptPayload(payload);
                        selection.item(payload.itemId);
                        setNotice("镜头已恢复到画布");
                      })
                      .catch((cause: unknown) =>
                        setError(cause instanceof Error ? cause.message : "镜头恢复失败"),
                      )
                      .finally(() => setBusy(false));
                  } else {
                    setNotice("这个镜头节点当前不在示例画布中");
                  }
                }}
              >
                <span
                  className={`shot-thumb thumb-${shot.order + 1} ${previewUrl ? "has-media" : ""}`}
                >
                  {previewUrl && previewAsset?.mediaType === "video" ? (
                    <VideoThumbnail src={previewUrl} label={`${shot.label} 缩略图`} />
                  ) : previewUrl ? (
                    <img src={previewUrl} alt="" />
                  ) : (
                    <b>{String(shot.order + 1).padStart(2, "0")}</b>
                  )}
                  {previewUrl && shot.status === "approved" ? (
                    <i className="shot-thumb-approved">✓</i>
                  ) : null}
                </span>
                <span className="shot-list-copy">
                  <strong>{shot.label}</strong>
                  <small>{shotTakes.length > 0 ? `${shotTakes.length} Takes` : "未生成"}</small>
                </span>
                <i className={`status-dot status-${shot.status}`} />
              </button>
            );
          })}
          {visibleShots.length === 0 ? (
            <div className="shot-list-empty">
              <span>{snapshot.shots.length === 0 ? "＋" : "⌕"}</span>
              {snapshot.shots.length === 0 ? "还没有镜头" : "没有匹配的镜头"}
            </div>
          ) : null}
        </div>
        {projectMode === "project" ? (
          <div className="asset-import">
            <input
              ref={assetInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
              onChange={(event) => {
                const file = event.target.files?.[0];
                const position = pendingAssetPosition.current;
                pendingAssetPosition.current = null;
                if (file) void uploadAsset(file, position ?? undefined);
                event.target.value = "";
              }}
            />
            {canEditProject ? (
              <button type="button" disabled={busy} onClick={() => assetInput.current?.click()}>
                ＋ 导入参考素材
              </button>
            ) : null}
            <button
              type="button"
              className="vault-button"
              onClick={() => setAssetLibraryOpen(true)}
            >
              ◇ 打开资产库
            </button>
            <small>
              {
                snapshot.assets.filter((asset) => ["image", "video"].includes(asset.mediaType))
                  .length
              }{" "}
              个素材已入库
            </small>
          </div>
        ) : null}
      </nav>

      <section className="canvas-wrap" aria-label="TakeBoard 创作画布">
        <div className="canvas-toolbar">
          <div>
            <button
              className="panel-toggle"
              type="button"
              onClick={() => setSidebarOpen((current) => !current)}
              title={`${sidebarOpen ? "隐藏" : "显示"}镜头导航（[）`}
              aria-label={`${sidebarOpen ? "隐藏" : "显示"}镜头导航`}
            >
              {sidebarOpen ? "←" : "→"}
            </button>
            <span className="scene-chip">{activeScene?.label ?? "SC-01"}</span>
            <strong>{activeScene?.title || "未命名场景"}</strong>
          </div>
          <div className="canvas-utility">
            {inspectorHasContent && !focusMode ? (
              <button
                className="panel-toggle"
                type="button"
                onClick={() => selection.inspect("toggle")}
                title={`${inspectorVisible ? "隐藏" : "显示"}检查器（]）`}
                aria-label={`${inspectorVisible ? "隐藏" : "显示"}检查器`}
              >
                {inspectorVisible ? "→" : "←"}
              </button>
            ) : null}
            <button
              className="focus-toggle"
              type="button"
              onClick={() => {
                toggleFocus();
              }}
              title="切换专注画布（\\）"
            >
              {focusMode ? "退出专注" : "专注"}
            </button>
            <button
              className={`canvas-guide-toggle ${canvasGuideOpen ? "active" : ""}`}
              type="button"
              aria-label="查看画布操作"
              aria-expanded={canvasGuideOpen}
              onClick={() => setCanvasGuideOpen((current) => !current)}
            >
              ?
            </button>
            {projectMode === "project" && canEditProject ? (
              <button
                className="canvas-arrange-toggle"
                type="button"
                disabled={
                  busy ||
                  (snapshot?.canvasItems.filter((item) => item.sceneId === activeScene?.id)
                    .length ?? 0) < 2
                }
                aria-label="轻量对齐当前画布"
                title="预览后整理节点位置，可撤销"
                onClick={() => void previewCanvasArrange()}
              >
                ⤢ <span>整理</span>
              </button>
            ) : null}
            {projectMode === "project" ? (
              <button
                className={`canvas-history-toggle ${commandHistoryOpen ? "active" : ""}`}
                type="button"
                aria-label="查看项目操作记录"
                aria-expanded={commandHistoryOpen}
                onClick={() => {
                  if (commandHistoryOpen) setCommandHistoryOpen(false);
                  else openCommandHistory();
                }}
              >
                ↶ <span>记录</span>
              </button>
            ) : null}
            {canvasGuideOpen ? (
              <aside className="canvas-guide" aria-label="画布操作说明">
                <header>
                  <div>
                    <span>CANVAS GUIDE</span>
                    <strong>需要时，再看这里。</strong>
                  </div>
                  <button
                    type="button"
                    aria-label="关闭画布操作说明"
                    onClick={() => setCanvasGuideOpen(false)}
                  >
                    ×
                  </button>
                </header>
                <dl>
                  <div>
                    <dt>添加</dt>
                    <dd>双击或右键空白处</dd>
                  </div>
                  <div>
                    <dt>编辑</dt>
                    <dd>单击镜头，再次单击收起；双击查看详情</dd>
                  </div>
                  <div>
                    <dt>连接</dt>
                    <dd>素材或生成结果都可继续连线</dd>
                  </div>
                  <div>
                    <dt>更多</dt>
                    <dd>右键节点或连线</dd>
                  </div>
                </dl>
                <p>复制、粘贴和删除仍支持系统常用快捷键。</p>
              </aside>
            ) : null}
          </div>
        </div>
        {projectMode === "project" &&
        canEditProject &&
        nodes.length === 0 &&
        blankCanvasGuideOpen ? (
          <section className="blank-canvas-start" aria-label="空白工作画板">
            <button
              className="blank-canvas-close"
              type="button"
              aria-label="关闭首次使用提示"
              onClick={() => setBlankCanvasGuideOpen(false)}
            >
              ×
            </button>
            <span className="blank-canvas-index">01 / START</span>
            <h2>从你手里已有的东西开始。</h2>
            <p>可以先放一张参考图，也可以先建立镜头。画幅只属于镜头，不属于整张画布。</p>
            <div>
              <button type="button" disabled={busy} onClick={() => void createShot()}>
                添加第一个镜头
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBlankCanvasGuideOpen(false);
                  assetInput.current?.click();
                }}
              >
                导入参考素材
              </button>
            </div>
          </section>
        ) : null}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={boardNodeTypes as NodeTypes}
          onInit={setFlowInstance}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          nodesDraggable={canEditProject}
          nodesConnectable={canEditProject}
          onNodeClick={onNodeClick}
          onNodeDragStart={cancelNodeClick}
          onEdgeClick={(event, edge) => {
            cancelNodeClick();
            const snapshotEdge = resolveSnapshotEdge(
              readProjectDocument()?.snapshot ?? snapshot,
              edge,
            );
            const identity =
              edgeIdentityFromPointer(event) ??
              ({
                sourceItemId: snapshotEdge?.sourceItemId ?? edge.source,
                targetItemId: snapshotEdge?.targetItemId ?? edge.target,
                targetSlot:
                  snapshotEdge?.targetSlot ??
                  (edge.targetHandle === "first_frame" ||
                  edge.targetHandle === "last_frame" ||
                  edge.targetHandle === "reference" ||
                  edge.targetHandle === "reference_video" ||
                  edge.targetHandle === "reference_audio"
                    ? edge.targetHandle
                    : null),
              } satisfies CanvasEdgeIdentity);
            selection.edge(snapshotEdge?.id ?? edge.id, identity);
            setNotice(
              canEditProject ? "连线已选中 · 按 Delete 删除" : "连线已选中 · Viewer 只读查看",
            );
          }}
          onEdgeContextMenu={openEdgeContextMenu}
          onNodeDoubleClick={(_event, node) => {
            cancelNodeClick();
            const item = snapshot.canvasItems.find((candidate) => candidate.id === node.id);
            if (item?.refType === "shot") {
              if (focusMode) selection.quick(item.id, false);
              else selection.item(item.id);
              return;
            }
            if (item && !focusMode) selection.item(item.id);
          }}
          onNodeContextMenu={openNodeContextMenu}
          onPaneContextMenu={openPaneContextMenu}
          onPaneClick={(event) => {
            cancelNodeClick();
            if (event.detail === 2) {
              openPaneContextMenu(event);
              return;
            }
            selection.dismissMenu();
            setCanvasGuideOpen(false);
            selection.canvas();
            setNodeEditDraft(null);
          }}
          onNodeDragStop={(_event, node) => {
            const position = gentlyAlignedPosition(node, nodes);
            setNodes((current) =>
              current.map((candidate) =>
                candidate.id === node.id ? { ...candidate, position } : candidate,
              ),
            );
            void (
              projectMode === "project" && projectKey
                ? projectApi.move(projectKey, node.id, position.x, position.y)
                : demoApi.move(node.id, position.x, position.y)
            )
              .then((payload) => {
                acceptPayload(payload);
              })
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : "位置保存失败"),
              );
          }}
          minZoom={0.35}
          maxZoom={1.5}
          onlyRenderVisibleElements
          snapToGrid
          snapGrid={canvasSnapGrid}
          defaultViewport={{ x: 60, y: 30, zoom: 0.78 }}
          fitView
          fitViewOptions={{ padding: 0.12, maxZoom: 0.9 }}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={null}
          disableKeyboardA11y
        >
          <Background color="var(--canvas-grid)" gap={28} size={1} />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
        <div className="canvas-status">
          {nodes.length} 节点 · {edges.length} 关系 · 轻量对齐
        </div>
      </section>

      {canvasContextMenu ? (
        <div
          className="canvas-context-menu"
          role="menu"
          style={{
            left: Math.min(canvasContextMenu.clientX, window.innerWidth - 230),
            top: Math.min(canvasContextMenu.clientY, window.innerHeight - 330),
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="canvas-context-menu-head">
            <span>
              {canvasContextMenu.edge
                ? "CONNECTION"
                : canvasContextMenu.itemId
                  ? "NODE ACTIONS"
                  : "ADD TO CANVAS"}
            </span>
            <button type="button" onClick={() => selection.dismissMenu()} aria-label="关闭菜单">
              ×
            </button>
          </div>
          {canvasContextMenu.edge && contextEdge ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  selection.item(contextEdge.sourceItemId);
                  selection.dismissMenu();
                }}
              >
                <span>↖</span>
                <strong>定位来源节点</strong>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  selection.item(contextEdge.targetItemId);
                  selection.dismissMenu();
                }}
              >
                <span>↘</span>
                <strong>定位输入节点</strong>
              </button>
              <div className="context-menu-separator" />
              <button
                type="button"
                role="menuitem"
                className="danger"
                disabled={!canEditProject || contextEdge.immutable}
                onClick={() => void deleteCanvasEdge(contextEdge.id, contextEdge)}
              >
                <span>⌫</span>
                <strong>{contextEdge.immutable ? "生成溯源不可删除" : "断开连接"}</strong>
                <kbd>Delete</kbd>
              </button>
            </>
          ) : canvasContextMenu.itemId ? (
            <>
              {snapshot.canvasItems.find((item) => item.id === canvasContextMenu.itemId)
                ?.refType !== "shot" ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    openNodeEditor(canvasContextMenu.itemId as string);
                    selection.dismissMenu();
                  }}
                >
                  <span>✎</span>
                  <strong>编辑节点</strong>
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={() => copyCanvasItem(canvasContextMenu.itemId as string, "copy")}
              >
                <span>□</span>
                <strong>复制</strong>
                <kbd>⌘ C</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => copyCanvasItem(canvasContextMenu.itemId as string, "cut")}
              >
                <span>✂</span>
                <strong>剪切</strong>
                <kbd>⌘ X</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  void duplicateCanvasItem(canvasContextMenu.itemId as string, {
                    x: canvasContextMenu.flowX + 36,
                    y: canvasContextMenu.flowY + 36,
                  })
                }
              >
                <span>＋</span>
                <strong>创建副本</strong>
                <kbd>⌘ D</kbd>
              </button>
              <div className="context-menu-separator" />
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => deleteCanvasItem(canvasContextMenu.itemId as string)}
              >
                <span>⌫</span>
                <strong>
                  {snapshot.canvasItems.find((item) => item.id === canvasContextMenu.itemId)
                    ?.refType === "shot"
                    ? "删除镜头"
                    : "从画布移除"}
                </strong>
                <kbd>Delete</kbd>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void createShot({ x: canvasContextMenu.flowX, y: canvasContextMenu.flowY });
                  selection.dismissMenu();
                }}
              >
                <span>＋</span>
                <strong>添加生成镜头</strong>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  void createTextNode({ x: canvasContextMenu.flowX, y: canvasContextMenu.flowY })
                }
              >
                <span>文</span>
                <strong>添加文字笔记</strong>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  pendingAssetPosition.current = {
                    x: canvasContextMenu.flowX,
                    y: canvasContextMenu.flowY,
                  };
                  assetInput.current?.click();
                  selection.dismissMenu();
                }}
              >
                <span>◇</span>
                <strong>导入图片或视频</strong>
              </button>
              <div className="context-menu-separator" />
              <button
                type="button"
                role="menuitem"
                disabled={!canvasClipboard}
                onClick={() =>
                  void pasteCanvasItem({
                    x: canvasContextMenu.flowX,
                    y: canvasContextMenu.flowY,
                  })
                }
              >
                <span>▣</span>
                <strong>粘贴节点</strong>
                <kbd>⌘ V</kbd>
              </button>
              <p>
                {canvasClipboard
                  ? canvasClipboard.mode === "cut"
                    ? "把已剪切的节点移动到这里"
                    : "在这里创建节点副本"
                  : "先复制或剪切一个节点"}
              </p>
            </>
          )}
        </div>
      ) : null}

      <Suspense
        fallback={
          <aside className="inspector" role="status">
            正在打开检查器…
          </aside>
        }
      >
        {selectedCanvasItem &&
        selectedCanvasItem.refType !== "shot" &&
        selectedCanvasItem.refType !== "take_stack" ? (
          <NodeContextInspector
            key={selectedCanvasItem.id}
            item={selectedCanvasItem}
            snapshot={snapshot}
            projectKey={projectMode === "project" ? projectKey : null}
            readOnly={!canEditProject}
            selectedShot={selectedShot}
            onOpenAssets={() => setAssetLibraryOpen(true)}
            onUseAsset={(assetId, slot) => {
              void connectAssetFromLibrary(
                assetId,
                slot === "firstFrameAssetId"
                  ? "first"
                  : slot === "lastFrameAssetId"
                    ? "last"
                    : "reference",
              );
            }}
            onSetAssetCustomTags={(assetId, tags) => void setAssetCustomTags(assetId, tags)}
            onClose={() => selection.inspect(false)}
            onUseText={(body) => {
              appendPrompt(body);
              setNotice("文本已追加到当前镜头提示词");
            }}
          />
        ) : selectedShot ? (
          <Inspector
            key={selectedCanvasItem?.id ?? selectedShot.id}
            shot={selectedShot}
            takes={selectedTakes}
            busy={busy || generationBusy || Boolean(activeRun)}
            assets={snapshot.assets}
            projectKey={projectMode === "project" ? projectKey : null}
            isDemo={projectMode === "demo"}
            runs={snapshot.runs}
            settings={generationSettings}
            workflow={selectedWorkflow}
            profile={selectedModelProfile}
            workflowDetected={workflows.some(
              (workflow) => workflow.path === selectedWorkflow?.path,
            )}
            workflowLocked={workflowLocked}
            inputCounts={selectedInputCounts}
            mentions={promptMentions}
            onSettingsChange={editSettings}
            onUpdateShot={(input) => void updateSelectedShot(input)}
            onOpenAssets={() => setAssetLibraryOpen(true)}
            onOpenRecipes={() => setRecipeOpen(true)}
            generateDisabledReason={generationDisabledReason}
            progress={generationProgress}
            candidateCount={candidateCount}
            onCandidateCountChange={setCandidateCount}
            onRetryRun={(run) => void retryGenerationRun(run)}
            readOnly={!canEditProject}
            onClose={() => selection.inspect(false)}
            onGenerate={() => void requestShotGeneration(selectedShot)}
            onCancel={() => void cancelGeneration()}
            canCancel={canCancelGeneration}
            cancelling={generationCancelling}
            onReject={(takeId, reason) =>
              void runAction(
                () =>
                  projectMode === "project" && projectKey
                    ? projectApi.reject(projectKey, takeId, reason)
                    : demoApi.reject(takeId, reason),
                `已淘汰候选 · ${reason}`,
              )
            }
            onApprove={(takeId) => {
              selection.adopted();
              void runAction(
                () =>
                  projectMode === "project" && projectKey
                    ? projectApi.approve(projectKey, takeId, "人工采用")
                    : demoApi.approve(takeId, "Demo 人工采用"),
                `${selectedShot.label} 已采用，决策历史已保存`,
              );
            }}
          />
        ) : null}
      </Suspense>
      <Suspense
        fallback={
          <div className="studio-backdrop studio-loading-backdrop" role="status">
            <span>正在打开工作区工具…</span>
          </div>
        }
      >
        {storyboardOpen ? (
          <Storyboard
            snapshot={snapshot}
            projectKey={projectMode === "project" ? projectKey : null}
            readOnly={!canEditProject || projectMode === "demo"}
            onClose={() => setStoryboardOpen(false)}
            onOpenShot={(shotId) => {
              selection.shot(shotId);
              setStoryboardOpen(false);
            }}
            onReorderShot={async (shotId, toIndex) => {
              if (!projectKey || !canEditProject) return false;
              setError(null);
              try {
                const payload = await projectApi.reorderShot(projectKey, shotId, toIndex);
                acceptPayload(payload);
                setNotice("镜头播放顺序已保存；画布布局保持不变");
                return true;
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "镜头顺序调整失败");
                return false;
              }
            }}
            onSnapshotChange={(payload) => {
              const accepted = acceptPayload(payload);
              if (accepted && projectKey) projectApi.markRevision(projectKey, payload.revision);
            }}
          />
        ) : null}
        {extensionLibraryOpen ? (
          <ExtensionLibrary
            projectKey={projectMode === "project" ? projectKey : null}
            canManage={!authUser || authUser.instanceRole === "admin"}
            onClose={() => setExtensionLibraryOpen(false)}
          />
        ) : null}
        {recipeOpen ? (
          <RecipeStudio
            busy={busy || inventoryBusy}
            canManageWorkflows={!authUser || authUser.instanceRole === "admin"}
            editorUrl={comfyEditorUrl}
            onClose={() => setRecipeOpen(false)}
            onImport={importWorkflow}
            onRefresh={refreshWorkflows}
            onSelect={async (workflow) => {
              if (await bindWorkflow(workflow)) setRecipeOpen(false);
            }}
            open
            selectedPath={generationSettings.recipePath}
            selectionLocked={workflowLocked}
            warnings={workflowWarnings}
            workflows={workflows}
          />
        ) : null}
        {commandHistoryOpen ? (
          <CommandHistory
            busy={commandHistoryBusy}
            entries={commandHistory}
            error={commandHistoryError}
            onClose={() => setCommandHistoryOpen(false)}
            onRefresh={() => void refreshCommandHistory()}
            onUndo={(commandId) => void undoProjectCommand(commandId)}
            open
            readOnly={!canEditProject}
          />
        ) : null}
        {projectKey && assetLibraryOpen ? (
          <AssetLibrary
            assets={snapshot.assets}
            busy={busy}
            canvasItems={snapshot.canvasItems}
            entities={snapshot.entities}
            onAddToCanvas={addAssetToCanvasFromLibrary}
            onClose={() => setAssetLibraryOpen(false)}
            onPickFrame={(assetId, slot) => void connectAssetFromLibrary(assetId, slot)}
            onInspectMetadata={inspectHistoricalAssetMetadata}
            onUpdateAsset={updateAssetMetadata}
            onUpload={async (file, metadata) =>
              await uploadAsset(file, { ...metadata, addToCanvas: false })
            }
            open
            projectKey={projectKey}
            readOnly={!canEditProject}
            selectedShotLabel={selectedShot?.label ?? null}
            selectedFirstFrameId={generationSettings.firstFrameAssetId}
            selectedLastFrameId={generationSettings.lastFrameAssetId}
            selectedReferenceId={generationSettings.referenceAssetId}
            selectedReferenceImageIds={selectedReferenceImageIds}
            selectedReferenceVideoIds={selectedReferenceVideoIds}
            selectedReferenceAudioIds={selectedReferenceAudioIds}
            allowedSlots={{
              first: selectedModelProfile.slots.some((slot) => slot.id === "first_frame"),
              last: selectedModelProfile.slots.some((slot) => slot.id === "last_frame"),
              reference: selectedModelProfile.slots.some((slot) => slot.id === "reference"),
              referenceVideo: selectedModelProfile.slots.some(
                (slot) => slot.id === "reference_video",
              ),
              referenceAudio: selectedModelProfile.slots.some(
                (slot) => slot.id === "reference_audio",
              ),
            }}
          />
        ) : null}
      </Suspense>

      {pendingConnection ? (
        <CommandConfirmation
          preview={pendingConnection.preview}
          busy={connectionBusy}
          onCancel={cancelConnection}
          onConfirm={() => void confirmConnection()}
        />
      ) : null}

      {pendingCanvasRemoval ? (
        <div className="modal-backdrop shot-delete-backdrop">
          <section
            className="shot-delete-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="canvas-remove-title"
          >
            <span className="section-kicker">CANVAS CHANGE</span>
            <h2 id="canvas-remove-title">{pendingCanvasRemoval.preview.summary}？</h2>
            <p>只移除画布上的呈现；资产、人物或文本本体仍保留在项目中。</p>
            <div className="shot-delete-preview">
              <span>影响预览</span>
              <ul>
                {pendingCanvasRemoval.preview.effects.map((item) => (
                  <li key={`${item.action}:${item.entityId ?? item.label}`}>
                    {item.label}
                    {item.detail ? <small>{item.detail}</small> : null}
                  </li>
                ))}
              </ul>
              <small>确认后可以从“记录”撤销；不会静默覆盖后续修改。</small>
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="shot-delete-actions">
              <button type="button" disabled={busy} onClick={() => setPendingCanvasRemoval(null)}>
                取消
              </button>
              <button
                className="confirm-shot-delete"
                type="button"
                disabled={busy}
                onClick={() =>
                  void removeCanvasItem(pendingCanvasRemoval.itemId, pendingCanvasRemoval.preview)
                }
              >
                {busy ? "正在移除…" : "从画布移除"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingCanvasArrange ? (
        <div className="modal-backdrop shot-delete-backdrop">
          <section
            className="shot-delete-modal canvas-arrange-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="canvas-arrange-title"
          >
            <span className="section-kicker">CANVAS ARRANGE</span>
            <h2 id="canvas-arrange-title">整理当前画布？</h2>
            <p>保留现有布局，只对齐相近边缘，并按当前显示尺寸避开重叠。不改变连线或缩放视野。</p>
            <div className="shot-delete-preview">
              <span>位置预览</span>
              <ul>
                {pendingCanvasArrange.effects.slice(0, 8).map((item) => (
                  <li key={item.entityId ?? item.label}>
                    {item.label}
                    {item.detail ? <small>{item.detail}</small> : null}
                  </li>
                ))}
              </ul>
              {pendingCanvasArrange.effects.length > 8 ? (
                <small>以及另外 {pendingCanvasArrange.effects.length - 8} 个节点</small>
              ) : null}
              {pendingCanvasArrange.warnings.map((warning) => (
                <small key={warning}>{warning}</small>
              ))}
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="shot-delete-actions">
              <button type="button" disabled={busy} onClick={() => setPendingCanvasArrange(null)}>
                保持现状
              </button>
              <button type="button" disabled={busy} onClick={() => void confirmCanvasArrange()}>
                {busy ? "正在对齐…" : "应用对齐"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {deletingShotItem && deletingShot ? (
        <div className="modal-backdrop shot-delete-backdrop">
          <section
            className="shot-delete-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="shot-delete-title"
          >
            <span className="section-kicker">SHOT MANAGEMENT</span>
            <h2 id="shot-delete-title">删除“{deletingShot.label}”？</h2>
            {deletingShotRunCount > 0 ? (
              <p>
                这个镜头已有 {deletingShotRunCount}
                条生成记录。为了保留成片、参数和工作流溯源，目前不能直接删除。
              </p>
            ) : (
              <>
                <p>镜头会同时从画布和左侧镜头列表删除；项目里的原始素材不会受到影响。</p>
                {deletingShotPreview ? (
                  <div className="shot-delete-preview">
                    <span>本次操作</span>
                    <ul>
                      {deletingShotPreview.effects.map((item) => (
                        <li key={`${item.action}:${item.entityId ?? item.label}`}>
                          {item.label}
                          {item.detail ? <small>{item.detail}</small> : null}
                        </li>
                      ))}
                    </ul>
                    <small>删除后可在“记录”中撤销；若已有后续修改，系统会停止并提示冲突。</small>
                  </div>
                ) : (
                  <div className="shot-delete-preview loading">正在核对删除范围…</div>
                )}
              </>
            )}
            {error ? <p className="form-error">{error}</p> : null}
            <div className="shot-delete-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDeletingShotItemId(null);
                  setDeletingShotPreview(null);
                }}
              >
                {deletingShotRunCount > 0 ? "知道了" : "取消"}
              </button>
              {deletingShotRunCount === 0 ? (
                <button
                  className="confirm-shot-delete"
                  type="button"
                  disabled={busy || !deletingShotPreview}
                  onClick={() => void confirmDeleteShot()}
                >
                  {busy ? "正在删除…" : "删除镜头"}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {nodeEditDraft && projectKey ? (
        <div className="modal-backdrop node-editor-backdrop">
          <form
            className="node-editor-modal"
            onSubmit={(event) => {
              event.preventDefault();
              void saveNodeEditor();
            }}
          >
            <div className="modal-title">
              <div>
                <span className="section-kicker">EDIT CANVAS NODE</span>
                <h2>
                  编辑
                  {nodeEditDraft.kind === "shot"
                    ? "镜头"
                    : nodeEditDraft.kind === "entity"
                      ? "人物 / 场景"
                      : nodeEditDraft.kind === "text"
                        ? "文本"
                        : "素材"}
                </h2>
              </div>
              <button
                type="button"
                aria-label="关闭节点编辑"
                onClick={() => setNodeEditDraft(null)}
              >
                ×
              </button>
            </div>
            <label>
              <span>{nodeEditDraft.kind === "shot" ? "镜头编号" : "名称"}</span>
              <input
                value={nodeEditDraft.title}
                maxLength={nodeEditDraft.kind === "asset" ? 512 : 200}
                onChange={(event) =>
                  setNodeEditDraft((current) =>
                    current ? { ...current, title: event.target.value } : current,
                  )
                }
              />
            </label>
            {nodeEditDraft.kind !== "asset" ? (
              <label>
                <span>{nodeEditDraft.kind === "shot" ? "镜头意图与动作" : "描述内容"}</span>
                <textarea
                  value={nodeEditDraft.body}
                  onChange={(event) =>
                    setNodeEditDraft((current) =>
                      current ? { ...current, body: event.target.value } : current,
                    )
                  }
                />
              </label>
            ) : (
              <p className="node-editor-note">这里只修改项目中的显示名称，不会改变原始文件内容。</p>
            )}
            {nodeEditDraft.kind === "shot" ? (
              <div className="node-editor-field-row">
                <label>
                  <span>镜头画幅</span>
                  <select
                    value={nodeEditDraft.aspectRatio ?? "16:9"}
                    onChange={(event) =>
                      setNodeEditDraft((current) =>
                        current
                          ? {
                              ...current,
                              aspectRatio: event.target.value as Shot["aspectRatio"],
                            }
                          : current,
                      )
                    }
                  >
                    <option value="16:9">16:9 · 横屏</option>
                    <option value="9:16">9:16 · 竖屏</option>
                    <option value="1:1">1:1 · 方形</option>
                    <option value="4:5">4:5 · 社交媒体</option>
                    <option value="2.35:1">2.35:1 · 宽银幕</option>
                  </select>
                </label>
                <label htmlFor="node-editor-duration">
                  <span>镜头时长（秒）</span>
                  <NumericInput
                    id="node-editor-duration"
                    min={0.5}
                    max={300}
                    step={0.5}
                    value={nodeEditDraft.durationSeconds ?? 5}
                    onValueChange={(durationSeconds) =>
                      setNodeEditDraft((current) =>
                        current ? { ...current, durationSeconds } : current,
                      )
                    }
                  />
                </label>
              </div>
            ) : null}
            <div className="node-editor-actions">
              <button type="button" onClick={() => setNodeEditDraft(null)}>
                取消
              </button>
              <button type="submit" disabled={busy || !nodeEditDraft.title.trim()}>
                {busy ? "保存中…" : "保存修改"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {renameOpen && projectKey ? (
        <div className="modal-backdrop">
          <form
            className="rename-project-modal"
            onSubmit={(event) => {
              event.preventDefault();
              void renameProject(projectKey, renameTitle)
                .then(() => setRenameOpen(false))
                .catch(() => undefined);
            }}
          >
            <div className="modal-title">
              <div>
                <span className="section-kicker">RENAME PROJECT</span>
                <h2>修改项目名称</h2>
              </div>
              <button type="button" aria-label="关闭重命名" onClick={() => setRenameOpen(false)}>
                ×
              </button>
            </div>
            <label>
              新名称
              <input
                required
                maxLength={200}
                value={renameTitle}
                onChange={(event) => setRenameTitle(event.target.value)}
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="modal-actions">
              <span>项目素材和运行记录不会改变</span>
              <button type="submit" disabled={busy || !renameTitle.trim()}>
                {busy ? "正在保存…" : "保存名称"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {notice ? <div className="toast success">✓ {notice}</div> : null}
      {error ? (
        <button className="toast error" type="button" onClick={() => setError(null)}>
          操作失败：{error} · 点击关闭
        </button>
      ) : null}
    </main>
  );
}
