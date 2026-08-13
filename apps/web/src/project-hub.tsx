import { useState } from "react";
import type { ProjectCatalogItem, WorkerStatus } from "./api";

type NewProjectInput = {
  title: string;
  aspectRatio: string;
  sceneTitle: string;
  firstShotIntent: string;
};

export function ProjectHub({
  busy,
  error,
  onCreate,
  onOpen,
  onOpenDemo,
  projects,
  worker,
}: {
  busy: boolean;
  error: string | null;
  onCreate: (input: NewProjectInput) => Promise<void>;
  onOpen: (key: string) => Promise<void>;
  onOpenDemo: () => Promise<void>;
  projects: ProjectCatalogItem[];
  worker: WorkerStatus | null;
}) {
  const [creating, setCreating] = useState(projects.length === 0);
  const [title, setTitle] = useState("");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [sceneTitle, setSceneTitle] = useState("第一场");
  const [firstShotIntent, setFirstShotIntent] = useState("");

  return (
    <main className="hub-shell">
      <header className="hub-header">
        <div className="brand hub-brand">
          <span className="brand-mark">T</span>
          <div>
            <strong>TakeBoard</strong>
            <span>OPEN FILMMAKING CANVAS</span>
          </div>
        </div>
        <div className={`worker-pill worker-${worker?.status ?? "loading"}`}>
          <i />
          <div>
            <strong>
              {worker?.status === "ready"
                ? "4090 工作站在线"
                : worker?.status === "offline"
                  ? "工作站离线"
                  : "正在连接工作站"}
            </strong>
            <span>{worker?.device ?? "ComfyUI worker"}</span>
          </div>
        </div>
      </header>
      <section className="hub-hero">
        <span className="section-kicker">YOUR FILM WORKSPACE</span>
        <h1>
          把一次抽卡，变成
          <br />
          可追溯的镜头生产。
        </h1>
        <p>项目、场景、素材、工作流和每一次 Take 都保存在你自己的 4090 上。</p>
        <button className="new-project-button" type="button" onClick={() => setCreating(true)}>
          <span>＋</span> 新建项目
        </button>
      </section>
      <section className="hub-projects">
        <div className="hub-section-heading">
          <div>
            <span className="section-kicker">RECENT PROJECTS</span>
            <h2>最近项目</h2>
          </div>
          <button type="button" onClick={() => void onOpenDemo()}>
            打开功能示例
          </button>
        </div>
        <div className="project-grid">
          {projects.map((project, index) => (
            <button
              className="project-card"
              type="button"
              key={project.key}
              onClick={() => void onOpen(project.key)}
              disabled={busy}
            >
              <div className={`project-card-art art-${(index % 3) + 1}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
              </div>
              <div className="project-card-copy">
                <strong>{project.title}</strong>
                <span>
                  {project.sceneCount} 场 · {project.shotCount} 镜头 · {project.aspectRatio}
                </span>
                <small>{new Date(project.updatedAt).toLocaleString("zh-CN")}</small>
              </div>
            </button>
          ))}
          {projects.length === 0 ? (
            <div className="no-projects">还没有真实项目。创建后会生成第一场和第一个镜头。</div>
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
                <h2>创建一个真实项目</h2>
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
              <span>文件将保存在 4090 的 TakeBoardData 中</span>
              <button type="submit" disabled={busy || !title.trim()}>
                {busy ? "正在创建…" : "创建并打开 →"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
