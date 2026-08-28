import { useMemo, useRef, useState } from "react";
import {
  type WorkflowBindingDraft,
  type WorkflowBindingInspection,
  type WorkflowCapability,
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

export function RecipeStudio({
  busy,
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
  editorUrl: string;
  onClose: () => void;
  onImport: (file: File) => Promise<void>;
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
  const [inspection, setInspection] = useState<WorkflowBindingInspection | null>(null);
  const [bindingDraft, setBindingDraft] = useState<WorkflowBindingDraft | null>(null);
  const [bindingBusy, setBindingBusy] = useState(false);
  const [bindingError, setBindingError] = useState("");
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
      const result = await workflowApi.inspectBinding(workflow.path);
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
  ) => {
    setBindingDraft((current) => {
      if (!current) return current;
      const group = current[groupName] as Record<
        string,
        Array<{ nodeId: string; input: string }> | undefined
      >;
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
            : [...previous, { nodeId, input }],
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
                      {workflow.models
                        .slice(0, 2)
                        .map((model) => model.replace(/\.safetensors$/i, ""))
                        .join(" · ") || "未检测到固定模型"}
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
                    {workflow.execution === "bound" ? "检查映射" : "建立映射"}
                  </button>
                ) : null}
              </div>
            ))}
            {filtered.length === 0 ? (
              <div className="recipe-empty">这个分类还没有 Workflow。拖入 JSON 后会自动检测。</div>
            ) : null}
          </div>
          <div className="workflow-import-wrap">
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onImport(file);
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
                if (file) void onImport(file);
              }}
            >
              <span>↧</span>
              <strong>拖入 ComfyUI Workflow JSON</strong>
              <p>导入后先检查节点映射与依赖；只有你明确信任并通过预检后才能直接运行。</p>
              <i>选择 JSON</i>
            </button>
          </div>
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
                  <span className="section-kicker">WORKFLOW BINDING · V1</span>
                  <h3>建立 TakeBoard 参数映射</h3>
                  <p>{inspection.path}</p>
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
                  {(inspection.conversionIssues?.length ?? 0) > 0 ? (
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
                                      toggleTarget(
                                        "parameters",
                                        key,
                                        candidate.nodeId,
                                        candidate.input,
                                      )
                                    }
                                  />
                                  <span>{candidate.label}</span>
                                  <code>{candidate.nodeId}</code>
                                </label>
                              ))
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
                                  <code>{candidate.nodeId}</code>
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
                <button
                  type="button"
                  onClick={() => void saveBinding()}
                  disabled={
                    !bindingDraft || bindingBusy || Boolean(inspection.conversionIssues?.length)
                  }
                >
                  {bindingBusy ? "正在验证…" : "信任此工作流并启用"}
                </button>
              </footer>
            </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
