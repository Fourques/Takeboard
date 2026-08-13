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
  warnings: string[];
  workflows: WorkflowSummary[];
}) {
  const [group, setGroup] = useState<"all" | WorkflowCapability>("all");
  const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const filtered = useMemo(
    () =>
      workflows.filter(
        (workflow) =>
          (group === "all" || workflow.capability === group) &&
          `${workflow.name} ${workflow.models.join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [group, query, workflows],
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
              已从当前 ComfyUI 自动检测 {workflows.length} 个 Workflow
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
                onClick={() => onSelect(workflow)}
              >
                <span className={`recipe-icon capability-${workflow.capability}`}>
                  {capabilityIcon[workflow.capability]}
                </span>
                <span className="recipe-copy">
                  <strong>{workflow.name}</strong>
                  <small>
                    {workflow.capabilityLabel} · {workflow.nodeCount} 节点
                  </small>
                  <span>
                    {workflow.models
                      .slice(0, 2)
                      .map((model) => model.replace(/\.safetensors$/i, ""))
                      .join(" · ") || "未检测到固定模型"}
                  </span>
                </span>
                <i className={workflow.execution === "native" ? "native" : "comfy"}>
                  {workflow.execution === "native" ? "原生" : "Comfy"}
                </i>
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
            <i /> TakeBoard 参数层保持简洁；节点级编辑仍由 ComfyUI 完成
          </div>
          <a href={selectedEditorUrl} target="_blank" rel="noreferrer">
            进入 ComfyUI 深度编辑 ↗
          </a>
        </footer>
      </aside>
    </div>
  );
}
