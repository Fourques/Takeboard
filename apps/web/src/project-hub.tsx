import { type CSSProperties, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectBoardPreview,
  ProjectCatalogItem,
  TrashedProjectItem,
  WorkerStatus,
} from "./api";
import { DisplaySettings } from "./display-settings";
import { ThemeSwitcher } from "./theme-switcher";

const StudioUniverse = lazy(() =>
  import("./studio-universe").then((module) => ({ default: module.StudioUniverse })),
);

const roomToneBars = Array.from({ length: 13 }, (_, index) => `room-tone-${index + 1}`);
const filmSprockets = Array.from({ length: 8 }, (_, index) => `film-sprocket-${index + 1}`);
const tempoModes = [
  { bpm: 72, label: "缓慢铺陈" },
  { bpm: 96, label: "叙事节拍" },
  { bpm: 120, label: "快速剪辑" },
] as const;
const frameModes = [
  { ratio: "16:9", label: "横向叙事", scale: 0.84 },
  { ratio: "9:16", label: "竖屏焦点", scale: 0.38 },
  { ratio: "2.35:1", label: "宽银幕", scale: 1 },
] as const;
const companionMessages = {
  crew: "场记 · 这一条保留",
  lens: "镜头 · 焦点锁定",
  dragonfly: "收音 · 安全入画",
  moth: "分镜 · 已标记此帧",
} as const;

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

function projectScrollLimit(shell: HTMLElement, section: HTMLElement) {
  const header = shell.querySelector<HTMLElement>(".hub-header");
  const headerHeight = header?.offsetHeight ?? 72;
  const chapterTop = Math.max(0, section.offsetTop - headerHeight);
  const chapterViewportHeight = Math.max(0, shell.clientHeight - headerHeight);
  const contentBottom = Array.from(section.children).reduce((bottom, child) => {
    if (!(child instanceof HTMLElement)) return bottom;
    return Math.max(bottom, child.offsetTop + child.offsetHeight);
  }, 0);
  const breathingRoom = 24;
  const overflow = Math.max(0, contentBottom + breathingRoom - chapterViewportHeight);
  return Math.min(chapterTop + overflow, Math.max(0, shell.scrollHeight - shell.clientHeight));
}

type NewProjectInput = {
  title: string;
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
            disabled={busy}
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
  onRefreshWorker,
  onRename,
  onRestore,
  onStartWorker,
  projects,
  trashedProjects,
  worker,
  workerBusy,
}: {
  busy: boolean;
  error: string | null;
  onCreate: (input: NewProjectInput) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
  onOpen: (key: string) => Promise<void>;
  onRefreshWorker: () => Promise<void>;
  onRename: (key: string, title: string) => Promise<void>;
  onRestore: (trashKey: string) => Promise<void>;
  onStartWorker: () => Promise<void>;
  projects: ProjectCatalogItem[];
  trashedProjects: TrashedProjectItem[];
  worker: WorkerStatus | null;
  workerBusy: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ProjectCatalogItem | null>(null);
  const [deleting, setDeleting] = useState<ProjectCatalogItem | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [title, setTitle] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [projectSort, setProjectSort] = useState<"recent" | "name">("recent");
  const [projectsVisible, setProjectsVisible] = useState(false);
  const [projectStageActive, setProjectStageActive] = useState(false);
  const [workerPanelOpen, setWorkerPanelOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [tempoMode, setTempoMode] = useState(1);
  const [frameMode, setFrameMode] = useState(0);
  const [axisCrossed, setAxisCrossed] = useState(false);
  const [companionMoment, setCompanionMoment] = useState<keyof typeof companionMessages | null>(
    null,
  );
  const titleInput = useRef<HTMLInputElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const projectsRef = useRef<HTMLElement>(null);
  const companionTimer = useRef<number | null>(null);
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
  const activeTempo = tempoModes[tempoMode] ?? tempoModes[0];
  const activeFrame = frameModes[frameMode] ?? frameModes[0];

  useEffect(() => {
    if (!creating && !renaming && !deleting && !workerPanelOpen && !helpOpen && !recycleOpen)
      return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setCreating(false);
      setRenaming(null);
      setDeleting(null);
      setWorkerPanelOpen(false);
      setHelpOpen(false);
      setRecycleOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [creating, deleting, helpOpen, recycleOpen, renaming, workerPanelOpen]);

  useEffect(() => {
    if (creating) titleInput.current?.focus();
    if (renaming) renameInput.current?.focus();
  }, [creating, renaming]);

  useEffect(() => {
    const section = projectsRef.current;
    if (!section || typeof IntersectionObserver === "undefined") {
      setProjectsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setProjectsVisible(true);
        observer.disconnect();
      },
      { threshold: 0.04 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (companionTimer.current !== null) window.clearTimeout(companionTimer.current);
    },
    [],
  );

  const revealCompanionMoment = (moment: keyof typeof companionMessages) => {
    if (companionTimer.current !== null) window.clearTimeout(companionTimer.current);
    setCompanionMoment(moment);
    companionTimer.current = window.setTimeout(() => {
      setCompanionMoment(null);
      companionTimer.current = null;
    }, 2200);
  };

  return (
    <main
      ref={shellRef}
      className={`hub-shell ${projectStageActive ? "project-stage-active" : ""}`}
      onWheelCapture={(event) => {
        const target = event.target;
        if (!(target instanceof Element) || target.closest(".worker-panel, .modal-backdrop"))
          return;
        if (event.deltaY === 0) return;
        const shell = event.currentTarget;
        const section = projectsRef.current;
        if (!section) return;
        const deltaUnit =
          event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? shell.clientHeight : 1;
        const maxTop = projectScrollLimit(shell, section);
        const nextTop = Math.max(0, Math.min(maxTop, shell.scrollTop + event.deltaY * deltaUnit));
        event.preventDefault();
        if (shell.scrollTop !== nextTop) shell.scrollTop = nextTop;
      }}
      onScroll={(event) => {
        const shell = event.currentTarget;
        const section = projectsRef.current;
        const boundedTop = section
          ? Math.min(shell.scrollTop, projectScrollLimit(shell, section))
          : shell.scrollTop;
        if (shell.scrollTop !== boundedTop) shell.scrollTop = boundedTop;
        const nextStageActive = boundedTop > Math.max(48, window.innerHeight * 0.16);
        setProjectStageActive((current) =>
          current === nextStageActive ? current : nextStageActive,
        );
      }}
    >
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
            <DisplaySettings />
            {trashedProjects.length > 0 ? (
              <button
                className="hub-recycle-button"
                type="button"
                onClick={() => setRecycleOpen(true)}
              >
                <span aria-hidden="true">↶</span> 回收区 {trashedProjects.length}
              </button>
            ) : null}
            <button className="hub-help-button" type="button" onClick={() => setHelpOpen(true)}>
              <span aria-hidden="true">?</span> 开始使用
            </button>
            <div className="worker-control">
              <button
                className={`worker-pill worker-${worker?.status ?? "loading"}`}
                type="button"
                aria-expanded={workerPanelOpen}
                aria-label="ComfyUI 连接与安全启动"
                onClick={() => setWorkerPanelOpen((current) => !current)}
              >
                <i />
                <div>
                  <strong>
                    {workerBusy
                      ? "正在检查 ComfyUI"
                      : worker?.status === "ready"
                        ? "ComfyUI 可用"
                        : worker?.status === "offline"
                          ? "ComfyUI 未连接"
                          : "正在连接 ComfyUI"}
                  </strong>
                  <span>{worker?.device ?? worker?.engine ?? "本地执行节点"}</span>
                </div>
                <b aria-hidden="true">⌄</b>
              </button>
              {workerPanelOpen ? (
                <aside className="worker-panel" aria-label="ComfyUI 连接与安全启动面板">
                  <div className="worker-panel-heading">
                    <div>
                      <span>COMPUTE NODE</span>
                      <strong>
                        {worker?.status === "ready" ? "执行端已连接" : "执行端未连接"}
                      </strong>
                    </div>
                    <button
                      type="button"
                      aria-label="关闭 ComfyUI 面板"
                      onClick={() => setWorkerPanelOpen(false)}
                    >
                      ×
                    </button>
                  </div>
                  {worker?.status === "ready" ? (
                    <div className="worker-ready-detail">
                      <span>
                        <i /> {worker.device ?? "执行设备"}
                      </span>
                      <small>{worker.version ? `ComfyUI ${worker.version}` : "连接状态正常"}</small>
                    </div>
                  ) : (
                    <>
                      <p>{worker?.startup?.message ?? worker?.error ?? "尚未完成安全预检"}</p>
                      {worker?.startup?.checks.length ? (
                        <ul className="worker-safety-checks">
                          {worker.startup.checks.map((check) => (
                            <li className={`check-${check.status}`} key={check.id}>
                              <i />
                              <div>
                                <strong>{check.label}</strong>
                                <span>{check.detail}</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  )}
                  <div className="worker-panel-actions">
                    <button
                      type="button"
                      disabled={workerBusy}
                      onClick={() => void onRefreshWorker()}
                    >
                      {workerBusy ? "检查中…" : "重新检测"}
                    </button>
                    {worker?.status !== "ready" ? (
                      <button
                        className="worker-safe-start"
                        type="button"
                        disabled={workerBusy || !worker?.startup?.canStart}
                        onClick={() => void onStartWorker()}
                      >
                        {workerBusy ? "正在启动…" : "安全启动"}
                      </button>
                    ) : null}
                  </div>
                  <small className="worker-safety-note">
                    预检不通过时，TakeBoard 不会启动服务。
                  </small>
                </aside>
              ) : null}
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
        <div className="scene-companions">
          {(Object.keys(companionMessages) as Array<keyof typeof companionMessages>).map(
            (companion) => (
              <button
                className={`scene-companion scene-${companion} ${companionMoment === companion ? "is-active" : ""}`}
                type="button"
                key={companion}
                aria-label={`触发${companionMessages[companion]}`}
                onClick={() => revealCompanionMoment(companion)}
              >
                <span className="scene-companion-visual" aria-hidden="true" />
                <em role="status">{companionMessages[companion]}</em>
              </button>
            ),
          )}
          <div className="scene-curiosities">
            <span className="curiosity-constellation">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="curiosity-loose-frame">
              <i />
              <i />
              <i />
            </span>
            <span className="curiosity-orbit">
              <i />
              <i />
              <i />
            </span>
          </div>
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

      <section className={`hub-projects ${projectsVisible ? "is-visible" : ""}`} ref={projectsRef}>
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
              onDelete={() => {
                if (project.activeRunCount > 0) {
                  setDeleting(project);
                  return;
                }
                void onDelete(project.key).catch(() => undefined);
              }}
            />
          ))}
          {projects.length === 0 ? (
            <button className="no-projects" type="button" onClick={() => setCreating(true)}>
              <span>＋</span>
              <strong>创建第一个项目</strong>
              <small>从一张空白工作画板开始</small>
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
        <section className="project-curiosities" aria-label="导演小工具">
          <div className="project-curiosities-heading">
            <strong>导演小工具</strong>
            <span>点击预演剪辑节奏、成片画幅与镜头轴线</span>
          </div>
          <button
            className="curiosity-module room-tone-module"
            type="button"
            aria-label={`剪辑节拍预演，当前 ${activeTempo.bpm} BPM，点击切换`}
            style={
              {
                "--tempo-cycle": `${60 / activeTempo.bpm}s`,
              } as CSSProperties
            }
            onClick={() => setTempoMode((current) => (current + 1) % tempoModes.length)}
          >
            <div className="curiosity-module-label">
              <span>剪辑节拍预演</span>
              <i />
            </div>
            <div className="room-tone-wave">
              {roomToneBars.map((bar) => (
                <i key={bar} />
              ))}
            </div>
            <div className="curiosity-module-caption">
              <strong>{activeTempo.bpm} BPM</strong>
              <small>{activeTempo.label} · 点击切换</small>
            </div>
          </button>
          <button
            className="curiosity-module film-loop-module"
            type="button"
            aria-label={`画幅试镜，当前 ${activeFrame.ratio}，点击切换`}
            style={{ "--preview-scale": activeFrame.scale } as CSSProperties}
            onClick={() => setFrameMode((current) => (current + 1) % frameModes.length)}
          >
            <div className="film-loop-heading">
              <span>画幅试镜</span>
              <div className="film-loop-sprockets" aria-hidden="true">
                {filmSprockets.map((sprocket) => (
                  <i key={sprocket} />
                ))}
              </div>
            </div>
            <div className="film-loop-frames">
              <span />
              <span />
              <span />
            </div>
            <div className="curiosity-module-caption">
              <strong>{activeFrame.ratio}</strong>
              <small>{activeFrame.label} · 点击试镜</small>
            </div>
          </button>
          <button
            className={`curiosity-module continuity-module ${axisCrossed ? "is-crossed" : ""}`}
            type="button"
            aria-label={`轴线检查，当前${axisCrossed ? "越轴" : "守轴"}，点击翻转机位`}
            aria-pressed={axisCrossed}
            onClick={() => setAxisCrossed((current) => !current)}
          >
            <div className="continuity-dial">
              <span />
              <i />
              <i />
              <i />
            </div>
            <div>
              <span>180° 轴线检查</span>
              <strong>{axisCrossed ? "越轴" : "守轴"}</strong>
              <small>{axisCrossed ? "视线方向已反转" : "点击翻转机位"}</small>
            </div>
          </button>
        </section>
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
              void onCreate({ title });
            }}
          >
            <div className="modal-title">
              <div>
                <span className="section-kicker">NEW WORKSPACE</span>
                <h2 id="new-project-title">建立一张工作画板</h2>
                <p>先给作品命名。脚本、素材、镜头和成片会在画布中自然生长。</p>
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
                placeholder="未命名作品"
              />
            </label>
            <div className="project-start-card">
              <span className="project-start-mark" aria-hidden="true">
                ∞
              </span>
              <div>
                <strong>空白画布</strong>
                <p>不预设镜头，也不锁定全局画幅。</p>
              </div>
              <span className="project-start-badge">默认</span>
            </div>
            <div className="project-start-paths">
              <span>脚本与 Brief</span>
              <span>人物 / 场景资产</span>
              <span>独立画幅的镜头</span>
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="modal-actions">
              <span>创建 1 张空白工作画板 · 本地保存</span>
              <button type="submit" disabled={busy || !title.trim()}>
                {busy ? "正在创建…" : "进入画布 →"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {helpOpen ? (
        <div className="modal-backdrop">
          <section
            className="start-guide-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="start-guide-title"
          >
            <div className="modal-title">
              <div>
                <span className="section-kicker">QUICK START</span>
                <h2 id="start-guide-title">不用研究配置，也能直接开始</h2>
                <p>本机使用、远程连接和故障检查都有独立入口。</p>
              </div>
              <button type="button" aria-label="关闭开始使用" onClick={() => setHelpOpen(false)}>
                ×
              </button>
            </div>
            <div className="start-guide-grid">
              <article>
                <span>01</span>
                <strong>本机打开</strong>
                <p>
                  双击项目根目录里的 <code>START-TAKEBOARD</code>
                  。首次会自动安装，之后自动启动并打开浏览器。
                </p>
              </article>
              <article>
                <span>02</span>
                <strong>连接远程服务器</strong>
                <p>
                  双击 <code>CONNECT-REMOTE</code>，输入 SSH
                  主机。端口冲突会自动换号，关闭窗口即释放隧道。
                </p>
              </article>
              <article>
                <span>03</span>
                <strong>遇到打不开</strong>
                <p>
                  运行 <code>npm run easy:doctor</code>，会用中文逐项检查环境、服务与
                  ComfyUI，并给出下一步。
                </p>
              </article>
            </div>
            <div className={`start-guide-status worker-${worker?.status ?? "loading"}`}>
              <i />
              <div>
                <strong>
                  {worker?.status === "ready" ? "现在可以生成" : "画布可用，生成端尚未连接"}
                </strong>
                <span>
                  {worker?.status === "ready"
                    ? (worker.device ?? "ComfyUI 已连接")
                    : "需要生成时，在右上角进行检测或安全启动。"}
                </span>
              </div>
            </div>
            <small className="start-guide-note">
              项目默认保存在本机 TakeBoardData，关闭服务不会删除项目。
            </small>
          </section>
        </div>
      ) : null}

      {recycleOpen ? (
        <div className="modal-backdrop">
          <section
            className="recycle-project-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recycle-project-title"
          >
            <div className="modal-title">
              <div>
                <span className="section-kicker">PROJECT RECOVERY</span>
                <h2 id="recycle-project-title">项目回收区</h2>
                <p>项目仍保存在本机，恢复不会重新生成或复制素材。</p>
              </div>
              <button
                type="button"
                aria-label="关闭项目回收区"
                onClick={() => setRecycleOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="recycle-project-list">
              {trashedProjects.map((project) => (
                <article key={project.trashKey}>
                  <div>
                    <strong>{project.title}</strong>
                    <span>
                      {project.shotCount} 个镜头 · {formatUpdatedAt(project.deletedAt)}移入
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onRestore(project.trashKey).catch(() => undefined)}
                  >
                    {busy ? "正在恢复…" : "恢复项目"}
                  </button>
                </article>
              ))}
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            <small className="recycle-project-note">
              回收区不会自动清空，项目可在确认备份后由文件系统管理员清理。
            </small>
          </section>
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
            <h2 id="delete-project-title">停止生成并移除“{deleting.title}”？</h2>
            <p>
              TakeBoard 会先安全停止 {deleting.activeRunCount}
              个生成任务；只有执行端确认停止后，项目才会移入回收区。
            </p>
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
                {busy ? "正在停止任务…" : `停止 ${deleting.activeRunCount} 个任务并移除`}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
