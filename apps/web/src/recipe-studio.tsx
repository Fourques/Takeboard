import { useMemo, useRef, useState } from "react";
import type { WorkflowCapability, WorkflowSummary } from "./api";

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
              <button
                type="button"
                key={workflow.path}
                className={`recipe-card ${selectedPath === workflow.path ? "selected" : ""}`}
                disabled={selectionLocked}
                onClick={() => onSelect(workflow)}
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
                  className={`${workflow.execution === "native" ? "native" : "comfy"} model-${workflow.modelStatus ?? "unknown"}`}
                >
                  {workflow.modelStatus === "missing"
                    ? "缺模型"
                    : workflow.modelStatus === "ready"
                      ? "可用"
                      : workflow.execution === "native"
                        ? "原生"
                        : "Comfy"}
                </i>
                <b className={`workflow-origin origin-${workflow.origin ?? "comfyui"}`}>
                  {workflow.origin === "built_in"
                    ? "内置"
                    : workflow.origin === "imported"
                      ? "我的"
                      : "ComfyUI"}
                </b>
              </button>
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
              <p>TakeBoard 会识别能力、输入槽位与所需模型，并保存到 ComfyUI/TakeBoard。</p>
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
      </aside>
    </div>
  );
}
