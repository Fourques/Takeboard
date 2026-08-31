import type {
  ExtensionFeature,
  ExtensionManifest,
  ExtensionQcIssue,
  InstalledExtension,
} from "@takeboard/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { extensionApi } from "./api";

const extensionCss = `.extension-backdrop{position:fixed;z-index:270;inset:0;display:grid;padding:clamp(10px,2vw,28px);place-items:center;background:color-mix(in srgb,var(--surface-root) 78%,transparent);backdrop-filter:blur(18px)}.extension-shell{display:grid;width:min(1180px,100%);height:min(820px,100%);min-height:0;overflow:hidden;border:1px solid color-mix(in srgb,var(--line) 82%,var(--accent) 18%);border-radius:18px;color:var(--text-1);background:var(--surface-1);box-shadow:0 34px 100px rgb(0 0 0/46%);grid-template-rows:auto auto minmax(0,1fr)}.extension-header{display:flex;align-items:flex-start;justify-content:space-between;padding:24px 28px 17px;gap:20px}.extension-header span,.extension-card>header span,.extension-install-review>span,.extension-qc-heading span{color:var(--accent-strong);font-size:calc(8px*var(--ui-scale));font-weight:900;letter-spacing:.13em}.extension-header h2{margin:5px 0 4px;font-size:calc(27px*var(--ui-scale));font-weight:590;letter-spacing:-.035em}.extension-header p{max-width:660px;margin:0;color:var(--text-2);font-size:calc(10px*var(--ui-scale));line-height:1.55}.extension-header button{display:grid;width:34px;height:34px;padding:0;place-items:center;border:1px solid var(--line);border-radius:9px;color:var(--text-2);background:var(--surface-2);cursor:pointer;font-size:20px}.extension-tabs{display:flex;padding:0 28px 14px;border-bottom:1px solid var(--line);gap:6px}.extension-tabs button{min-height:31px;padding:0 11px;border:1px solid transparent;border-radius:7px;color:var(--text-2);background:transparent;cursor:pointer;font-size:calc(10px*var(--ui-scale))}.extension-tabs button.active{border-color:var(--line);color:var(--text-1);background:var(--surface-2)}.extension-body{min-height:0;overflow:auto;padding:18px 28px 28px}.extension-toolbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:12px}.extension-safety{display:flex;align-items:center;color:var(--text-2);font-size:calc(9px*var(--ui-scale));gap:7px}.extension-safety i{width:7px;height:7px;border-radius:50%;background:var(--green)}.extension-toolbar-actions{display:flex;gap:7px}.extension-toolbar button,.extension-card button,.extension-install-review button{min-height:32px;padding:0 10px;border:1px solid var(--line);border-radius:7px;color:var(--text-2);background:var(--surface-2);cursor:pointer;font-size:calc(9px*var(--ui-scale))}.extension-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}.extension-card{display:grid;min-height:210px;padding:15px;border:1px solid var(--line);border-radius:12px;background:color-mix(in srgb,var(--surface-2) 70%,transparent);gap:12px}.extension-card.disabled{border-style:dashed;background:color-mix(in srgb,var(--surface-2) 46%,transparent)}.extension-card>header{display:flex;justify-content:space-between;gap:12px}.extension-card h3{margin:3px 0;font-size:calc(15px*var(--ui-scale));font-weight:620}.extension-card header small{color:var(--text-2);font-size:calc(8px*var(--ui-scale))}.extension-card header>b{height:fit-content;padding:4px 6px;border:1px solid var(--line);border-radius:99px;color:var(--text-2);font-size:calc(7px*var(--ui-scale));font-weight:800}.extension-card>p{margin:0;color:var(--text-2);font-size:calc(10px*var(--ui-scale));line-height:1.55}.extension-contributions{display:flex;flex-wrap:wrap;align-content:start;gap:5px}.extension-contributions span{padding:4px 6px;border:1px solid var(--line);border-radius:5px;color:var(--text-2);font-size:calc(8px*var(--ui-scale))}.extension-links{display:grid;gap:5px}.extension-links a{display:flex;justify-content:space-between;padding:7px 8px;border:1px solid var(--line);border-radius:6px;color:var(--text-2);text-decoration:none;font-size:calc(9px*var(--ui-scale))}.extension-card-actions{display:flex;align-items:end;justify-content:flex-end;margin-top:auto;gap:6px}.extension-card-actions button.danger{color:var(--red)}.extension-card-actions p{width:100%;margin:0;color:var(--red);font-size:calc(8px*var(--ui-scale))}.extension-error{margin:0 0 10px;padding:8px 10px;border:1px solid color-mix(in srgb,var(--red) 38%,var(--line));border-radius:7px;color:var(--red);background:color-mix(in srgb,var(--red) 7%,transparent);font-size:calc(9px*var(--ui-scale))}.extension-install-review{display:grid;margin-bottom:14px;padding:15px;border:1px solid color-mix(in srgb,var(--accent) 35%,var(--line));border-radius:11px;background:color-mix(in srgb,var(--accent) 5%,var(--surface-2));gap:8px}.extension-install-review h3{margin:0;font-size:calc(16px*var(--ui-scale))}.extension-install-review p,.extension-install-review li{margin:0;color:var(--text-2);font-size:calc(9px*var(--ui-scale));line-height:1.5}.extension-install-review ul{margin:0;padding-left:17px}.extension-install-actions{display:flex;justify-content:flex-end;gap:7px}.extension-install-actions button:last-child{border-color:var(--accent);color:var(--surface-root);background:var(--accent-strong);font-weight:700}.extension-qc-heading{display:flex;align-items:end;justify-content:space-between;margin-bottom:14px;gap:12px}.extension-qc-heading h3{margin:4px 0 0;font-size:calc(20px*var(--ui-scale));font-weight:590}.extension-qc-heading p{margin:0;color:var(--faint);font-size:calc(9px*var(--ui-scale))}.extension-qc-list{display:grid;gap:7px}.extension-qc-check{display:grid;align-items:center;padding:12px;border:1px solid var(--line);border-radius:9px;background:color-mix(in srgb,var(--surface-2) 68%,transparent);grid-template-columns:9px minmax(0,1fr) auto;gap:10px}.extension-qc-check>i{width:8px;height:8px;border-radius:50%;background:var(--green)}.extension-qc-check.has-issues>i{background:var(--yellow)}.extension-qc-check.severity-blocker.has-issues>i{background:var(--red)}.extension-qc-check>div{display:grid;gap:2px}.extension-qc-check strong{font-size:calc(11px*var(--ui-scale))}.extension-qc-check span{color:var(--text-2);font-size:calc(9px*var(--ui-scale))}.extension-qc-check b{font:calc(11px*var(--ui-scale)) ui-monospace,monospace}.extension-empty{display:grid;min-height:220px;place-items:center;border:1px dashed var(--line);border-radius:10px;color:var(--faint);font-size:calc(10px*var(--ui-scale))}@media(max-width:680px){.extension-header{padding:18px}.extension-tabs{padding-inline:18px}.extension-body{padding:14px 18px}.extension-toolbar,.extension-qc-heading{align-items:flex-start;flex-direction:column}.extension-grid{grid-template-columns:1fr}}`;

type Inspection = Awaited<ReturnType<typeof extensionApi.inspect>>;

const manifestTemplate: ExtensionManifest = {
  format: "takeboard.extension",
  manifestVersion: 1,
  id: "studio.example.creator-tools",
  name: "创作者工具箱",
  version: "1.0.0",
  description: "一组声明式质检规则与外部工具入口。",
  author: "Your Studio",
  homepage: null,
  permissions: ["project.read", "network.open"],
  contributions: {
    features: [],
    links: [
      {
        id: "style-guide",
        title: "视觉规范",
        description: "打开团队维护的视觉规范。",
        url: "https://example.com/style-guide",
        category: "utility",
      },
    ],
    qcRules: [
      {
        id: "no-open-shots",
        title: "镜头必须有候选",
        description: "交付前检查仍无候选的镜头。",
        check: "shots_without_candidates",
        severity: "warning",
      },
    ],
  },
};

function permissionLabel(permission: string) {
  if (permission === "project.read") return "读取项目状态";
  if (permission === "project.write") return "修改项目决策";
  if (permission === "network.open") return "打开外部链接";
  return permission;
}

function featureLabel(feature: ExtensionFeature) {
  if (feature === "storyboard.rough_cut") return "粗剪视图";
  if (feature === "production.cost_insights") return "成本工作台";
  return "批量审片";
}

export function ExtensionLibrary({
  projectKey,
  canManage,
  onClose,
}: {
  projectKey: string | null;
  canManage: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"library" | "qc">("library");
  const [extensions, setExtensions] = useState<InstalledExtension[]>([]);
  const [checks, setChecks] = useState<ExtensionQcIssue[]>([]);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLElement>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [library, qc] = await Promise.all([
        extensionApi.list(),
        projectKey ? extensionApi.qc(projectKey) : Promise.resolve({ checks: [] }),
      ]);
      setExtensions(library.extensions);
      setChecks(qc.checks);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取扩展库");
    } finally {
      setBusy(false);
    }
  }, [projectKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [
        ...dialog.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    // Capture lets the modal consume Escape before workspace-level shortcuts.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus();
    };
  }, [onClose]);

  const inspectFile = async (file: File) => {
    setError(null);
    setInspection(null);
    if (file.size > 256 * 1024) {
      setError("扩展清单不能超过 256 KB");
      return;
    }
    try {
      const manifest = JSON.parse(await file.text()) as unknown;
      setInspection(await extensionApi.inspect(manifest));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取扩展清单");
    }
  };

  const install = async () => {
    if (!inspection) return;
    setBusy(true);
    setError(null);
    try {
      await extensionApi.install(inspection.manifest, inspection.confirmationToken);
      setInspection(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法安装扩展");
      setBusy(false);
    }
  };

  const copyTemplate = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(`${JSON.stringify(manifestTemplate, null, 2)}\n`);
      setError(null);
    } catch {
      setError("浏览器未允许写入剪贴板，请下载或手动复制扩展模板");
    }
  };

  const setEnabled = async (extension: InstalledExtension) => {
    setBusy(true);
    setError(null);
    try {
      await extensionApi.setEnabled(extension.manifest.id, !extension.enabled);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法更新扩展");
      setBusy(false);
    }
  };

  const removeExtension = async (extensionId: string) => {
    setBusy(true);
    setError(null);
    try {
      await extensionApi.remove(extensionId);
      setRemovingId(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法移除扩展");
      setBusy(false);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the non-content backdrop closes the modal; Escape and the explicit close button remain available.
    <div
      className="extension-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <style>{extensionCss}</style>
      <section
        className="extension-shell"
        role="dialog"
        aria-modal="true"
        aria-label="TakeBoard 扩展库"
        ref={dialog}
        tabIndex={-1}
      >
        <header className="extension-header">
          <div>
            <span>EXTENSION LIBRARY</span>
            <h2>扩展库</h2>
            <p>
              把可选工具、团队规则与第三方入口装进统一清单。当前只运行声明式贡献，不执行第三方代码。
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭扩展库">
            ×
          </button>
        </header>
        <div className="extension-tabs" role="tablist" aria-label="扩展库视图">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "library"}
            className={tab === "library" ? "active" : ""}
            onClick={() => setTab("library")}
          >
            已安装
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "qc"}
            className={tab === "qc" ? "active" : ""}
            onClick={() => setTab("qc")}
          >
            项目质检 {checks.filter((check) => check.count > 0).length}
          </button>
        </div>
        <div className="extension-body">
          {error ? (
            <p className="extension-error" role="alert">
              {error}
            </p>
          ) : null}
          {tab === "library" ? (
            <>
              <div className="extension-toolbar">
                <div className="extension-safety">
                  <i /> 声明式运行时 · 第三方代码执行已关闭
                </div>
                <div className="extension-toolbar-actions">
                  <button type="button" onClick={() => void copyTemplate()}>
                    复制开发模板
                  </button>
                  {canManage ? (
                    <button type="button" onClick={() => fileInput.current?.click()}>
                      导入清单
                    </button>
                  ) : null}
                  <input
                    ref={fileInput}
                    className="visually-hidden"
                    type="file"
                    aria-label="选择扩展清单 JSON 文件"
                    accept=".json,application/json"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void inspectFile(file);
                    }}
                  />
                </div>
              </div>
              {inspection ? (
                <section className="extension-install-review">
                  <span>INSTALL REVIEW</span>
                  <h3>
                    {inspection.manifest.name} · {inspection.manifest.version}
                  </h3>
                  <p>{inspection.manifest.description}</p>
                  <ul>
                    {inspection.manifest.contributions.features.map((feature) => (
                      <li key={feature}>功能：{featureLabel(feature)}</li>
                    ))}
                    {inspection.permissions.map((permission) => (
                      <li key={permission}>权限：{permissionLabel(permission)}</li>
                    ))}
                    {inspection.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                  <p>内容指纹：{inspection.contentSha256.slice(0, 16)}…</p>
                  <div className="extension-install-actions">
                    <button type="button" onClick={() => setInspection(null)}>
                      取消
                    </button>
                    <button type="button" disabled={busy} onClick={() => void install()}>
                      信任并安装（默认停用）
                    </button>
                  </div>
                </section>
              ) : null}
              <div className="extension-grid">
                {extensions.map((extension) => (
                  <article
                    className={`extension-card ${extension.enabled ? "" : "disabled"}`}
                    key={extension.manifest.id}
                  >
                    <header>
                      <div>
                        <span>
                          {extension.source === "built_in" ? "BUNDLED" : "LOCAL MANIFEST"}
                        </span>
                        <h3>{extension.manifest.name}</h3>
                        <small>
                          {extension.manifest.author} · v{extension.manifest.version}
                        </small>
                      </div>
                      <b>{extension.enabled ? "已启用" : "已停用"}</b>
                    </header>
                    <p>{extension.manifest.description}</p>
                    <div className="extension-contributions">
                      {extension.manifest.contributions.features.map((feature) => (
                        <span key={feature}>{featureLabel(feature)}</span>
                      ))}
                      {extension.manifest.contributions.qcRules.length ? (
                        <span>{extension.manifest.contributions.qcRules.length} 项质检</span>
                      ) : null}
                      {extension.manifest.contributions.links.length ? (
                        <span>{extension.manifest.contributions.links.length} 个工具入口</span>
                      ) : null}
                      {extension.manifest.permissions.map((permission) => (
                        <span key={permission}>{permissionLabel(permission)}</span>
                      ))}
                    </div>
                    {extension.enabled && extension.manifest.contributions.links.length ? (
                      <div className="extension-links">
                        {extension.manifest.contributions.links.map((link) => (
                          <a
                            key={link.id}
                            href={link.url}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            <span>{link.title}</span>
                            <b>↗</b>
                          </a>
                        ))}
                      </div>
                    ) : null}
                    <div className="extension-card-actions">
                      {removingId === extension.manifest.id ? (
                        <p>再次点击“确认移除”；清单可重新导入。</p>
                      ) : null}
                      {canManage ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void setEnabled(extension)}
                        >
                          {extension.enabled ? "停用" : "启用"}
                        </button>
                      ) : null}
                      {canManage && extension.source !== "built_in" ? (
                        <button
                          type="button"
                          className="danger"
                          disabled={busy}
                          onClick={() => {
                            if (removingId !== extension.manifest.id) {
                              setRemovingId(extension.manifest.id);
                              return;
                            }
                            void removeExtension(extension.manifest.id);
                          }}
                        >
                          {removingId === extension.manifest.id ? "确认移除" : "移除"}
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="extension-qc-heading">
                <div>
                  <span>PROJECT CHECKS</span>
                  <h3>交付前检查</h3>
                </div>
                <p>规则读取结构化项目状态，不读取媒体内容，也不执行外部脚本。</p>
              </div>
              <div className="extension-qc-list">
                {checks.map((check) => (
                  <article
                    className={`extension-qc-check severity-${check.severity} ${check.count > 0 ? "has-issues" : ""}`}
                    key={`${check.extensionId}-${check.ruleId}`}
                  >
                    <i />
                    <div>
                      <strong>{check.title}</strong>
                      <span>{check.count > 0 ? check.description : "检查通过"}</span>
                    </div>
                    <b>{check.count}</b>
                  </article>
                ))}
                {!busy && checks.length === 0 ? (
                  <div className="extension-empty">当前项目没有启用质检规则</div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
