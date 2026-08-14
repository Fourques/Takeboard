import { useState } from "react";
import type { ProjectCatalogItem, WorkerStatus } from "./api";
import { ThemeSwitcher } from "./theme-switcher";

type NewProjectInput = {
  title: string;
  aspectRatio: string;
  sceneTitle: string;
  firstShotIntent: string;
};

function StudioScene() {
  return (
    <div className="studio-scene" aria-hidden="true">
      <div className="studio-orbit orbit-one" />
      <div className="studio-orbit orbit-two" />
      <div className="studio-board">
        <div className="studio-board-top">
          <i />
          <i />
          <i />
          <span>SHOT GRAPH / 01</span>
        </div>
        <div className="studio-wire wire-a" />
        <div className="studio-wire wire-b" />
        <div className="studio-node studio-asset">
          <span>REFERENCE</span>
          <strong>Character 01</strong>
        </div>
        <div className="studio-node studio-shot">
          <span>SHOT 03</span>
          <strong>夜景 · 缓慢推进</strong>
          <small>6s · 16:9</small>
        </div>
        <div className="studio-node studio-take">
          <span>TAKE 04</span>
          <strong>Approved</strong>
        </div>
      </div>
      <div className="studio-float float-prompt">
        <span>PROMPT</span>
        <b>镜头语言已锁定</b>
      </div>
      <div className="studio-float float-run">
        <i />
        <span>正在渲染</span>
        <b>68%</b>
      </div>
    </div>
  );
}

export function ProjectHub({
  busy,
  error,
  onCreate,
  onOpen,
  onOpenDemo,
  onRename,
  projects,
  worker,
}: {
  busy: boolean;
  error: string | null;
  onCreate: (input: NewProjectInput) => Promise<void>;
  onOpen: (key: string) => Promise<void>;
  onOpenDemo: () => Promise<void>;
  onRename: (key: string, title: string) => Promise<void>;
  projects: ProjectCatalogItem[];
  worker: WorkerStatus | null;
}) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ProjectCatalogItem | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [title, setTitle] = useState("");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [sceneTitle, setSceneTitle] = useState("第一场");
  const [firstShotIntent, setFirstShotIntent] = useState("");

  return (
    <main className="hub-shell">
      <div className="hub-ambient ambient-one" />
      <div className="hub-ambient ambient-two" />
      <header className="hub-header">
        <div className="brand hub-brand">
          <span className="brand-mark">T</span>
          <div>
            <strong>TakeBoard</strong>
            <span>OPEN FILMMAKING CANVAS</span>
          </div>
        </div>
        <div className="hub-header-actions">
          <ThemeSwitcher />
          <div className={`worker-pill worker-${worker?.status ?? "loading"}`}>
            <i />
            <div>
              <strong>
                {worker?.status === "ready"
                  ? "执行节点已就绪"
                  : worker?.status === "offline"
                    ? "执行节点离线"
                    : "正在检测执行节点"}
              </strong>
              <span>{worker?.engine ?? "可连接 ComfyUI"}</span>
            </div>
          </div>
        </div>
      </header>

      <section className="hub-hero">
        <div className="hub-hero-copy">
          <span className="section-kicker">
            <i /> LOCAL-FIRST CREATIVE STUDIO
          </span>
          <h1>
            让每一个镜头，
            <br />
            <em>都有来路。</em>
          </h1>
          <p>
            在一张可追溯的画布上组织剧本、角色、场景、工作流和每一次生成结果。开源模型与云端
            API，都由你的项目统一管理。
          </p>
          <div className="hub-hero-actions">
            <button className="new-project-button" type="button" onClick={() => setCreating(true)}>
              <span>＋</span> 新建项目
            </button>
            <button className="ghost-hero-button" type="button" onClick={() => void onOpenDemo()}>
              探索示例画布 <span>↗</span>
            </button>
          </div>
          <div className="hero-capabilities">
            <span>∞ 工作流</span>
            <span>◫ 资产库</span>
            <span>⌁ 镜头谱系</span>
          </div>
        </div>
        <StudioScene />
      </section>

      <section className="hub-projects">
        <div className="hub-section-heading">
          <div>
            <span className="section-kicker">YOUR PROJECTS</span>
            <h2>继续创作</h2>
          </div>
          <span className="project-count">{projects.length} 个项目</span>
        </div>
        <div className="project-grid">
          {projects.map((project, index) => (
            <article className="project-card" key={project.key}>
              <button
                className="project-open-area"
                type="button"
                onClick={() => void onOpen(project.key)}
                disabled={busy}
              >
                <div className={`project-card-art art-${(index % 3) + 1}`}>
                  <span className="project-number">{String(index + 1).padStart(2, "0")}</span>
                  <i className="mini-card-node mini-one" />
                  <i className="mini-card-node mini-two" />
                  <i className="mini-card-node mini-three" />
                  <i className="mini-card-line line-a" />
                  <i className="mini-card-line line-b" />
                  <span className="open-project-arrow">↗</span>
                </div>
                <div className="project-card-copy">
                  <strong>{project.title}</strong>
                  <span>
                    {project.sceneCount} 场 · {project.shotCount} 镜头 · {project.aspectRatio}
                  </span>
                  <small>{new Date(project.updatedAt).toLocaleString("zh-CN")}</small>
                </div>
              </button>
              <button
                className="project-rename-button"
                type="button"
                aria-label={`重命名 ${project.title}`}
                onClick={() => {
                  setRenaming(project);
                  setRenameTitle(project.title);
                }}
              >
                ✎
              </button>
            </article>
          ))}
          {projects.length === 0 ? (
            <button className="no-projects" type="button" onClick={() => setCreating(true)}>
              <span>＋</span>
              <strong>创建第一个项目</strong>
              <small>从场景和第一个镜头开始</small>
            </button>
          ) : null}
        </div>
      </section>

      {creating ? (
        <div className="modal-backdrop">
          <form
            className="new-project-modal"
            onSubmit={(event) => {
              event.preventDefault();
              void onCreate({ title, aspectRatio, sceneTitle, firstShotIntent });
            }}
          >
            <div className="modal-title">
              <div>
                <span className="section-kicker">NEW PROJECT</span>
                <h2>开始一部新作品</h2>
              </div>
              <button type="button" aria-label="关闭新建项目" onClick={() => setCreating(false)}>
                ×
              </button>
            </div>
            <label>
              项目名称
              <input
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：雾港来信"
              />
            </label>
            <div className="form-row">
              <label>
                默认画幅
                <select
                  value={aspectRatio}
                  onChange={(event) => setAspectRatio(event.target.value)}
                >
                  <option>9:16</option>
                  <option>16:9</option>
                  <option>1:1</option>
                  <option>4:5</option>
                  <option>2.35:1</option>
                </select>
              </label>
              <label>
                第一场名称
                <input value={sceneTitle} onChange={(event) => setSceneTitle(event.target.value)} />
              </label>
            </div>
            <label>
              第一个镜头意图
              <textarea
                value={firstShotIntent}
                onChange={(event) => setFirstShotIntent(event.target.value)}
                placeholder="人物做什么、镜头怎么动、观众应感受到什么（之后可修改）"
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="modal-actions">
              <span>项目数据保存在你配置的本地空间</span>
              <button type="submit" disabled={busy || !title.trim()}>
                {busy ? "正在创建…" : "创建并打开 →"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {renaming ? (
        <div className="modal-backdrop">
          <form
            className="rename-project-modal"
            onSubmit={(event) => {
              event.preventDefault();
              void onRename(renaming.key, renameTitle)
                .then(() => setRenaming(null))
                .catch(() => undefined);
            }}
          >
            <div className="modal-title">
              <div>
                <span className="section-kicker">RENAME PROJECT</span>
                <h2>修改项目名称</h2>
              </div>
              <button type="button" aria-label="关闭重命名" onClick={() => setRenaming(null)}>
                ×
              </button>
            </div>
            <label>
              新名称
              <input
                required
                maxLength={200}
                value={renameTitle}
                onChange={(event) => setRenameTitle(event.target.value)}
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="modal-actions">
              <span>文件夹标识保持不变，不会断开素材引用</span>
              <button type="submit" disabled={busy || !renameTitle.trim()}>
                {busy ? "正在保存…" : "保存名称"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
