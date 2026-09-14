import type { WorkflowDiagnostic } from "@takeboard/contracts";
import { workflowCheckGuidance } from "./workflow-library";

/** Ordinary users see blockers; full evidence remains available for troubleshooting. */
export function WorkflowCheckPanel({ diagnostic }: { diagnostic: WorkflowDiagnostic }) {
  const blockers = diagnostic.checks.filter((item) => item.status === "blocked");
  return (
    <div className="workflow-check-panel">
      {blockers.length ? (
        <div className="workflow-diagnostic-grid">
          {blockers.map((item) => (
            <article key={item.id} className="diagnostic-blocked">
              <div>
                <strong>
                  {item.category === "models"
                    ? "需要补齐模型"
                    : item.category === "nodes"
                      ? "模板与生成设备不兼容"
                      : "需要完成设置"}
                </strong>
                <p>{workflowCheckGuidance(item)}</p>
                {item.code === "COMFY_NODE_TYPES_MISSING" ||
                item.code === "COMFY_MODELS_MISSING" ? (
                  <a
                    href={
                      item.code === "COMFY_NODE_TYPES_MISSING"
                        ? "https://support.comfy.org/articles/1536450065-missing-nodes-workflow-won-t-load"
                        : "https://docs.comfy.org/interface/features/template#model-storage-location"
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    安装说明 ↗
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p role="status">{diagnostic.executable ? "可用" : "尚未完成检查，请重新检查。"}</p>
      )}
      <details className="workflow-check-details">
        <summary>技术详情</summary>
        {diagnostic.checks.map((item) => (
          <div key={item.id}>
            <strong>{item.title}</strong>
            <p>{item.detail}</p>
            {item.remediation ? <p>{item.remediation}</p> : null}
            <code>{item.code}</code>
          </div>
        ))}
      </details>
    </div>
  );
}
