import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
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
import { compareWorkflows, isLibraryWorkflow, workflowAvailability } from "./workflow-library";

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
  fontSize: "12px",
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
  minHeight: "32px",
  border: "1px solid var(--line)",
  borderRadius: "5px",
  color: "var(--text-1)",
  background: "var(--surface-1)",
  fontSize: "12px",
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
  const [origin, setOrigin] = useState<"mine" | "templates" | "all">("mine");
  const [libraryBusy, setLibraryBusy] = useState<string | null>(null);
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [onlyReady, setOnlyReady] = useState(false);
  const updateLibrary = async (
    workflow: WorkflowSummary,
    entry: { name?: string; included?: boolean; favorite?: boolean },
  ) => {
    if (libraryBusy) return;
    setLibraryBusy(workflow.path);
    setBindingError("");
    try {
      await workflowApi.updateLibrary(workflow.path, entry);
      await onRefresh();
      setRenamePath(null);
    } catch (cause) {
      setBindingError(cause instanceof Error ? cause.message : "列表更新失败");
    } finally {
      setLibraryBusy(null);
    }
  };
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
  const inspectionRequest = useRef(0);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  useEffect(() => {
    if (!open) return;
    let active = true;
    void refreshRef.current().catch((error: unknown) => {
      if (active) setBindingError(error instanceof Error ? error.message : "检查失败，请重试");
    });
    return () => {
      active = false;
    };
  }, [open]);
  const filtered = useMemo(
    () =>
      workflows
        .filter(
          (workflow) =>
            (group === "all" || workflow.capability === group) &&
            (origin === "all" ||
              (origin === "mine" ? isLibraryWorkflow(workflow) : workflow.origin === "built_in")) &&
            (!onlyReady || workflowAvailability(workflow).ready) &&
            `${workflow.name} ${workflow.models.join(" ")}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort(compareWorkflows),
    [group, origin, onlyReady, query, workflows],
  );
  const selectedEditorUrl = selectedPath
    ? `${editorUrl}/?takeboard_workflow=${encodeURIComponent(selectedPath)}`
    : editorUrl;

  const configureBinding = async (workflow: Pick<WorkflowSummary, "path" | "bindingStatus">) => {
    const ticket = ++inspectionRequest.current;
    setBindingBusy(true);
    setBindingError("");
    setInspection({ path: workflow.path, status: workflow.bindingStatus ?? "needs_binding" });
    setBindingDraft(null);
    try {
      const result = await workflowApi.inspectWorkflow(workflow.path);
      if (ticket !== inspectionRequest.current) return;
      setInspection(result);
      setBindingDraft(result.binding ?? result.suggested ?? null);
    } catch (error) {
      if (ticket !== inspectionRequest.current) return;
      setBindingError(error instanceof Error ? error.message : "无法分析该工作流");
      setInspection({ path: workflow.path, status: "needs_binding" });
      setBindingDraft(null);
    } finally {
      if (ticket === inspectionRequest.current) setBindingBusy(false);
    }
  };

  const createEditableCopy = async (path: string) => {
    setPackageBusy(true);
    setBindingError("");
    try {
      const copied = await workflowApi.copy(path);
      await onRefresh();
      setOrigin("mine");
      await configureBinding(copied);
    } catch (cause) {
      setBindingError(cause instanceof Error ? cause.message : "副本创建失败");
    } finally {
      setPackageBusy(false);
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
          ? "已导入。核对输入与参数后即可启用。"
          : "已保存工作流，完成检查后才能启用。",
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
            <h2>选择工作流</h2>
            <p>
              {selectionLocked ? "当前镜头已有结果，工作流已锁定" : `${workflows.length} 个工作流`}
              {warnings.length > 0 ? ` · ${warnings.length} 条检查提示` : ""}
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
              {busy ? "检查中…" : "重新检查"}
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
              ["mine", "我的工作流"],
              ["templates", "模板库"],
              ["all", "全部发现"],
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
            placeholder="搜索名称或模型"
            aria-label="搜索工作流"
          />
          <label className="recipe-ready-filter">
            <input
              type="checkbox"
              checked={onlyReady}
              onChange={(event) => setOnlyReady(event.target.checked)}
            />
            仅显示可用
          </label>
        </div>
        <div className="recipe-body">
          <div className="recipe-list">
            {filtered.map((workflow) => (
              <div className="recipe-card-wrap" key={workflow.path}>
                <button
                  type="button"
                  className={`recipe-card ${selectedPath === workflow.path ? "selected" : ""}`}
                  disabled={selectionLocked || !isLibraryWorkflow(workflow)}
                  onClick={() => {
                    if (
                      !workflowAvailability(workflow).ready ||
                      workflow.diagnostic?.health === "attention"
                    )
                      void configureBinding(workflow);
                    else onSelect(workflow);
                  }}
                >
                  <span className={`recipe-icon capability-${workflow.capability}`}>
                    {capabilityIcon[workflow.capability]}
                  </span>
                  <span className="recipe-copy">
                    <strong>
                      {workflow.library?.favorite ? "★ " : ""}
                      {workflow.name}
                    </strong>
                    <small>{workflow.capabilityLabel}</small>
                    <span>
                      {workflow.models
                        .slice(0, 2)
                        .map((model) => model.replace(/\.safetensors$/i, ""))
                        .join(" · ") || "未检测到固定模型"}
                    </span>
                  </span>
                  <i
                    className={`${workflow.execution === "native" || workflow.execution === "bound" ? "native" : "comfy"} model-${workflow.modelStatus ?? "unknown"}`}
                  >
                    {workflowAvailability(workflow).label}
                  </i>
                  <b className={`workflow-origin origin-${workflow.origin ?? "comfyui"}`}>
                    {workflow.origin === "built_in"
                      ? "模板"
                      : workflow.origin === "imported"
                        ? "我的"
                        : "ComfyUI"}
                  </b>
                </button>
                <div className="recipe-library-actions">
                  <button type="button" onClick={() => void configureBinding(workflow)}>
                    {workflow.execution === "native" ? "查看检查" : "检查与配置"}
                  </button>
                  {canManageWorkflows ? (
                    <>
                      {!isLibraryWorkflow(workflow) ? (
                        <button
                          type="button"
                          disabled={libraryBusy !== null}
                          onClick={() =>
                            void updateLibrary(workflow, { included: !isLibraryWorkflow(workflow) })
                          }
                        >
                          添加到我的工作流
                        </button>
                      ) : null}
                      <details>
                        <summary>更多</summary>
                        <div className="recipe-library-actions">
                          <button
                            type="button"
                            disabled={libraryBusy !== null}
                            aria-pressed={Boolean(workflow.library?.favorite)}
                            onClick={() =>
                              void updateLibrary(workflow, {
                                favorite: !workflow.library?.favorite,
                              })
                            }
                          >
                            {workflow.library?.favorite ? "取消收藏" : "收藏"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRenamePath(workflow.path);
                              setRenameValue(workflow.name);
                            }}
                          >
                            重命名
                          </button>
                          {isLibraryWorkflow(workflow) ? (
                            <button
                              type="button"
                              disabled={libraryBusy !== null}
                              onClick={() => void updateLibrary(workflow, { included: false })}
                            >
                              从列表移除
                            </button>
                          ) : null}
                          <a href={workflowApi.recipePackageUrl(workflow.path)} download>
                            导出工作流包
                          </a>
                          {workflow.origin === "imported" ? (
                            <button
                              type="button"
                              disabled={archiveBusy}
                              onClick={() => void previewArchive(workflow)}
                            >
                              归档文件
                            </button>
                          ) : null}
                        </div>
                      </details>
                    </>
                  ) : null}
                </div>
                {renamePath === workflow.path ? (
                  <form
                    className="recipe-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void updateLibrary(workflow, { name: renameValue.trim() });
                    }}
                  >
                    <input
                      aria-label="工作流名称"
                      value={renameValue}
                      maxLength={100}
                      onChange={(event) => setRenameValue(event.target.value)}
                    />
                    <button type="submit" disabled={!renameValue.trim() || libraryBusy !== null}>
                      保存
                    </button>
                    <button type="button" onClick={() => setRenamePath(null)}>
                      取消
                    </button>
                  </form>
                ) : null}
              </div>
            ))}
            {filtered.length === 0 ? (
              <div className="recipe-empty">
                {origin === "mine"
                  ? "还没有匹配的工作流。可以从模板库添加，或导入自己的工作流。"
                  : "没有匹配的工作流。"}
              </div>
            ) : null}
          </div>
          {canManageWorkflows ? (
            <div className="workflow-import-wrap">
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json,image/png,.png,application/gzip,.tgz,.takeboard-recipe.tgz"
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
                <strong>{packageBusy ? "正在导入…" : "导入工作流"}</strong>
                <p>JSON、包含工作流的 PNG，或 TakeBoard 工作流包</p>
                <i>导入后检查依赖与输入配置</i>
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
                  <h3>{inspection.status === "built_in" ? "工作流检查" : "工作流配置"}</h3>
                  <p>
                    {advanced || inspection.status === "built_in"
                      ? inspection.path
                      : "设置画布参数与工作流的对应关系"}
                  </p>
                  {inspection.path === packageNoticePath && packageNotice ? (
                    <div className="recipe-package-notice">{packageNotice}</div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    inspectionRequest.current++;
                    setInspection(null);
                    setBindingBusy(false);
                  }}
                  aria-label="关闭映射面板"
                >
                  ×
                </button>
              </header>
              <div className="recipe-library-actions">
                <button
                  type="button"
                  disabled={bindingBusy}
                  onClick={() => {
                    const workflow = workflows.find((item) => item.path === inspection.path);
                    if (workflow) void configureBinding(workflow);
                    else void configureBinding({ path: inspection.path });
                  }}
                >
                  重新检查
                </button>
                <a
                  href={`${editorUrl}/?takeboard_workflow=${encodeURIComponent(inspection.path)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  在 ComfyUI 编辑 ↗
                </a>
                <a href={workflowApi.rawUrl(inspection.path)} download>
                  下载 JSON
                </a>
              </div>
              {bindingBusy && !bindingDraft ? (
                <div className="binding-loading">正在读取真实工作流与节点定义…</div>
              ) : null}
              {inspection.status === "built_in" && inspection.diagnostic ? (
                <div className="binding-editor-body">
                  <p>
                    此模板使用 TakeBoard
                    原生适配。需要修改节点时，请创建可编辑副本；副本按实际节点配置运行。
                  </p>
                  {canManageWorkflows ? (
                    <button
                      type="button"
                      disabled={packageBusy}
                      onClick={() => void createEditableCopy(inspection.path)}
                    >
                      创建可编辑副本
                    </button>
                  ) : null}
                  <div className="workflow-diagnostic-grid">
                    {inspection.diagnostic.checks.map((check) => (
                      <article key={check.id} className={`diagnostic-${check.status}`}>
                        <i>{check.status === "pass" ? "✓" : "!"}</i>
                        <div>
                          <strong>{check.title}</strong>
                          <p>{check.detail}</p>
                          {check.remediation ? <small>{check.remediation}</small> : null}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
              {inspection.status !== "built_in" && bindingDraft && inspection.candidates ? (
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
                {inspection.diagnostic?.executable &&
                !bindingBusy &&
                !selectionLocked &&
                workflows.some(
                  (item) => item.path === inspection.path && isLibraryWorkflow(item),
                ) ? (
                  <button
                    type="button"
                    onClick={() => {
                      const workflow = workflows.find((item) => item.path === inspection.path);
                      if (workflow) onSelect(workflow);
                    }}
                  >
                    使用此工作流
                  </button>
                ) : null}
                {inspection.status === "built_in" ? (
                  <span>内置工作流</span>
                ) : canManageWorkflows ? (
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
