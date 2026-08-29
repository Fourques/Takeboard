import { type CSSProperties, useMemo, useRef, useState } from "react";
import {
  type ArchivedWorkflow,
  type WorkflowArchivePreview,
  type WorkflowBindingDraft,
  type WorkflowBindingInspection,
  type WorkflowBindingTarget,
  type WorkflowBindingTransform,
  type WorkflowCapability,
  type WorkflowImport,
  type WorkflowMediaKey,
  type WorkflowParameterKey,
  type WorkflowSummary,
  workflowApi,
} from "./api";

const groups: Array<{ id: "all" | WorkflowCapability; label: string }> = [
  { id: "all", label: "全部" },
  { id: "text_to_image", label: "文生图" },
  { id: "image_to_image", label: "图生图" },
  { id: "text_to_video", label: "文生视频" },
  { id: "image_to_video", label: "图生视频" },
  { id: "first_last_video", label: "首尾帧" },
  { id: "reference_video", label: "参考生成" },
];

const capabilityIcon: Record<WorkflowCapability, string> = {
  text_to_image: "文",
  image_to_image: "图",
  text_to_video: "影",
  image_to_video: "动",
  first_last_video: "首",
  reference_video: "参",
};

const parameterLabels: Record<WorkflowParameterKey, string> = {
  prompt: "提示词",
  negative_prompt: "负面提示词",
  seed: "Seed",
  steps: "采样步数",
  denoise: "重绘强度",
  width: "宽度",
  height: "高度",
  duration: "时长（秒）",
  fps: "帧率",
};
const mediaLabels: Record<WorkflowMediaKey, string> = {
  first_frame: "起始图片",
  last_frame: "结束图片",
  reference_image: "参考图片",
  reference_video: "参考视频",
  reference_audio: "参考音频",
};
const bindingTargetRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr) auto auto",
  alignItems: "center",
  padding: "7px 9px",
  borderTop: "1px solid var(--line)",
  color: "var(--muted)",
  fontSize: "8px",
  gap: "7px",
};
const bindingTargetLabelStyle: CSSProperties = { display: "contents" };
const bindingTargetNameStyle: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const bindingTransformStyle: CSSProperties = {
  maxWidth: "150px",
  minHeight: "26px",
  border: "1px solid var(--line)",
  borderRadius: "5px",
  color: "var(--text-1)",
  background: "var(--surface-1)",
  fontSize: "8px",
};

export function RecipeStudio({
  busy,
  canManageWorkflows,
  editorUrl,
  onClose,
  onImport,
  onRefresh,
  onSelect,
  open,
  selectedPath,
  selectionLocked,
  warnings,
  workflows,
}: {
  busy: boolean;
  canManageWorkflows: boolean;
  editorUrl: string;
  onClose: () => void;
  onImport: (file: File) => Promise<WorkflowImport>;
  onRefresh: () => Promise<void>;
  onSelect: (workflow: WorkflowSummary) => void;
  open: boolean;
  selectedPath: string;
  selectionLocked: boolean;
  warnings: string[];
  workflows: WorkflowSummary[];
}) {
  const [group, setGroup] = useState<"all" | WorkflowCapability>("all");
  const [origin, setOrigin] = useState<"all" | "built_in" | "imported" | "comfyui">("all");
  const [query, setQuery] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [inspection, setInspection] = useState<WorkflowBindingInspection | null>(null);
  const [bindingDraft, setBindingDraft] = useState<WorkflowBindingDraft | null>(null);
  const [bindingBusy, setBindingBusy] = useState(false);
  const [bindingError, setBindingError] = useState("");
  const [archivePreview, setArchivePreview] = useState<WorkflowArchivePreview | null>(null);
  const [archives, setArchives] = useState<ArchivedWorkflow[] | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [packageNotice, setPackageNotice] = useState("");
  const [packageNoticePath, setPackageNoticePath] = useState("");
  const [packageBusy, setPackageBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const filtered = useMemo(
    () =>
      workflows.filter(
        (workflow) =>
          (group === "all" || workflow.capability === group) &&
          (origin === "all" || workflow.origin === origin) &&
          `${workflow.name} ${workflow.models.join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [group, origin, query, workflows],
  );
  const selectedEditorUrl = selectedPath
    ? `${editorUrl}/?takeboard_workflow=${encodeURIComponent(selectedPath)}`
    : editorUrl;

  const configureBinding = async (workflow: WorkflowSummary) => {
    setBindingBusy(true);
    setBindingError("");
    setInspection({ path: workflow.path, status: workflow.bindingStatus ?? "needs_binding" });
    setBindingDraft(null);
    try {
      const result = await workflowApi.inspectWorkflow(workflow.path);
      setInspection(result);
      setBindingDraft(result.binding ?? result.suggested ?? null);
    } catch (error) {
      setBindingError(error instanceof Error ? error.message : "无法分析该工作流");
      setInspection({ path: workflow.path, status: "needs_binding" });
      setBindingDraft(null);
    } finally {
      setBindingBusy(false);
    }
  };

  const toggleTarget = (
    groupName: "parameters" | "media",
    key: WorkflowParameterKey | WorkflowMediaKey,
    nodeId: string,
    input: string,
    suggestedTransform?: WorkflowBindingTransform,
  ) => {
    setBindingDraft((current) => {
      if (!current) return current;
      const group = current[groupName] as Record<string, WorkflowBindingTarget[] | undefined>;
      const previous = group[key] ?? [];
      const selected = previous.some(
        (target) => target.nodeId === nodeId && target.input === input,
      );
      return {
        ...current,
        [groupName]: {
          ...current[groupName],
          [key]: selected
            ? previous.filter((target) => target.nodeId !== nodeId || target.input !== input)
            : [
                ...previous,
                { nodeId, input, ...(suggestedTransform ? { transform: suggestedTransform } : {}) },
              ],
        },
      };
    });
  };

  const updateTargetTransform = (
    key: WorkflowParameterKey,
    nodeId: string,
    input: string,
    transform: "identity" | WorkflowBindingTransform,
  ) => {
    setBindingDraft((current) => {
      if (!current) return current;
      const targets = current.parameters[key] ?? [];
      return {
        ...current,
        parameters: {
          ...current.parameters,
          [key]: targets.map((target) =>
            target.nodeId === nodeId && target.input === input
              ? {
                  nodeId,
                  input,
                  ...(transform === "identity" ? {} : { transform }),
                }
              : target,
          ),
        },
      };
    });
  };

  const saveBinding = async () => {
    if (!bindingDraft || !inspection) return;
    setBindingBusy(true);
    setBindingError("");
    try {
      await workflowApi.saveBinding(inspection.path, bindingDraft);
      await onRefresh();
      setInspection(null);
      setBindingDraft(null);
    } catch (error) {
      setBindingError(error instanceof Error ? error.message : "参数绑定保存失败");
    } finally {
      setBindingBusy(false);
    }
  };

  const previewArchive = async (workflow: WorkflowSummary) => {
    setArchiveBusy(true);
    setArchiveError("");
    try {
      setArchivePreview(await workflowApi.archivePreview(workflow.path));
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "无法检查工作流引用");
    } finally {
      setArchiveBusy(false);
    }
  };

  const openArchives = async () => {
    setArchiveBusy(true);
    setArchiveError("");
    try {
      setArchives((await workflowApi.archives()).archives);
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "无法读取归档");
    } finally {
      setArchiveBusy(false);
    }
  };

  const confirmArchive = async () => {
    if (!archivePreview || archivePreview.blocked) return;
    setArchiveBusy(true);
    setArchiveError("");
    try {
      await workflowApi.archive(archivePreview);
      setArchivePreview(null);
      await onRefresh();
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "工作流归档失败");
    } finally {
      setArchiveBusy(false);
    }
  };

  const importRecipePackage = async (file: File) => {
    setPackageBusy(true);
    setBindingError("");
    setPackageNotice("");
    try {
      const imported = await workflowApi.importRecipePackage(file);
      await onRefresh();
      setInspection(imported);
      setBindingDraft(imported.binding ?? imported.suggested ?? null);
      setPackageNoticePath(imported.path);
      setPackageNotice(
        imported.recipePackage.bindingProposalIncluded
          ? "Workflow 与映射草案已通过完整性校验。请核对当前电脑的节点、模型和参数位置，再明确启用。"
          : "Workflow 已通过完整性校验。此包没有映射草案，请完成参数绑定后启用。",
      );
    } catch (error) {
      setBindingError(error instanceof Error ? error.message : "Recipe 包导入失败");
    } finally {
      setPackageBusy(false);
    }
  };

  const importWorkflowJson = async (file: File) => {
    setPackageBusy(true);
    setBindingError("");
    setPackageNotice("");
    try {
      const imported = await onImport(file);
      setInspection(imported);
      setBindingDraft(imported.binding ?? imported.suggested ?? null);
      setPackageNoticePath(imported.path);
      setPackageNotice(
        imported.candidates
          ? "Workflow 已隔离导入并完成当前电脑诊断。请核对自动识别的参数位置，再明确启用。"
          : "Workflow 已安全导入，但当前电脑尚未完成节点转换诊断。修复诊断问题后才能启用。",
      );
      if (!imported.candidates) {
        setBindingError(imported.warning ?? "当前工作流无法转换为可执行 Prompt");
      }
    } catch (error) {
      setBindingError(error instanceof Error ? error.message : "Workflow 导入失败");
    } finally {
      setPackageBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div className="studio-backdrop">
      <aside className="recipe-studio">
        <header className="studio-header">
          <div>
            <span className="section-kicker">RECIPE LIBRARY</span>
            <h2>工作流与模型</h2>
            <p>
              {selectionLocked
                ? "当前镜头已有结果，工作流已锁定"
                : `共 ${workflows.length} 个可用工作流`}
              {warnings.length > 0 ? ` · ${warnings.length} 个文件未能读取` : ""}
            </p>
          </div>
          <div className="studio-actions">
            <button
              type="button"
              aria-pressed={advanced}
              onClick={() => setAdvanced((current) => !current)}
              title="显示文件名、节点编号与诊断代码"
            >
              {advanced ? "简洁" : "高级"}
            </button>
            {canManageWorkflows ? (
              <button type="button" onClick={() => void openArchives()} disabled={archiveBusy}>
                归档
              </button>
            ) : null}
            <button type="button" onClick={() => void onRefresh()} disabled={busy}>
              ↻ 检测
            </button>
            <button type="button" onClick={onClose} aria-label="关闭工作流面板">
              ×
            </button>
          </div>
        </header>
        <div className="recipe-toolbar">
          <fieldset className="recipe-origin-tabs">
            <legend>工作流来源</legend>
            {[
              ["all", "全部来源"],
              ["built_in", "TakeBoard 内置"],
              ["imported", "我的导入"],
              ["comfyui", "ComfyUI 现有"],
            ].map(([id, label]) => (
              <button
                type="button"
                key={id}
                className={origin === id ? "active" : ""}
                onClick={() => setOrigin(id as typeof origin)}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <div className="recipe-tabs">
            {groups.map((item) => (
              <button
                type="button"
                key={item.id}
                className={group === item.id ? "active" : ""}
                onClick={() => setGroup(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 Workflow 或模型…"
            aria-label="搜索工作流"
          />
        </div>
        <div className="recipe-body">
          <div className="recipe-list">
            {filtered.map((workflow) => (
              <div className="recipe-card-wrap" key={workflow.path}>
                <button
                  type="button"
                  className={`recipe-card ${selectedPath === workflow.path ? "selected" : ""}`}
                  disabled={selectionLocked}
                  onClick={() => {
                    if (workflow.execution === "comfy_only") void configureBinding(workflow);
                    else onSelect(workflow);
                  }}
                >
                  <span className={`recipe-icon capability-${workflow.capability}`}>
                    {capabilityIcon[workflow.capability]}
                  </span>
                  <span className="recipe-copy">
                    <strong>{workflow.name}</strong>
                    <small>
                      {workflow.capabilityLabel} ·{" "}
                      {(workflow.mediaInputs?.first_frame ?? 0) +
                        (workflow.mediaInputs?.last_frame ?? 0) +
                        (workflow.mediaInputs?.reference ?? 0) +
                        (workflow.mediaInputs?.reference_video ?? 0)}{" "}
                      个画面位置 · {workflow.inputs.length} 项参数
                    </small>
                    <span>
                      {advanced
                        ? workflow.models
                            .slice(0, 2)
                            .map((model) => model.replace(/\.safetensors$/i, ""))
                            .join(" · ") || "未检测到固定模型"
                        : workflow.modelStatus === "missing"
                          ? "执行端缺少这个工作流需要的模型"
                          : workflow.diagnostic?.health === "blocked"
                            ? "需要完成检查后才能运行"
                            : "依赖检查通过后可直接用于镜头"}
                    </span>
                  </span>
                  <i
                    className={`${workflow.execution === "native" || workflow.execution === "bound" ? "native" : "comfy"} model-${workflow.modelStatus ?? "unknown"}`}
                  >
                    {workflow.modelStatus === "missing"
                      ? "缺模型"
                      : workflow.bindingStatus === "stale"
                        ? "映射失效"
                        : workflow.execution === "bound"
                          ? "已验证"
                          : workflow.execution === "native"
                            ? "内置适配"
                            : "配置运行"}
                  </i>
                  {workflow.diagnostic ? (
                    <em className={`workflow-health health-${workflow.diagnostic.health}`}>
                      {workflow.diagnostic.health === "ready"
                        ? "可执行"
                        : workflow.diagnostic.health === "blocked"
                          ? `${workflow.diagnostic.checks.filter((item) => item.status === "blocked").length} 项阻塞`
                          : "需检查"}
                    </em>
                  ) : null}
                  <b className={`workflow-origin origin-${workflow.origin ?? "comfyui"}`}>
                    {workflow.origin === "built_in"
                      ? "内置"
                      : workflow.origin === "imported"
                        ? "我的"
                        : "ComfyUI"}
                  </b>
                </button>
                {workflow.execution !== "native" ? (
                  <button
                    type="button"
                    className="recipe-binding-action"
                    onClick={() => void configureBinding(workflow)}
                  >
                    {canManageWorkflows
                      ? workflow.execution === "bound"
                        ? "检查映射"
                        : "建立映射"
                      : "查看诊断"}
                  </button>
                ) : null}
                {canManageWorkflows ? (
                  <a
                    className="recipe-package-action"
                    href={workflowApi.recipePackageUrl(workflow.path)}
                    download
                    title="导出 Workflow、参数映射、依赖清单与内容哈希"
                  >
                    导出包
                  </a>
                ) : null}
                {canManageWorkflows && workflow.origin === "imported" ? (
                  <button
                    type="button"
                    className="recipe-archive-action"
                    disabled={archiveBusy}
                    onClick={() => void previewArchive(workflow)}
                    title="检查引用后归档；可随时恢复"
                  >
                    归档
                  </button>
                ) : null}
              </div>
            ))}
            {filtered.length === 0 ? (
              <div className="recipe-empty">这个分类还没有 Workflow。拖入 JSON 后会自动检测。</div>
            ) : null}
          </div>
          {canManageWorkflows ? (
            <div className="workflow-import-wrap">
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json,application/gzip,.tgz,.takeboard-recipe.tgz"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    if (file.name.toLowerCase().endsWith(".tgz")) void importRecipePackage(file);
                    else void importWorkflowJson(file);
                  }
                  event.target.value = "";
                }}
              />
              <button
                className="workflow-import"
                type="button"
                onClick={() => fileInput.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files[0];
                  if (file) {
                    if (file.name.toLowerCase().endsWith(".tgz")) void importRecipePackage(file);
                    else void importWorkflowJson(file);
                  }
                }}
                disabled={packageBusy}
              >
                <span>↧</span>
                <strong>{packageBusy ? "正在隔离验包…" : "导入 Workflow 或 Recipe 包"}</strong>
                <p>
                  JSON 用于单机导入；Recipe
                  包同时携带映射草案、依赖清单与哈希，但不会自动获得执行信任。
                </p>
                <i>选择 .json / .takeboard-recipe.tgz</i>
              </button>
              {bindingError && !inspection ? (
                <p className="workflow-package-error">{bindingError}</p>
              ) : null}
            </div>
          ) : (
            <div className="workflow-readonly-note">
              工作流由实例管理员管理。你可以查看依赖诊断和使用已验证的 Recipe。
            </div>
          )}
        </div>
        <footer className="studio-footer">
          <div>
            {selectionLocked ? "当前镜头保留原工作流，确保结果可复现" : "选择后将绑定到当前镜头"}
          </div>
          <a href={selectedEditorUrl} target="_blank" rel="noreferrer">
            进入 ComfyUI 深度编辑 ↗
          </a>
        </footer>
        {inspection ? (
          <div className="binding-editor-backdrop">
            <section className="binding-editor">
              <header>
                <div>
                  <span className="section-kicker">
                    {advanced ? "WORKFLOW BINDING · V1" : "WORKFLOW SETUP"}
                  </span>
                  <h3>{advanced ? "建立 TakeBoard 参数映射" : "让 TakeBoard 认识这个工作流"}</h3>
                  <p>
                    {advanced
                      ? inspection.path
                      : "确认生成类型、输出和需要由画布控制的内容；工作流原文件不会被改写。"}
                  </p>
                  {inspection.path === packageNoticePath && packageNotice ? (
                    <div className="recipe-package-notice">{packageNotice}</div>
                  ) : null}
                </div>
                <button type="button" onClick={() => setInspection(null)} aria-label="关闭映射面板">
                  ×
                </button>
              </header>
              {bindingBusy && !bindingDraft ? (
                <div className="binding-loading">正在读取真实工作流与节点定义…</div>
              ) : null}
              {bindingDraft && inspection.candidates ? (
                <div className="binding-editor-body">
                  <div className="binding-overview">
                    <label>
                      生成能力
                      <select
                        value={bindingDraft.capability}
                        onChange={(event) =>
                          setBindingDraft({
                            ...bindingDraft,
                            capability: event.target.value as WorkflowCapability,
                          })
                        }
                      >
                        {groups.slice(1).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      输出文件
                      <select
                        value={bindingDraft.outputMediaType}
                        onChange={(event) =>
                          setBindingDraft({
                            ...bindingDraft,
                            outputMediaType: event.target.value as "image" | "video",
                          })
                        }
                      >
                        <option value="image">图片</option>
                        <option value="video">视频</option>
                      </select>
                    </label>
                    <span>{inspection.nodeCount ?? 0} 个可执行节点</span>
                  </div>
                  {inspection.diagnostic ? (
                    <div className="workflow-diagnostic-grid">
                      {inspection.diagnostic.checks.map((item) => (
                        <article className={`diagnostic-${item.status}`} key={item.id}>
                          <i aria-hidden="true">
                            {item.status === "pass" ? "✓" : item.status === "blocked" ? "!" : "·"}
                          </i>
                          <div>
                            <strong>{item.title}</strong>
                            <p>{item.detail}</p>
                            {item.remediation ? <small>{item.remediation}</small> : null}
                          </div>
                          {advanced ? <code>{item.code}</code> : null}
                        </article>
                      ))}
                    </div>
                  ) : (inspection.conversionIssues?.length ?? 0) > 0 ? (
                    <div className="binding-issues">
                      <strong>转换预检尚未通过</strong>
                      {inspection.conversionIssues?.slice(0, 8).map((issue) => (
                        <p key={issue}>{issue}</p>
                      ))}
                    </div>
                  ) : null}
                  <div className="binding-map-groups">
                    <div>
                      <h4>生成参数</h4>
                      {(Object.keys(parameterLabels) as WorkflowParameterKey[]).map((key) => {
                        const candidates = inspection.candidates?.parameters[key] ?? [];
                        const selected = bindingDraft.parameters[key] ?? [];
                        return (
                          <details key={key} open={key === "prompt"}>
                            <summary>
                              <span>{parameterLabels[key]}</span>
                              <i>{selected.length ? `${selected.length} 处` : "使用工作流默认"}</i>
                            </summary>
                            {candidates.length ? (
                              candidates.map((candidate) => {
                                const selectedTarget = selected.find(
                                  (target) =>
                                    target.nodeId === candidate.nodeId &&
                                    target.input === candidate.input,
                                );
                                return (
                                  <div
                                    key={`${candidate.nodeId}.${candidate.input}`}
                                    style={bindingTargetRowStyle}
                                  >
                                    <label style={bindingTargetLabelStyle}>
                                      <input
                                        type="checkbox"
                                        checked={Boolean(selectedTarget)}
                                        onChange={() =>
                                          toggleTarget(
                                            "parameters",
                                            key,
                                            candidate.nodeId,
                                            candidate.input,
                                            candidate.suggestedTransform,
                                          )
                                        }
                                      />
                                      <span style={bindingTargetNameStyle}>{candidate.label}</span>
                                    </label>
                                    {advanced && key === "duration" && selectedTarget ? (
                                      <select
                                        aria-label={`${candidate.label}换算方式`}
                                        style={bindingTransformStyle}
                                        value={selectedTarget.transform ?? "identity"}
                                        onChange={(event) =>
                                          updateTargetTransform(
                                            key,
                                            candidate.nodeId,
                                            candidate.input,
                                            event.target.value as
                                              | "identity"
                                              | WorkflowBindingTransform,
                                          )
                                        }
                                      >
                                        <option value="identity">直接写入秒数</option>
                                        <option value="seconds_to_frames">秒 × FPS</option>
                                        <option value="seconds_to_frames_plus_one">
                                          秒 × FPS + 1
                                        </option>
                                        <option value="seconds_to_frames_minus_one">
                                          秒 × FPS - 1
                                        </option>
                                      </select>
                                    ) : null}
                                    {advanced ? <code>{candidate.nodeId}</code> : null}
                                  </div>
                                );
                              })
                            ) : (
                              <p>未自动识别到候选输入</p>
                            )}
                          </details>
                        );
                      })}
                    </div>
                    <div>
                      <h4>素材入口</h4>
                      {(Object.keys(mediaLabels) as WorkflowMediaKey[]).map((key) => {
                        const candidates = inspection.candidates?.media[key] ?? [];
                        const selected = bindingDraft.media[key] ?? [];
                        return (
                          <details key={key}>
                            <summary>
                              <span>{mediaLabels[key]}</span>
                              <i>{selected.length ? `${selected.length} 个入口` : "不接入"}</i>
                            </summary>
                            {candidates.length ? (
                              candidates.map((candidate) => (
                                <label key={`${candidate.nodeId}.${candidate.input}`}>
                                  <input
                                    type="checkbox"
                                    checked={selected.some(
                                      (target) =>
                                        target.nodeId === candidate.nodeId &&
                                        target.input === candidate.input,
                                    )}
                                    onChange={() =>
                                      toggleTarget("media", key, candidate.nodeId, candidate.input)
                                    }
                                  />
                                  <span>{candidate.label}</span>
                                  {advanced ? <code>{candidate.nodeId}</code> : null}
                                </label>
                              ))
                            ) : (
                              <p>未检测到这种素材加载节点</p>
                            )}
                          </details>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
              <footer>
                <p>{inspection.warning ?? bindingError}</p>
                {bindingError ? <strong>{bindingError}</strong> : null}
                {canManageWorkflows ? (
                  <button
                    type="button"
                    onClick={() => void saveBinding()}
                    disabled={
                      !bindingDraft ||
                      bindingBusy ||
                      Boolean(
                        inspection.diagnostic?.checks.some(
                          (item) => item.status === "blocked" && item.category !== "binding",
                        ) ?? inspection.conversionIssues?.length,
                      )
                    }
                  >
                    {bindingBusy ? "正在验证…" : "信任此工作流并启用"}
                  </button>
                ) : (
                  <span>只读诊断 · 请联系实例管理员修改映射</span>
                )}
              </footer>
            </section>
          </div>
        ) : null}
        {archivePreview ? (
          <div className="binding-editor-backdrop">
            <section className="workflow-archive-dialog" role="alertdialog" aria-modal="true">
              <header>
                <div>
                  <span className="section-kicker">WORKFLOW ARCHIVE</span>
                  <h3>归档“{archivePreview.name}”</h3>
                  <p>归档会从工作流列表移走文件，但保留原内容与参数映射，可恢复。</p>
                </div>
                <button type="button" onClick={() => setArchivePreview(null)} aria-label="关闭">
                  ×
                </button>
              </header>
              {archivePreview.references.length ? (
                <div className="workflow-reference-list">
                  <strong>仍被以下项目引用，暂不能归档</strong>
                  {archivePreview.references.map((reference) => (
                    <article key={`${reference.location}:${reference.projectKey}`}>
                      <div>
                        <b>{reference.projectTitle}</b>
                        <span>{reference.location === "trash" ? "回收区" : "使用中"}</span>
                      </div>
                      <p>
                        {reference.shotLabels.join("、") || "生成记录"}
                        {reference.runCount ? ` · ${reference.runCount} 条生成记录` : ""}
                      </p>
                    </article>
                  ))}
                  <small>请先更换这些镜头的工作流；回收区项目也会保留可恢复性。</small>
                </div>
              ) : (
                <div className="workflow-archive-safe">
                  <i>✓</i>
                  <div>
                    <strong>没有项目引用</strong>
                    <p>归档不会影响现有镜头或生成记录。</p>
                  </div>
                </div>
              )}
              {archiveError ? <p className="form-error">{archiveError}</p> : null}
              <footer>
                <button type="button" onClick={() => setArchivePreview(null)}>
                  取消
                </button>
                <button
                  type="button"
                  disabled={archiveBusy || archivePreview.blocked}
                  onClick={() => void confirmArchive()}
                >
                  {archiveBusy ? "正在归档…" : archivePreview.blocked ? "仍有引用" : "归档工作流"}
                </button>
              </footer>
            </section>
          </div>
        ) : null}
        {archives ? (
          <div className="binding-editor-backdrop">
            <section
              className="workflow-archive-dialog archive-library"
              role="dialog"
              aria-modal="true"
            >
              <header>
                <div>
                  <span className="section-kicker">WORKFLOW ARCHIVE</span>
                  <h3>工作流归档</h3>
                  <p>归档文件仍保存在 ComfyUI 用户目录中。</p>
                </div>
                <button type="button" onClick={() => setArchives(null)} aria-label="关闭">
                  ×
                </button>
              </header>
              <div className="workflow-archive-list">
                {archives.map((archive) => (
                  <article key={archive.archivePath}>
                    <div>
                      <strong>{archive.name}</strong>
                      <small>{new Date(archive.archivedAt).toLocaleString("zh-CN")}</small>
                    </div>
                    <button
                      type="button"
                      disabled={archiveBusy}
                      onClick={() =>
                        void (async () => {
                          setArchiveBusy(true);
                          setArchiveError("");
                          try {
                            await workflowApi.restoreArchive(archive.archivePath);
                            const next = await workflowApi.archives();
                            setArchives(next.archives);
                            await onRefresh();
                          } catch (error) {
                            setArchiveError(error instanceof Error ? error.message : "恢复失败");
                          } finally {
                            setArchiveBusy(false);
                          }
                        })()
                      }
                    >
                      恢复
                    </button>
                  </article>
                ))}
                {!archives.length ? <p className="recipe-empty">还没有归档的工作流。</p> : null}
              </div>
              {archiveError ? <p className="form-error">{archiveError}</p> : null}
            </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
