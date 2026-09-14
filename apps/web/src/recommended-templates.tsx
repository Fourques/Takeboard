import type { RecommendedWorkflowTemplate } from "@takeboard/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { workflowApi } from "./api";
import { workflowCheckGuidance } from "./workflow-library";

export function RecommendedTemplates({
  canManage,
  query,
  capability,
  onlyReady,
  onAdded,
}: {
  canManage: boolean;
  query: string;
  capability: string;
  onlyReady: boolean;
  onAdded: () => Promise<void>;
}) {
  const [templates, setTemplates] = useState<RecommendedWorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++epoch.current;
    setLoading(true);
    try {
      const result = await workflowApi.templates();
      if (ticket === epoch.current) {
        setTemplates(result.templates);
        setError("");
      }
    } catch (cause) {
      if (ticket === epoch.current) {
        setTemplates([]);
        setError(cause instanceof Error ? cause.message : "模板检查未完成，请重试。");
      }
    } finally {
      if (ticket === epoch.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const changed = () => {
      setTemplates([]);
      setNotice("");
      void refresh();
    };
    window.addEventListener("takeboard:generation-connection-changed", changed);
    return () => {
      epoch.current++;
      window.removeEventListener("takeboard:generation-connection-changed", changed);
    };
  }, [refresh]);
  const install = async (template: RecommendedWorkflowTemplate) => {
    if (!template.confirmationToken || installing) return;
    const ticket = epoch.current;
    setInstalling(template.id);
    setError("");
    setNotice("");
    try {
      await workflowApi.installTemplate(template.id, template.confirmationToken);
      if (ticket !== epoch.current) return;
      await onAdded();
      if (ticket !== epoch.current) return;
      setNotice(`已添加：${template.name}`);
      await refresh();
    } catch (cause) {
      if (ticket === epoch.current)
        setError(cause instanceof Error ? cause.message : "添加未完成，请重新检查。");
    } finally {
      setInstalling(null);
    }
  };
  const filtered = templates.filter(
    (item) =>
      item.name.toLowerCase().includes(query.toLowerCase()) &&
      (capability === "all" || item.capability === capability) &&
      (!onlyReady || item.confirmationToken),
  );
  return (
    <section className="recommended-templates" aria-label="TakeBoard 推荐模板">
      <header>
        <div>
          <h3>TakeBoard 推荐</h3>
          <p>添加到当前生成设备 · 仅模板文件，不下载模型</p>
        </div>
        <button
          type="button"
          disabled={loading || Boolean(installing)}
          onClick={() => void refresh()}
        >
          {loading ? "检查中…" : "检查推荐模板"}
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!loading && !error && !filtered.length ? <p>没有匹配的推荐模板</p> : null}
      {filtered.map((template) => {
        const blocker = template.diagnostic?.checks.find((item) => item.status === "blocked");
        const unresolved =
          blocker ?? template.diagnostic?.checks.find((item) => item.status === "unknown");
        const problem =
          template.problem ??
          (!template.confirmationToken && unresolved ? workflowCheckGuidance(unresolved) : null);
        const dependencies = [
          ...(template.diagnostic?.missingModels ?? []),
          ...(template.diagnostic?.missingNodeTypes ?? []),
        ];
        return (
          <article key={template.id} className="recommended-template">
            <div>
              <strong>{template.name}</strong>
              <small title={`模板版本 ${template.version}`}>
                {template.confirmationToken
                  ? "可用"
                  : blocker?.code === "TAKEBOARD_NATIVE_TEMPLATE_INCOMPATIBLE" ||
                      template.installation === "different"
                    ? "需要更新"
                    : "不可用"}
                {" · "}
                {Math.max(1, Math.ceil(template.bytes / 1024))} KB
              </small>
            </div>
            {problem ? <p>{problem}</p> : null}
            {dependencies.length > 0 ? (
              <details className="workflow-check-details">
                <summary>查看缺少的模型与组件</summary>
                <ul>
                  {dependencies.map((dependency) => (
                    <li key={dependency}>{dependency}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            <div className="recipe-library-actions">
              {canManage ? (
                <button
                  type="button"
                  disabled={
                    loading ||
                    Boolean(installing) ||
                    !template.confirmationToken ||
                    template.included
                  }
                  onClick={() => void install(template)}
                >
                  {installing === template.id
                    ? "正在添加…"
                    : template.included
                      ? "已添加"
                      : "添加模板"}
                </button>
              ) : null}
              <a href={workflowApi.templateDownloadUrl(template.id)} download>
                下载 JSON
              </a>
              {template.diagnostic?.checks.some((item) => item.status === "blocked") ? (
                <a
                  href="https://docs.comfy.org/interface/features/template"
                  target="_blank"
                  rel="noreferrer"
                >
                  配置说明 ↗
                </a>
              ) : null}
            </div>
          </article>
        );
      })}
    </section>
  );
}
