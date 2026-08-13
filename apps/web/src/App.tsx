import {
  applyNodeChanges,
  Background,
  Controls,
  type Edge,
  MarkerType,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Asset, ProjectSnapshot, Run, Shot, Take } from "@takeboard/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  demoApi,
  type ProjectCatalogItem,
  projectApi,
  type WorkerStatus,
  type WorkflowSummary,
  workflowApi,
} from "./api";
import { AssetLibrary } from "./asset-library";
import { type BoardNode, boardNodeTypes } from "./board-nodes";
import { ProjectHub } from "./project-hub";
import { RecipeStudio } from "./recipe-studio";
import { ThemeSwitcher } from "./theme-switcher";

const rejectionReasons = ["角色漂移", "运动方向错误", "构图不稳定", "细节异常"];

type GenerationSettings = {
  recipePath: string;
  prompt: string;
  negativePrompt: string;
  firstFrameAssetId: string | null;
  lastFrameAssetId: string | null;
  width: number;
  height: number;
  durationSeconds: number;
  fps: number;
  seed: number;
};

const defaultGenerationSettings: GenerationSettings = {
  recipePath: "Kino/Kino_Wan22_I2V.json",
  prompt: "",
  negativePrompt: "",
  firstFrameAssetId: null,
  lastFrameAssetId: null,
  width: 480,
  height: 848,
  durationSeconds: 5,
  fps: 16,
  seed: 26081301,
};

const nativeWorkflowFallbacks: WorkflowSummary[] = [
  {
    id: "native-wan22-i2v",
    path: "Kino/Kino_Wan22_I2V.json",
    name: "Wan22 I2V",
    capability: "image_to_video",
    capabilityLabel: "图生视频",
    inputs: ["prompt", "negative_prompt", "first_frame", "resolution", "duration", "fps", "seed"],
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-wan22-flf2v",
    path: "Kino/Kino_Wan22_FLF2V.json",
    name: "Wan22 FLF2V",
    capability: "first_last_video",
    capabilityLabel: "首尾帧视频",
    inputs: [
      "prompt",
      "negative_prompt",
      "first_frame",
      "last_frame",
      "resolution",
      "duration",
      "fps",
      "seed",
    ],
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
];

function shortId(value: string) {
  return value.slice(-6).toUpperCase();
}

function boardNodes(
  snapshot: ProjectSnapshot,
  selectedShotId: string | null,
  projectKey: string | null,
  engine: string,
): BoardNode[] {
  return snapshot.canvasItems.map((item): BoardNode => {
    const common = {
      id: item.id,
      position: { x: item.x, y: item.y },
      style: { width: item.width },
      type: item.refType,
      selected: false,
    };
    if (item.refType === "text") {
      const text = snapshot.textItems.find((candidate) => candidate.id === item.refId);
      return {
        ...common,
        data: {
          kind: "text",
          eyebrow: text?.kind === "script" ? "SCRIPT" : "NOTE",
          title: text?.title ?? "文字",
          body: text?.body ?? "",
        },
      };
    }
    if (item.refType === "entity") {
      const entity = snapshot.entities.find((candidate) => candidate.id === item.refId);
      const referenceAsset = snapshot.assets.find((asset) =>
        entity?.referenceAssetIds.includes(asset.id),
      );
      return {
        ...common,
        data: {
          kind: "entity",
          eyebrow:
            entity?.kind === "character"
              ? "CHARACTER"
              : entity?.kind === "location"
                ? "LOCATION"
                : "PROP",
          title: entity?.name ?? "角色",
          body: entity?.description ?? "",
          mediaUrl:
            projectKey && referenceAsset
              ? projectApi.assetUrl(projectKey, referenceAsset.id)
              : undefined,
        },
      };
    }
    if (item.refType === "asset") {
      const asset = snapshot.assets.find((candidate) => candidate.id === item.refId);
      return {
        ...common,
        data: {
          kind: "asset",
          eyebrow: "LOCATION",
          title: asset?.originalName.includes("ferry")
            ? "雾港旧渡口"
            : (asset?.originalName ?? "素材"),
          body: "",
          mediaUrl: projectKey && asset ? projectApi.assetUrl(projectKey, asset.id) : undefined,
        },
      };
    }

    const shot = snapshot.shots.find((candidate) => candidate.id === item.refId);
    const takes = snapshot.takes.filter((take) => take.shotId === item.refId);
    if (item.refType === "take_stack") {
      return {
        ...common,
        data: {
          kind: "take_stack",
          eyebrow: "TAKE STACK",
          title: shot?.label ?? "镜头",
          body: "",
          status: shot?.status,
          takeCount: takes.length,
          rejectedCount: takes.filter((take) => take.status === "rejected").length,
          selected: selectedShotId === item.refId,
        },
      };
    }
    return {
      ...common,
      data: {
        kind: "shot",
        eyebrow: "SHOT",
        title: shot?.label ?? "镜头",
        body: shot?.intent ?? "",
        status: shot?.status,
        duration: shot?.durationSeconds,
        takeCount: takes.length,
        engine,
        selected: selectedShotId === item.refId,
      },
    };
  });
}

function boardEdges(snapshot: ProjectSnapshot): Edge[] {
  return snapshot.canvasEdges.map((edge) => ({
    id: edge.id,
    source: edge.sourceItemId,
    target: edge.targetItemId,
    type: "smoothstep",
    animated: edge.relation === "generated_from",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#66716e", width: 16, height: 16 },
    style: {
      stroke: edge.relation === "generated_from" ? "#d6a95f" : "#58635f",
      strokeWidth: edge.relation === "generated_from" ? 2 : 1.25,
    },
  }));
}

function CandidateArt({
  index,
  approved,
  source,
}: {
  index: number;
  approved: boolean;
  source: string | undefined;
}) {
  return (
    <div className={`candidate-art candidate-${index + 1}`}>
      {source ? (
        <video
          src={source}
          muted
          loop
          playsInline
          onMouseEnter={(event) => void event.currentTarget.play()}
          onMouseLeave={(event) => {
            event.currentTarget.pause();
            event.currentTarget.currentTime = 0;
          }}
        />
      ) : (
        <>
          <span className="candidate-fog fog-a" />
          <span className="candidate-fog fog-b" />
          <span className="candidate-person" />
          <span className="candidate-pier" />
        </>
      )}
      {approved ? <span className="candidate-approved">✓ 已批准</span> : null}
      <span className="candidate-play">▶</span>
    </div>
  );
}

type InspectorProps = {
  shot: Shot;
  takes: Take[];
  busy: boolean;
  onGenerate: () => void;
  onReject: (takeId: string, reason: string) => void;
  onApprove: (takeId: string) => void;
  workerLabel: string;
  assets: Asset[];
  projectKey: string | null;
  isDemo: boolean;
  runs: Run[];
  settings: GenerationSettings;
  workflow: WorkflowSummary | null;
  onSettingsChange: (settings: GenerationSettings) => void;
  onOpenAssets: () => void;
  onOpenRecipes: () => void;
  generateDisabledReason: string | null;
};

function Inspector({
  shot,
  takes,
  busy,
  onGenerate,
  onReject,
  onApprove,
  workerLabel,
  assets,
  projectKey,
  isDemo,
  runs,
  settings,
  workflow,
  onSettingsChange,
  onOpenAssets,
  onOpenRecipes,
  generateDisabledReason,
}: InspectorProps) {
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null);
  const [reason, setReason] = useState(rejectionReasons[0] ?? "角色漂移");
  useEffect(() => {
    const approved = takes.find((take) => take.status === "approved");
    const candidate = takes.find((take) => take.status === "candidate");
    setSelectedTakeId(approved?.id ?? candidate?.id ?? takes[0]?.id ?? null);
  }, [takes]);
  const selectedTake = takes.find((take) => take.id === selectedTakeId);
  const mediaSource = (assetId: string) => {
    const asset = assets.find((candidate) => candidate.id === assetId);
    return projectKey && asset ? projectApi.assetUrl(projectKey, asset.id) : undefined;
  };

  return (
    <aside className="inspector" aria-label="镜头候选检查器">
      <div className="inspector-heading">
        <div>
          <span className="section-kicker">SHOT INSPECTOR</span>
          <h2>{shot.label}</h2>
        </div>
        <span className={`large-status status-${shot.status}`}>
          {shot.status === "approved"
            ? "已批准"
            : shot.status === "review"
              ? "待选择"
              : shot.status === "generating"
                ? "生成中"
                : "待生成"}
        </span>
      </div>
      <p className="shot-intent">{shot.intent}</p>
      <div className="shot-facts">
        <span>{shot.durationSeconds}s</span>
        <span>{shot.aspectRatio}</span>
        <span>{workerLabel}</span>
      </div>

      {!isDemo ? (
        <section className="generation-console">
          <button className="recipe-selector" type="button" onClick={onOpenRecipes}>
            <span className="recipe-selector-icon">⌘</span>
            <span>
              <small>RECIPE</small>
              <strong>{workflow?.name ?? "选择工作流"}</strong>
            </span>
            <i>{workflow?.capabilityLabel ?? "自动检测"}⌄</i>
          </button>
          <label className="prompt-field">
            <span>
              镜头提示词 <small>{settings.prompt.length}/20000</small>
            </span>
            <textarea
              value={settings.prompt}
              onChange={(event) => onSettingsChange({ ...settings, prompt: event.target.value })}
              placeholder="描述主体、动作、镜头运动、光线与声音…"
            />
          </label>
          {workflow?.inputs.includes("negative_prompt") ? (
            <label className="negative-field">
              <span>负面提示词</span>
              <input
                value={settings.negativePrompt}
                onChange={(event) =>
                  onSettingsChange({ ...settings, negativePrompt: event.target.value })
                }
                placeholder="不希望出现的内容"
              />
            </label>
          ) : null}
          <div className="frame-slots">
            {workflow?.inputs.some(
              (input) => input === "first_frame" || input === "reference_images",
            ) ? (
              <button
                type="button"
                className={settings.firstFrameAssetId ? "filled" : ""}
                onClick={onOpenAssets}
              >
                <span>{settings.firstFrameAssetId ? "✓" : "+"}</span>
                <div>
                  <small>INPUT</small>
                  <strong>
                    {workflow.capability === "reference_video" ? "参考素材" : "起始帧"}
                  </strong>
                </div>
              </button>
            ) : null}
            {workflow?.inputs.includes("last_frame") ? (
              <button
                type="button"
                className={settings.lastFrameAssetId ? "filled" : ""}
                onClick={onOpenAssets}
              >
                <span>{settings.lastFrameAssetId ? "✓" : "+"}</span>
                <div>
                  <small>END</small>
                  <strong>结束帧</strong>
                </div>
              </button>
            ) : null}
          </div>
          <div className="parameter-grid">
            <label>
              <span>宽度</span>
              <input
                type="number"
                min={256}
                max={2048}
                step={32}
                value={settings.width}
                onChange={(event) =>
                  onSettingsChange({ ...settings, width: Number(event.target.value) })
                }
              />
            </label>
            <label>
              <span>高度</span>
              <input
                type="number"
                min={256}
                max={2048}
                step={32}
                value={settings.height}
                onChange={(event) =>
                  onSettingsChange({ ...settings, height: Number(event.target.value) })
                }
              />
            </label>
            <label>
              <span>时长</span>
              <div>
                <input
                  type="number"
                  min={1}
                  max={15}
                  step={0.5}
                  value={settings.durationSeconds}
                  onChange={(event) =>
                    onSettingsChange({ ...settings, durationSeconds: Number(event.target.value) })
                  }
                />
                <i>s</i>
              </div>
            </label>
            <label>
              <span>帧率</span>
              <div>
                <input
                  type="number"
                  min={8}
                  max={60}
                  value={settings.fps}
                  onChange={(event) =>
                    onSettingsChange({ ...settings, fps: Number(event.target.value) })
                  }
                />
                <i>fps</i>
              </div>
            </label>
          </div>
          <label className="seed-field">
            <span>Seed</span>
            <input
              type="number"
              min={0}
              value={settings.seed}
              onChange={(event) =>
                onSettingsChange({ ...settings, seed: Number(event.target.value) })
              }
            />
            <button
              type="button"
              onClick={() =>
                onSettingsChange({ ...settings, seed: Math.floor(Math.random() * 2_147_483_647) })
              }
            >
              随机
            </button>
          </label>
          {workflow?.execution === "comfy_only" ? (
            <div className="comfy-only-note">
              这个 JSON 已完成检测；当前通过 ComfyUI 运行和修改，映射为原生 Recipe
              后即可在此直接排队。
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="candidate-title-row">
        <div>
          <h3>候选 Takes</h3>
          <p>{takes.length > 0 ? `${takes.length} 个结果 · 点击比较` : "先生成一组可选择的结果"}</p>
        </div>
        <button
          className="generate-button"
          type="button"
          onClick={onGenerate}
          disabled={busy || !!generateDisabledReason}
          title={generateDisabledReason ?? undefined}
        >
          {busy ? <span className="spinner" /> : <span>✦</span>}
          {busy
            ? "生成中…"
            : isDemo
              ? takes.length > 0
                ? "再抽 4 个"
                : "生成 4 个"
              : workflow?.execution === "comfy_only"
                ? "在 ComfyUI 中打开"
                : takes.length > 0
                  ? "再生成 1 个"
                  : "生成视频"}
        </button>
      </div>

      {!isDemo && generateDisabledReason ? (
        <div className="generation-validation">{generateDisabledReason}</div>
      ) : null}

      {takes.length === 0 ? (
        <div className="empty-candidates">
          <div className="empty-orbit">
            <span />
            <span />
            <span />
          </div>
          <strong>这个镜头还没有 Take</strong>
          <p>
            {isDemo
              ? "Demo 会模拟 4 次独立运行，并保留 seed、来源和选择历史。"
              : workflow?.execution === "comfy_only"
                ? "TakeBoard 已识别输入槽位；点击后进入 ComfyUI 调整和运行完整节点图。"
                : `将使用已选择的素材运行 ${workflow?.name ?? "当前 Recipe"}，并保存 seed、来源和参数快照。`}
          </p>
          <button type="button" onClick={onGenerate} disabled={busy || !!generateDisabledReason}>
            {workflow?.execution === "comfy_only" ? "进入 ComfyUI" : "开始生成"}
          </button>
        </div>
      ) : (
        <>
          <div className="candidate-grid">
            {takes.map((take, index) => (
              <button
                className={`candidate-card ${selectedTakeId === take.id ? "selected" : ""} status-${take.status}`}
                key={take.id}
                type="button"
                onClick={() => setSelectedTakeId(take.id)}
                aria-label={`选择候选 ${index + 1}`}
              >
                <CandidateArt
                  index={index % 4}
                  approved={take.status === "approved"}
                  source={mediaSource(take.assetId)}
                />
                <div className="candidate-meta">
                  <span>TAKE {String(index + 1).padStart(2, "0")}</span>
                  <span className={`take-state state-${take.status}`}>
                    {take.status === "approved"
                      ? "APPROVED"
                      : take.status === "rejected"
                        ? "REJECTED"
                        : "CANDIDATE"}
                  </span>
                </div>
                <div className="candidate-seed">
                  seed · {String(runs.find((run) => run.id === take.runId)?.parameters.seed ?? "—")}
                </div>
              </button>
            ))}
          </div>
          {selectedTake ? (
            <div className="decision-panel">
              <div className="decision-id">
                <span>当前选择</span>
                <strong>{shortId(selectedTake.id)}</strong>
              </div>
              <select
                aria-label="淘汰原因"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={selectedTake.status === "approved"}
              >
                {rejectionReasons.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <button
                className="reject-button"
                type="button"
                disabled={busy || selectedTake.status === "approved"}
                onClick={() => onReject(selectedTake.id, reason)}
              >
                淘汰
              </button>
              <button
                className="approve-button"
                type="button"
                disabled={busy || selectedTake.status === "approved"}
                onClick={() => onApprove(selectedTake.id)}
              >
                ✓ 批准此 Take
              </button>
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [revision, setRevision] = useState(0);
  const [nodes, setNodes] = useState<BoardNode[]>([]);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [projectMode, setProjectMode] = useState<"demo" | "project">("project");
  const [projects, setProjects] = useState<ProjectCatalogItem[]>([]);
  const [showHub, setShowHub] = useState(true);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflowWarnings, setWorkflowWarnings] = useState<string[]>([]);
  const [comfyEditorUrl, setComfyEditorUrl] = useState("http://127.0.0.1:48188");
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [generationSettings, setGenerationSettings] =
    useState<GenerationSettings>(defaultGenerationSettings);
  const [generationBusy, setGenerationBusy] = useState(false);
  const assetInput = useRef<HTMLInputElement>(null);
  const generationScopeRef = useRef("");
  const generationTokenRef = useRef(0);

  const acceptPayload = useCallback(
    (payload: Awaited<ReturnType<typeof demoApi.get>>, preferredShotId?: string) => {
      setSnapshot(payload.snapshot);
      setRevision(payload.revision);
      setSelectedShotId((current) =>
        payload.snapshot.shots.some((shot) => shot.id === (preferredShotId ?? current))
          ? (preferredShotId ?? current)
          : (payload.snapshot.shots[0]?.id ?? null),
      );
    },
    [],
  );

  useEffect(() => {
    void Promise.allSettled([projectApi.list(), projectApi.worker(), workflowApi.list()]).then(
      ([catalog, status, detected]) => {
        if (catalog.status === "fulfilled") setProjects(catalog.value.projects);
        else
          setError(catalog.reason instanceof Error ? catalog.reason.message : "无法载入项目列表");
        if (status.status === "fulfilled") setWorker(status.value);
        else setWorker({ status: "offline", engine: "ComfyUI" });
        if (detected.status === "fulfilled") {
          setWorkflows(detected.value.workflows);
          setWorkflowWarnings(detected.value.warnings ?? []);
          setComfyEditorUrl(detected.value.editorUrl);
        }
      },
    );
  }, []);

  useEffect(() => {
    if (showHub || projectMode !== "demo" || !snapshot) return;
    window.sessionStorage.setItem("takeboard.resumeDemo", "1");
  }, [projectMode, showHub, snapshot]);

  useEffect(() => {
    if (snapshot) {
      setNodes(
        boardNodes(
          snapshot,
          selectedShotId,
          projectMode === "project" ? projectKey : null,
          projectMode === "demo" ? "Fake I2V" : "Wan 2.2 I2V",
        ),
      );
    }
  }, [snapshot, selectedShotId, projectMode, projectKey]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const edges = useMemo(() => (snapshot ? boardEdges(snapshot) : []), [snapshot]);
  const selectedShot = snapshot?.shots.find((shot) => shot.id === selectedShotId) ?? null;
  const selectedTakes = snapshot?.takes.filter((take) => take.shotId === selectedShotId) ?? [];
  const imageAssets = useMemo(
    () => snapshot?.assets.filter((asset) => asset.mediaType === "image") ?? [],
    [snapshot?.assets],
  );
  const selectedWorkflow =
    workflows.find((workflow) => workflow.path === generationSettings.recipePath) ??
    nativeWorkflowFallbacks.find((workflow) => workflow.path === generationSettings.recipePath) ??
    null;
  const firstFrameAvailable = imageAssets.some(
    (asset) => asset.id === generationSettings.firstFrameAssetId,
  );
  const lastFrameAvailable = imageAssets.some(
    (asset) => asset.id === generationSettings.lastFrameAssetId,
  );
  const generationDisabledReason = useMemo(() => {
    if (projectMode === "demo" || selectedWorkflow?.execution === "comfy_only") return null;
    if (!selectedWorkflow) return "请先选择一个可用 Workflow";
    if (!generationSettings.prompt.trim()) return "请先输入镜头提示词";
    if (selectedWorkflow.inputs.includes("first_frame") && !firstFrameAvailable) {
      return "请从资产库选择一张起始帧";
    }
    if (selectedWorkflow.inputs.includes("last_frame") && !lastFrameAvailable) {
      return "首尾帧模式还需要一张结束帧";
    }
    if (
      !Number.isFinite(generationSettings.width) ||
      generationSettings.width < 256 ||
      generationSettings.width > 2048 ||
      !Number.isFinite(generationSettings.height) ||
      generationSettings.height < 256 ||
      generationSettings.height > 2048 ||
      !Number.isFinite(generationSettings.durationSeconds) ||
      generationSettings.durationSeconds < 1 ||
      generationSettings.durationSeconds > 15 ||
      !Number.isFinite(generationSettings.fps) ||
      generationSettings.fps < 8 ||
      generationSettings.fps > 60 ||
      !Number.isSafeInteger(generationSettings.seed) ||
      generationSettings.seed < 0
    ) {
      return "请检查分辨率、时长、帧率和 Seed";
    }
    return null;
  }, [firstFrameAvailable, generationSettings, lastFrameAvailable, projectMode, selectedWorkflow]);
  const approvedCount = snapshot?.shots.filter((shot) => shot.status === "approved").length ?? 0;
  const totalDuration = snapshot?.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0) ?? 0;
  const activeScene =
    snapshot?.scenes.find((scene) => scene.id === selectedShot?.sceneId) ?? snapshot?.scenes[0];

  const onNodesChange = useCallback((changes: NodeChange<BoardNode>[]) => {
    setNodes((currentNodes) => applyNodeChanges(changes, currentNodes));
  }, []);

  const onNodeClick: NodeMouseHandler<BoardNode> = useCallback(
    (_event, node) => {
      if (!snapshot || (node.data.kind !== "shot" && node.data.kind !== "take_stack")) return;
      const item = snapshot.canvasItems.find((candidate) => candidate.id === node.id);
      if (item) setSelectedShotId(item.refId);
    },
    [snapshot],
  );

  const openProject = useCallback(
    async (key: string) => {
      generationTokenRef.current += 1;
      setGenerationBusy(false);
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.open(key);
        window.sessionStorage.removeItem("takeboard.resumeDemo");
        setProjectKey(key);
        setProjectMode("project");
        acceptPayload(payload);
        setShowHub(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "项目打开失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload],
  );

  const createProject = useCallback(
    async (input: Parameters<typeof projectApi.create>[0]) => {
      generationTokenRef.current += 1;
      setGenerationBusy(false);
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.create(input);
        window.sessionStorage.removeItem("takeboard.resumeDemo");
        setProjectKey(payload.key);
        setProjectMode("project");
        acceptPayload(payload);
        setShowHub(false);
        const catalog = await projectApi.list();
        setProjects(catalog.projects);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "项目创建失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload],
  );

  const openDemo = useCallback(async () => {
    generationTokenRef.current += 1;
    setGenerationBusy(false);
    setBusy(true);
    setError(null);
    try {
      const payload = await demoApi.get();
      setProjectKey(null);
      setProjectMode("demo");
      acceptPayload(payload);
      setShowHub(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Demo 打开失败");
    } finally {
      setBusy(false);
    }
  }, [acceptPayload]);

  useEffect(() => {
    if (!selectedShot) return;
    const scope = `${projectMode}:${projectKey ?? "demo"}:${selectedShot.id}`;
    if (generationScopeRef.current === scope) return;
    generationScopeRef.current = scope;
    setGenerationSettings((current) => ({
      ...current,
      prompt: selectedShot.intent,
      negativePrompt: "",
      durationSeconds: selectedShot.durationSeconds,
      firstFrameAssetId: imageAssets.at(-1)?.id ?? null,
      lastFrameAssetId: null,
    }));
  }, [imageAssets, projectKey, projectMode, selectedShot]);

  useEffect(() => {
    if (window.sessionStorage.getItem("takeboard.resumeDemo") !== "1") return;
    window.sessionStorage.removeItem("takeboard.resumeDemo");
    void openDemo();
  }, [openDemo]);

  const uploadAsset = useCallback(
    async (file: File, metadata?: { kind?: "character" | "location" | "prop"; name?: string }) => {
      if (!projectKey) return;
      setBusy(true);
      setError(null);
      try {
        const previousAssetIds = new Set(snapshot?.assets.map((asset) => asset.id) ?? []);
        const payload = await projectApi.uploadAsset(projectKey, file, metadata);
        const uploadedAsset = payload.snapshot.assets.find(
          (asset) => !previousAssetIds.has(asset.id),
        );
        acceptPayload(payload);
        if (uploadedAsset?.mediaType === "image") {
          setGenerationSettings((current) => ({
            ...current,
            firstFrameAssetId:
              !metadata?.kind || !current.firstFrameAssetId
                ? uploadedAsset.id
                : current.firstFrameAssetId,
          }));
        }
        setNotice(
          metadata?.kind
            ? `已存入${metadata.kind === "character" ? "人物" : metadata.kind === "location" ? "场景" : "道具"}资产：${metadata.name || file.name}`
            : `已导入首帧：${file.name}`,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "素材导入失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, projectKey, snapshot?.assets],
  );

  const refreshWorkflows = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const detected = await workflowApi.list();
      setWorkflows(detected.workflows);
      setWorkflowWarnings(detected.warnings ?? []);
      setComfyEditorUrl(detected.editorUrl);
      setNotice(`已检测 ${detected.workflows.length} 个 ComfyUI Workflow`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工作流检测失败");
    } finally {
      setBusy(false);
    }
  }, []);

  const importWorkflow = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const imported = await workflowApi.import(file);
        await refreshWorkflows();
        setGenerationSettings((current) => ({ ...current, recipePath: imported.path }));
        setNotice(`已导入并识别：${imported.name}`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Workflow 导入失败");
      } finally {
        setBusy(false);
      }
    },
    [refreshWorkflows],
  );

  const generateReal = useCallback(
    async (shot: Shot) => {
      if (!projectKey) return;
      const token = generationTokenRef.current + 1;
      generationTokenRef.current = token;
      setGenerationBusy(true);
      setError(null);
      try {
        if (selectedWorkflow?.execution === "comfy_only") {
          const opened = window.open(
            `${comfyEditorUrl}/?workflow=${encodeURIComponent(selectedWorkflow.path)}`,
            "_blank",
          );
          if (!opened) throw new Error("浏览器阻止了新窗口，请允许弹窗后重试");
          opened.opener = null;
          setNotice("已打开 ComfyUI；这个 JSON 的输入槽位已在 TakeBoard 中识别");
          return;
        }
        if (generationDisabledReason) throw new Error(generationDisabledReason);
        const submitted = await projectApi.generate(projectKey, shot.id, generationSettings);
        if (generationTokenRef.current !== token) return;
        acceptPayload(submitted, shot.id);
        setNotice("Wan 2.2 已开始生成，运行记录已保存");
        for (let attempt = 0; attempt < 240; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 3_000));
          if (generationTokenRef.current !== token) return;
          const result = await projectApi.run(projectKey, submitted.runId);
          if (generationTokenRef.current !== token) return;
          acceptPayload(result);
          if (result.status === "completed") {
            setNotice(`${shot.label} 已生成真实视频 Take`);
            return;
          }
          if (result.status === "failed") throw new Error("4090 生成失败，请查看运行记录");
        }
        throw new Error("生成仍在运行，可稍后重新打开项目查看");
      } catch (cause) {
        if (generationTokenRef.current === token) {
          setError(cause instanceof Error ? cause.message : "生成失败");
        }
      } finally {
        if (generationTokenRef.current === token) setGenerationBusy(false);
      }
    },
    [
      acceptPayload,
      comfyEditorUrl,
      generationDisabledReason,
      generationSettings,
      projectKey,
      selectedWorkflow,
    ],
  );

  const runAction = useCallback(
    async (action: () => ReturnType<typeof demoApi.get>, message: string, shotId?: string) => {
      setBusy(true);
      setError(null);
      try {
        const payload = await action();
        acceptPayload(payload, shotId);
        setNotice(message);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "操作失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload],
  );

  if (showHub) {
    return (
      <ProjectHub
        busy={busy}
        error={error}
        onCreate={createProject}
        onOpen={openProject}
        onOpenDemo={openDemo}
        projects={projects}
        worker={worker}
      />
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
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">T</span>
          <div>
            <strong>TakeBoard</strong>
            <span>OPEN FILMMAKING CANVAS</span>
          </div>
        </div>
        <div className="project-heading">
          <span className="project-dot" />
          <div>
            <strong>{snapshot.project.title}</strong>
            <span>
              {snapshot.scenes[0]?.title} · {projectMode === "demo" ? "功能示例" : "4090 本地项目"}
            </span>
          </div>
        </div>
        <div className="top-actions">
          <span className="save-status">✓ 已保存 · r{revision}</span>
          <ThemeSwitcher compact />
          <span className="local-badge">
            <i /> LOCAL
          </span>
          <button
            className="reset-button"
            type="button"
            onClick={() => {
              generationTokenRef.current += 1;
              setGenerationBusy(false);
              window.sessionStorage.removeItem("takeboard.resumeDemo");
              setShowHub(true);
            }}
          >
            项目主页
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
            <span style={{ width: `${(approvedCount / snapshot.shots.length) * 100}%` }} />
          </div>
        </div>
        <div className="shot-list-heading">
          <span className="section-kicker">SHOTS</span>
          <span>{snapshot.shots.length}</span>
        </div>
        <div className="shot-list">
          {snapshot.shots.map((shot) => {
            const shotTakes = snapshot.takes.filter((take) => take.shotId === shot.id);
            return (
              <button
                type="button"
                key={shot.id}
                className={selectedShotId === shot.id ? "active" : ""}
                onClick={() => setSelectedShotId(shot.id)}
              >
                <span className={`shot-thumb thumb-${shot.order + 1}`}>
                  {shot.status === "approved" ? "✓" : String(shot.order + 1).padStart(2, "0")}
                </span>
                <span className="shot-list-copy">
                  <strong>{shot.label}</strong>
                  <small>{shotTakes.length > 0 ? `${shotTakes.length} Takes` : "未生成"}</small>
                </span>
                <i className={`status-dot status-${shot.status}`} />
              </button>
            );
          })}
        </div>
        {projectMode === "project" ? (
          <div className="asset-import">
            <input
              ref={assetInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadAsset(file);
                event.target.value = "";
              }}
            />
            <button type="button" disabled={busy} onClick={() => assetInput.current?.click()}>
              ＋ 快速添加首帧
            </button>
            <button
              type="button"
              className="vault-button"
              onClick={() => setAssetLibraryOpen(true)}
            >
              ◇ 打开资产库
            </button>
            <small>
              {snapshot.assets.filter((asset) => asset.mediaType === "image").length} 张图片已入库
            </small>
          </div>
        ) : null}
        <div className="sidebar-bottom">
          <span>{projectMode === "demo" ? "DEMO WORKER" : "GENERATION WORKER"}</span>
          <div>
            <i /> {projectMode === "demo" ? "Fake ComfyUI" : (worker?.device ?? "ComfyUI")} ·{" "}
            {worker?.status === "ready" || projectMode === "demo" ? "Ready" : "Offline"}
          </div>
          <small>
            {projectMode === "demo" ? "无需 GPU · 不产生费用" : "开源模型 · 运行在你的 4090"}
          </small>
        </div>
      </nav>

      <section className="canvas-wrap" aria-label="TakeBoard 创作画布">
        <div className="canvas-toolbar">
          <div>
            <span className="scene-chip">{activeScene?.label ?? "SC-01"}</span>
            <strong>{activeScene?.title || "未命名场景"}</strong>
          </div>
          <div className="canvas-legend">
            {projectMode === "project" ? (
              <div className="canvas-primary-actions">
                <button type="button" onClick={() => setRecipeOpen(true)}>
                  ⌘ 工作流
                </button>
                <button type="button" onClick={() => setAssetLibraryOpen(true)}>
                  ◇ 资产库
                </button>
              </div>
            ) : null}
            <span>
              <i className="legend-reference" />
              引用
            </span>
            <span>
              <i className="legend-generated" />
              生成来源
            </span>
            <span className="drag-hint">拖动节点 · 滚轮缩放</span>
          </div>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={boardNodeTypes as NodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onNodeDragStop={(_event, node) => {
            void (
              projectMode === "project" && projectKey
                ? projectApi.move(projectKey, node.id, node.position.x, node.position.y)
                : demoApi.move(node.id, node.position.x, node.position.y)
            )
              .then((payload) => {
                setSnapshot(payload.snapshot);
                setRevision(payload.revision);
              })
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : "位置保存失败"),
              );
          }}
          minZoom={0.35}
          maxZoom={1.5}
          defaultViewport={{ x: 60, y: 30, zoom: 0.78 }}
          fitView
          fitViewOptions={{ padding: 0.12, maxZoom: 0.9 }}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={null}
        >
          <Background color="#29302e" gap={28} size={1} />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
        <div className="canvas-status">
          {nodes.length} 节点 · {edges.length} 关系
        </div>
      </section>

      {selectedShot ? (
        <Inspector
          shot={selectedShot}
          takes={selectedTakes}
          busy={busy || generationBusy}
          assets={snapshot.assets}
          projectKey={projectMode === "project" ? projectKey : null}
          isDemo={projectMode === "demo"}
          runs={snapshot.runs}
          settings={generationSettings}
          workflow={selectedWorkflow}
          onSettingsChange={setGenerationSettings}
          onOpenAssets={() => setAssetLibraryOpen(true)}
          onOpenRecipes={() => setRecipeOpen(true)}
          generateDisabledReason={generationDisabledReason}
          workerLabel={
            projectMode === "demo"
              ? "Fake Wan I2V"
              : `${selectedWorkflow?.name ?? "ComfyUI"} · ${worker?.device ?? "本地 Worker"}`
          }
          onGenerate={() =>
            projectMode === "demo"
              ? void runAction(
                  () => demoApi.generate(selectedShot.id),
                  `${selectedShot.label} 已生成 4 个新候选`,
                  selectedShot.id,
                )
              : void generateReal(selectedShot)
          }
          onReject={(takeId, reason) =>
            void runAction(
              () =>
                projectMode === "project" && projectKey
                  ? projectApi.reject(projectKey, takeId, reason)
                  : demoApi.reject(takeId, reason),
              `已淘汰候选 · ${reason}`,
              selectedShot.id,
            )
          }
          onApprove={(takeId) =>
            void runAction(
              () =>
                projectMode === "project" && projectKey
                  ? projectApi.approve(projectKey, takeId, "人工批准")
                  : demoApi.approve(takeId, "Demo 人工批准"),
              `${selectedShot.label} 已批准，决策历史已保存`,
              selectedShot.id,
            )
          }
        />
      ) : null}

      <RecipeStudio
        busy={busy}
        editorUrl={comfyEditorUrl}
        onClose={() => setRecipeOpen(false)}
        onImport={importWorkflow}
        onRefresh={refreshWorkflows}
        onSelect={(workflow) => {
          setGenerationSettings((current) => ({
            ...current,
            recipePath: workflow.path,
            fps: workflow.name.toLowerCase().includes("minimax") ? 24 : current.fps,
          }));
          setRecipeOpen(false);
          setNotice(`已切换：${workflow.name}`);
        }}
        open={recipeOpen}
        selectedPath={generationSettings.recipePath}
        warnings={workflowWarnings}
        workflows={workflows}
      />
      {projectKey ? (
        <AssetLibrary
          assets={snapshot.assets}
          busy={busy}
          entities={snapshot.entities}
          onClose={() => setAssetLibraryOpen(false)}
          onPickFrame={(assetId, slot) => {
            setGenerationSettings((current) => ({
              ...current,
              [slot === "first" ? "firstFrameAssetId" : "lastFrameAssetId"]: assetId,
            }));
            setAssetLibraryOpen(false);
            setNotice(slot === "first" ? "已设为起始帧" : "已设为结束帧");
          }}
          onUpload={async (file, metadata) => await uploadAsset(file, metadata)}
          open={assetLibraryOpen}
          projectKey={projectKey}
          selectedFirstFrameId={generationSettings.firstFrameAssetId}
          selectedLastFrameId={generationSettings.lastFrameAssetId}
        />
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
