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
import type { Asset, ProjectSnapshot, Shot, Take } from "@takeboard/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { demoApi, type ProjectCatalogItem, projectApi, type WorkerStatus } from "./api";
import { type BoardNode, boardNodeTypes } from "./board-nodes";
import { ProjectHub } from "./project-hub";

const rejectionReasons = ["角色漂移", "运动方向错误", "构图不稳定", "细节异常"];

function shortId(value: string) {
  return value.slice(-6).toUpperCase();
}

function boardNodes(snapshot: ProjectSnapshot, selectedShotId: string | null): BoardNode[] {
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
      return {
        ...common,
        data: {
          kind: "entity",
          eyebrow: "CHARACTER",
          title: entity?.name ?? "角色",
          body: entity?.description ?? "",
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
}: InspectorProps) {
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null);
  const [reason, setReason] = useState(rejectionReasons[0] ?? "角色漂移");
  useEffect(() => {
    const approved = takes.find((take) => take.status === "approved");
    const candidate = takes.find((take) => take.status === "candidate");
    setSelectedTakeId(approved?.id ?? candidate?.id ?? takes[0]?.id ?? null);
  }, [takes]);
  const selectedTake = takes.find((take) => take.id === selectedTakeId);

  return (
    <aside className="inspector" aria-label="镜头候选检查器">
      <div className="inspector-heading">
        <div>
          <span className="section-kicker">SHOT INSPECTOR</span>
          <h2>{shot.label}</h2>
        </div>
        <span className={`large-status status-${shot.status}`}>
          {shot.status === "approved" ? "已批准" : shot.status === "review" ? "待选择" : "待生成"}
        </span>
      </div>
      <p className="shot-intent">{shot.intent}</p>
      <div className="shot-facts">
        <span>{shot.durationSeconds}s</span>
        <span>{shot.aspectRatio}</span>
        <span>{workerLabel}</span>
      </div>

      <div className="candidate-title-row">
        <div>
          <h3>候选 Takes</h3>
          <p>{takes.length > 0 ? `${takes.length} 个结果 · 点击比较` : "先生成一组可选择的结果"}</p>
        </div>
        <button className="generate-button" type="button" onClick={onGenerate} disabled={busy}>
          {busy ? <span className="spinner" /> : <span>✦</span>}
          {busy ? "生成中…" : takes.length > 0 ? "再抽 4 个" : "生成 4 个"}
        </button>
      </div>

      {takes.length === 0 ? (
        <div className="empty-candidates">
          <div className="empty-orbit">
            <span />
            <span />
            <span />
          </div>
          <strong>这个镜头还没有 Take</strong>
          <p>Demo 会模拟 4 次独立运行，并保留 seed、来源和选择历史。</p>
          <button type="button" onClick={onGenerate} disabled={busy}>
            开始生成
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
                  source={
                    projectKey
                      ? projectApi.assetUrl(
                          projectKey,
                          assets.find((asset) => asset.id === take.assetId)?.id ?? "",
                        )
                      : undefined
                  }
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
                <div className="candidate-seed">seed · {26081301 + index}</div>
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
  const assetInput = useRef<HTMLInputElement>(null);

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
    void Promise.allSettled([projectApi.list(), projectApi.worker()]).then(([catalog, status]) => {
      if (catalog.status === "fulfilled") setProjects(catalog.value.projects);
      else setError(catalog.reason instanceof Error ? catalog.reason.message : "无法载入项目列表");
      if (status.status === "fulfilled") setWorker(status.value);
      else setWorker({ status: "offline", engine: "ComfyUI" });
    });
  }, []);

  useEffect(() => {
    if (snapshot) {
      setNodes(boardNodes(snapshot, selectedShotId));
    }
  }, [snapshot, selectedShotId]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const edges = useMemo(() => (snapshot ? boardEdges(snapshot) : []), [snapshot]);
  const selectedShot = snapshot?.shots.find((shot) => shot.id === selectedShotId) ?? null;
  const selectedTakes = snapshot?.takes.filter((take) => take.shotId === selectedShotId) ?? [];
  const approvedCount = snapshot?.shots.filter((shot) => shot.status === "approved").length ?? 0;

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
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.open(key);
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
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.create(input);
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

  const uploadAsset = useCallback(
    async (file: File) => {
      if (!projectKey) return;
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.uploadAsset(projectKey, file);
        acceptPayload(payload);
        setNotice(`已导入首帧：${file.name}`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "素材导入失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, projectKey],
  );

  const generateReal = useCallback(
    async (shot: Shot) => {
      if (!projectKey) return;
      setBusy(true);
      setError(null);
      try {
        const submitted = await projectApi.generate(projectKey, shot.id);
        acceptPayload(submitted, shot.id);
        setNotice("Wan 2.2 已开始生成，运行记录已保存");
        for (let attempt = 0; attempt < 240; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 3_000));
          const result = await projectApi.run(projectKey, submitted.runId);
          acceptPayload(result, shot.id);
          if (result.status === "completed") {
            setNotice(`${shot.label} 已生成真实视频 Take`);
            return;
          }
          if (result.status === "failed") throw new Error("4090 生成失败，请查看运行记录");
        }
        throw new Error("生成仍在运行，可稍后重新打开项目查看");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "生成失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, projectKey],
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
          <span className="local-badge">
            <i /> LOCAL
          </span>
          <button className="reset-button" type="button" onClick={() => setShowHub(true)}>
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
              <span>AI 悬疑短片 · 12 秒</span>
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
              ＋ 添加首帧素材
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
            <span className="scene-chip">SC-01</span>
            <strong>清晨的旧渡口</strong>
          </div>
          <div className="canvas-legend">
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
          busy={busy}
          assets={snapshot.assets}
          projectKey={projectMode === "project" ? projectKey : null}
          workerLabel={projectMode === "demo" ? "Fake Wan I2V" : "Wan 2.2 I2V · RTX 4090"}
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
              () => demoApi.reject(takeId, reason),
              `已淘汰候选 · ${reason}`,
              selectedShot.id,
            )
          }
          onApprove={(takeId) =>
            void runAction(
              () => demoApi.approve(takeId, "Demo 人工批准"),
              `${selectedShot.label} 已批准，决策历史已保存`,
              selectedShot.id,
            )
          }
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
