import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectBoardPreview, ProjectCatalogItem, WorkerStatus } from "./api";
import { ThemeSwitcher } from "./theme-switcher";

const StudioUniverse = lazy(() =>
  import("./studio-universe").then((module) => ({ default: module.StudioUniverse })),
);

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const prefix = sameDay
    ? "今天"
    : date.toDateString() === yesterday.toDateString()
      ? "昨天"
      : date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
  return `${prefix} ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 更新`;
}

type NewProjectInput = {
  title: string;
  aspectRatio: string;
  sceneTitle: string;
  firstShotIntent: string;
};

function ActionIcon({ name }: { name: "open" | "rename" | "delete" }) {
  if (name === "rename") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m4 20 4.2-1 10.6-10.6a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z" />
        <path d="m14.5 6.5 3 3" />
      </svg>
    );
  }
  if (name === "delete") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13m-5-5 5 5-5 5" />
    </svg>
  );
}

function boardLayout(board: ProjectBoardPreview | undefined) {
  if (!board || board.nodes.length === 0) return { nodes: [], edges: [] };
  const minX = Math.min(...board.nodes.map((node) => node.x));
  const minY = Math.min(...board.nodes.map((node) => node.y));
  const maxX = Math.max(...board.nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...board.nodes.map((node) => node.y + node.height));
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const nodes = board.nodes.map((node) => ({
    ...node,
    left: 7 + ((node.x - minX) / spanX) * 74,
    top: 10 + ((node.y - minY) / spanY) * 63,
    previewWidth: Math.min(32, Math.max(14, (node.width / spanX) * 76)),
    previewHeight: Math.min(27, Math.max(13, (node.height / spanY) * 65)),
  }));
  const positions = new Map(
    nodes.map((node) => [
      node.id,
      {
        x: node.left + node.previewWidth / 2,
        y: node.top + node.previewHeight / 2,
      },
    ]),
  );
  return {
    nodes,
    edges: board.edges.flatMap((edge) => {
      const source = positions.get(edge.sourceItemId);
      const target = positions.get(edge.targetItemId);
      return source && target ? [{ ...edge, source, target }] : [];
    }),
  };
}

function ProjectCard({
  busy,
  index,
  onDelete,
  onOpen,
  onRename,
  project,
}: {
  busy: boolean;
  index: number;
  onDelete: () => void;
  onOpen: () => void;
  onRename: () => void;
  project: ProjectCatalogItem;
}) {
  const [boardIndex, setBoardIndex] = useState(0);
  const activeBoard = project.boards[Math.min(boardIndex, Math.max(project.boards.length - 1, 0))];
  const preview = useMemo(() => boardLayout(activeBoard), [activeBoard]);

  return (
    <article className="project-card project-card-managed">
      <div className={`project-card-art project-board-preview art-${(index % 3) + 1}`}>
        <div className="project-board-toolbar">
          <div className="project-board-tabs" role="tablist" aria-label={`${project.title} 的画板`}>
            {project.boards.slice(0, 3).map((board, boardPosition) => (
              <button
                type="button"
                role="tab"
                aria-selected={boardPosition === boardIndex}
                className={boardPosition === boardIndex ? "active" : ""}
                key={board.sceneId}
                onClick={() => setBoardIndex(boardPosition)}
                title={board.title || board.label}
              >
                {board.label}
              </button>
            ))}
            {project.boards.length > 3 ? <span>+{project.boards.length - 3}</span> : null}
          </div>
          <small>{activeBoard ? `${activeBoard.itemCount} 个节点` : "空画板"}</small>
        </div>
        <button
          className="project-board-open"
          type="button"
          onClick={onOpen}
          disabled={busy}
          aria-label={`打开 ${project.title} 的${activeBoard?.label ?? "画板"}`}
        >
          {activeBoard ? (
            <>
              <svg
                className="project-board-edges"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {preview.edges.map((edge) => (
                  <line
                    key={`${edge.sourceItemId}-${edge.targetItemId}`}
                    x1={edge.source.x}
                    y1={edge.source.y}
                    x2={edge.target.x}
                    y2={edge.target.y}
                  />
                ))}
              </svg>
              {preview.nodes.map((node) => (
                <span
                  className={`project-board-node node-${node.refType}`}
                  key={node.id}
                  style={{
                    left: `${node.left}%`,
                    top: `${node.top}%`,
                    width: `${node.previewWidth}%`,
                    height: `${node.previewHeight}%`,
                  }}
                >
                  <i />
                  <b>{node.label}</b>
                </span>
              ))}
            </>
          ) : (
            <span className="project-board-empty">尚未添加画板内容</span>
          )}
          <span className="project-board-title">
            <small>{String(index + 1).padStart(2, "0")}</small>
            <strong>{activeBoard?.title || activeBoard?.label || "项目画板"}</strong>
          </span>
        </button>
      </div>
      <div className="project-card-copy">
        <div>
          <strong>{project.title}</strong>
          <span>
            {project.sceneCount} 场 · {project.shotCount} 镜头 · {project.aspectRatio}
          </span>
          <small>{formatUpdatedAt(project.updatedAt)}</small>
        </div>
        <div className="project-card-actions">
          <button
            className="project-card-open-button"
            type="button"
            onClick={onOpen}
            disabled={busy}
          >
            打开画板 <ActionIcon name="open" />
          </button>
          <button type="button" onClick={onRename} aria-label={`重命名 ${project.title}`}>
            <ActionIcon name="rename" />
          </button>
          <button
            className="project-card-delete-button"
            type="button"
            onClick={onDelete}
            aria-label={`删除 ${project.title}`}
          >
            <ActionIcon name="delete" />
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProjectHub({
  busy,
  error,
  onCreate,
  onDelete,
  onOpen,
  onRename,
  projects,
  worker,
}: {
  busy: boolean;
  error: string | null;
  onCreate: (input: NewProjectInput) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
  onOpen: (key: string) => Promise<void>;
  onRename: (key: string, title: string) => Promise<void>;
  projects: ProjectCatalogItem[];
  worker: WorkerStatus | null;
}) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ProjectCatalogItem | null>(null);
  const [deleting, setDeleting] = useState<ProjectCatalogItem | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [title, setTitle] = useState("");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [sceneTitle, setSceneTitle] = useState("第一场");
  const [firstShotIntent, setFirstShotIntent] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [projectSort, setProjectSort] = useState<"recent" | "name">("recent");
  const titleInput = useRef<HTMLInputElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const recentProject = useMemo(
    () =>
      [...projects].sort(
        (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      )[0] ?? null,
    [projects],
  );
  const visibleProjects = useMemo(() => {
    const normalizedQuery = projectQuery.trim().toLocaleLowerCase("zh-CN");
    return [...projects]
      .filter((project) => project.title.toLocaleLowerCase("zh-CN").includes(normalizedQuery))
      .sort((left, right) =>
        projectSort === "name"
          ? left.title.localeCompare(right.title, "zh-CN")
          : Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      );
  }, [projectQuery, projectSort, projects]);

  useEffect(() => {
    if (!creating && !renaming && !deleting) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setCreating(false);
      setRenaming(null);
      setDeleting(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [creating, deleting, renaming]);

  useEffect(() => {
    if (creating) titleInput.current?.focus();
    if (renaming) renameInput.current?.focus();
  }, [creating, renaming]);

  return (
    <main className="hub-shell">
      <div className="hub-ambient ambient-one" />
      <div className="hub-ambient ambient-two" />
      <header className="hub-header">
        <div className="hub-header-inner">
          <div className="brand hub-brand">
            <span className="brand-mark">T</span>
            <div>
              <strong>TakeBoard</strong>
              <span>FILMMAKING WORKSPACE</span>
            </div>
          </div>
          <div className="hub-header-actions">
            <ThemeSwitcher />
            <div className={`worker-pill worker-${worker?.status ?? "loading"}`} aria-live="polite">
              <i />
              <div>
                <strong>
                  {worker?.status === "ready"
                    ? "ComfyUI 可用"
                    : worker?.status === "offline"
                      ? "ComfyUI 未连接"
                      : "正在连接 ComfyUI"}
                </strong>
                <span>{worker?.engine ?? "本地执行节点"}</span>
              </div>
            </div>
            <button
              className="hub-header-create"
              type="button"
              aria-label="新建项目"
              onClick={() => setCreating(true)}
            >
              <span>＋</span> 新建
            </button>
          </div>
        </div>
      </header>

      <div className="hub-artifact-background">
        <div className="scene-companions" aria-hidden="true">
          <img src="/scene/takeboard-crew-mascot.webp" alt="" />
          <img src="/scene/takeboard-lens-orbit.webp" alt="" />
        </div>
        <Suspense
          fallback={
            <div className="studio-universe">
              <div className="universe-fallback" aria-hidden="true">
                <i />
                <i />
                <i />
                <span />
              </div>
            </div>
          }
        >
          <StudioUniverse
            workerReady={worker?.status === "ready"}
            projectCount={projects.length}
            recentProjectTitle={recentProject?.title ?? null}
          />
        </Suspense>
      </div>

      <section className="hub-hero hub-object-hero">
        <div className="visually-hidden">
          <span>TAKEBOARD / FILMMAKING WORKSPACE</span>
          <h1>从素材到成片，都在一张画布。</h1>
          <p>连接 ComfyUI，管理素材、镜头、Workflow 与生成结果。</p>
        </div>
      </section>

      <section className="hub-projects">
        <div className="hub-section-heading">
          <div>
            <span className="section-kicker">你的项目</span>
            <h2>继续创作</h2>
          </div>
          <div className="project-library-tools">
            {projects.length > 1 ? (
              <label className="project-search">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  value={projectQuery}
                  onChange={(event) => setProjectQuery(event.target.value)}
                  placeholder="搜索项目"
                  aria-label="搜索项目"
                />
              </label>
            ) : null}
            {projects.length > 1 ? (
              <select
                value={projectSort}
                onChange={(event) => setProjectSort(event.target.value as "recent" | "name")}
                aria-label="项目排序"
              >
                <option value="recent">最近更新</option>
                <option value="name">按名称</option>
              </select>
            ) : null}
            <span className="project-count">
              {projectQuery ? `${visibleProjects.length} / ` : ""}
              {projects.length} 个项目
            </span>
          </div>
        </div>
        <div className="project-grid">
          {visibleProjects.map((project, index) => (
            <ProjectCard
              busy={busy}
              index={index}
              key={project.key}
              project={project}
              onOpen={() => void onOpen(project.key)}
              onRename={() => {
                setRenaming(project);
                setRenameTitle(project.title);
              }}
              onDelete={() => setDeleting(project)}
            />
          ))}
          {projects.length === 0 ? (
            <button className="no-projects" type="button" onClick={() => setCreating(true)}>
              <span>＋</span>
              <strong>创建第一个项目</strong>
              <small>从场景和第一个镜头开始</small>
            </button>
          ) : null}
          {projects.length > 0 && visibleProjects.length === 0 ? (
            <div className="project-search-empty">
              <span>⌕</span>
              <strong>没有匹配的项目</strong>
              <button type="button" onClick={() => setProjectQuery("")}>
                清除搜索
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {creating ? (
        <div className="modal-backdrop">
          <form
            className="new-project-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-title"
            onSubmit={(event) => {
              event.preventDefault();
              void onCreate({ title, aspectRatio, sceneTitle, firstShotIntent });
            }}
          >
            <div className="modal-title">
              <div>
                <span className="section-kicker">新项目</span>
                <h2 id="new-project-title">开始一部新作品</h2>
              </div>
              <button type="button" aria-label="关闭新建项目" onClick={() => setCreating(false)}>
                ×
              </button>
            </div>
            <label>
              项目名称
              <input
                ref={titleInput}
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
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-project-title"
            onSubmit={(event) => {
              event.preventDefault();
              void onRename(renaming.key, renameTitle)
                .then(() => setRenaming(null))
                .catch(() => undefined);
            }}
          >
            <div className="modal-title">
              <div>
                <span className="section-kicker">重命名项目</span>
                <h2 id="rename-project-title">修改项目名称</h2>
              </div>
              <button type="button" aria-label="关闭重命名" onClick={() => setRenaming(null)}>
                ×
              </button>
            </div>
            <label>
              新名称
              <input
                ref={renameInput}
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

      {deleting ? (
        <div className="modal-backdrop">
          <section
            className="delete-project-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
          >
            <div className="delete-project-icon">
              <ActionIcon name="delete" />
            </div>
            <span className="section-kicker">项目管理</span>
            <h2 id="delete-project-title">移除“{deleting.title}”？</h2>
            <p>项目将移入本机项目回收区，不会立即清除素材文件。</p>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="delete-project-actions">
              <button type="button" onClick={() => setDeleting(null)} disabled={busy}>
                取消
              </button>
              <button
                className="confirm-delete-button"
                type="button"
                disabled={busy}
                onClick={() =>
                  void onDelete(deleting.key)
                    .then(() => setDeleting(null))
                    .catch(() => undefined)
                }
              >
                {busy ? "正在移动…" : "移到回收区"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
