import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectBoardPreview,
  ProjectCatalogItem,
  TrashedProjectItem,
  WorkerStatus,
} from "./api";
import { projectApi } from "./api";
import { AccountButton, useAuth } from "./auth-ui";
import { DeviceIndicator } from "./device-indicator";
import { savedSceneQuality } from "./display-preferences";
import { DisplaySettings, type SceneQuality } from "./display-settings";
import { type ProjectLocationChoice, ProjectLocationPicker } from "./project-location-picker";
import { SettingsButton } from "./settings-center";
import { ThemeSwitcher } from "./theme-switcher";
import { VideoThumbnail } from "./video-preview";

const loadStudioUniverse = () =>
  import("./studio-universe").then((module) => ({ default: module.StudioUniverse }));
const StudioUniverse = lazy(loadStudioUniverse);
const OperationsCenter = lazy(() =>
  import("./operations-center").then((module) => ({ default: module.OperationsCenter })),
);
const GenerationConnectionPanel = lazy(() =>
  import("./generation-connection-panel").then((module) => ({
    default: module.GenerationConnectionPanel,
  })),
);

const hubChromeCss = `.hub-header {
  height: 72px;
  padding: 0 clamp(14px, 2.6vw, 38px);
  border-bottom: 1px solid color-mix(in srgb, var(--hub-line) 68%, transparent);
  background:
    linear-gradient(180deg, color-mix(in srgb, white 2.5%, transparent), transparent),
    color-mix(in srgb, var(--hub-bg) 84%, transparent);
  box-shadow: 0 14px 44px color-mix(in srgb, black 16%, transparent);
  backdrop-filter: blur(28px) saturate(116%);
}

.hub-header-inner {
  width: min(100%, 1540px);
  height: 100%;
  margin: 0 auto;
}

.hub-header-actions {
  min-width: 0;
  padding: 4px;
  border: 1px solid color-mix(in srgb, var(--hub-line) 78%, transparent);
  border-radius: 15px;
  background:
    linear-gradient(145deg, color-mix(in srgb, white 3%, transparent), transparent 48%),
    color-mix(in srgb, var(--hub-surface) 68%, transparent);
  box-shadow:
    0 1px 0 color-mix(in srgb, white 5%, transparent) inset,
    0 12px 34px color-mix(in srgb, black 12%, transparent);
  gap: 5px;
}

.hub-header-actions > :is(.hub-status-group, .hub-utility-control) {
  flex: none;
}

.hub-status-group {
  display: flex;
  height: 38px;
  align-items: stretch;
  padding: 2px;
  border: 1px solid color-mix(in srgb, var(--hub-line) 82%, transparent);
  border-radius: 11px;
  background: color-mix(in srgb, var(--hub-surface-raised) 48%, transparent);
}

.hub-status-divider {
  width: 1px;
  height: 20px;
  align-self: center;
  background: color-mix(in srgb, var(--hub-line) 86%, transparent);
}

.hub-brand {
  min-width: 0;
}

.hub-brand > div {
  min-width: 0;
}

.hub-brand strong {
  font-family: Georgia, "Songti SC", serif;
  font-weight: 580;
  letter-spacing: -0.025em;
}

.hub-brand span:last-child {
  color: var(--faint);
  letter-spacing: 0.12em;
}

.hub-brand .brand-mark {
  border: 1px solid color-mix(in srgb, var(--hub-accent) 54%, var(--hub-line));
  border-radius: 9px;
  background:
    linear-gradient(145deg, color-mix(in srgb, white 36%, transparent), transparent 52%),
    var(--hub-accent);
  box-shadow:
    0 1px 0 rgb(255 255 255 / 34%) inset,
    0 9px 24px color-mix(in srgb, var(--hub-accent) 18%, transparent);
}

.hub-header .hub-status-group .operations-control.is-compact .operations-pill {
  min-width: 110px;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  color: var(--hub-copy);
  background: transparent;
}

.hub-header .hub-status-group .operations-pill:hover,
.hub-header .hub-status-group .operations-pill[aria-expanded="true"] {
  background: color-mix(in srgb, var(--hub-surface-raised) 78%, transparent);
}

.hub-header .worker-pill {
  display: flex;
  width: auto;
  min-width: 128px;
  height: 32px;
  min-height: 32px;
  padding: 0 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  gap: 8px;
}

.hub-header .worker-pill > div {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.hub-header .worker-pill strong,
.hub-header .worker-pill span {
  line-height: 1;
}

.hub-header .worker-pill span {
  color: var(--hub-muted);
  font-size: calc(9px * var(--ui-scale));
}

.hub-header .worker-pill > b {
  font-size: 9px;
}

.worker-engine-mark {
  display: none;
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.25;
}

.hub-header .account-button.compact,
.hub-utility-trigger {
  width: 40px;
  min-width: 40px;
  height: 40px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  color: var(--text-1);
  background: transparent;
}

.hub-header .account-button.compact {
  display: flex;
  align-items: center;
  justify-content: center;
  grid-template-rows: none;
  line-height: 1;
}

.hub-header .account-button.compact > span {
  margin: 0;
  grid-row: auto;
}

.hub-header-create {
  display: inline-flex;
  min-width: 108px;
  height: 40px;
  align-items: center;
  justify-content: center;
  padding: 0 15px;
  border: 1px solid color-mix(in srgb, var(--hub-accent) 62%, var(--hub-line));
  border-radius: 10px;
  color: color-mix(in srgb, var(--hub-accent) 52%, var(--hub-copy));
  background:
    linear-gradient(145deg, color-mix(in srgb, white 8%, transparent), transparent 48%),
    color-mix(in srgb, var(--hub-accent) 13%, var(--hub-surface));
  box-shadow: 0 8px 22px color-mix(in srgb, var(--hub-accent) 11%, transparent);
  gap: 6px;
}

.hub-header-create b {
  font-size: calc(10px * var(--ui-scale));
  font-weight: 620;
}

.hub-header-create:hover {
  border-color: var(--hub-accent);
  background: color-mix(in srgb, var(--hub-accent) 18%, var(--hub-surface-raised));
}

.hub-utility-control {
  position: relative;
}

.hub-utility-trigger {
  display: grid;
  place-items: center;
  cursor: pointer;
}

.hub-utility-trigger svg {
  width: 18px;
  height: 18px;
  fill: var(--hub-bg);
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.35;
}

.hub-utility-trigger:hover,
.hub-utility-trigger[aria-expanded="true"] {
  border-color: var(--accent);
  background: var(--surface-2);
}

.hub-utility-panel {
  position: absolute;
  z-index: 380;
  top: calc(100% + 8px);
  right: 0;
  display: grid;
  width: min(360px, calc(100vw - 24px));
  max-height: calc(100dvh - 88px);
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 15px;
  color: var(--text-1);
  background: color-mix(in srgb, var(--surface-1) 97%, transparent);
  box-shadow: 0 28px 80px rgb(0 0 0 / 38%);
  backdrop-filter: blur(26px) saturate(120%);
  gap: 7px;
}

.hub-utility-panel > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 8px 10px;
}

.hub-utility-panel > header > div {
  display: grid;
  gap: 2px;
}

.hub-utility-panel > header strong {
  font-size: calc(14px * var(--ui-scale));
}

.hub-utility-panel > header span,
.hub-utility-section > span {
  color: var(--faint);
  font-size: calc(9px * var(--ui-scale));
}

.hub-utility-panel > header button {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  color: var(--text-2);
  background: transparent;
  cursor: pointer;
  font-size: 18px;
}

.hub-utility-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
}

.hub-utility-actions > button {
  display: flex;
  min-width: 0;
  min-height: 44px;
  align-items: center;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--text-2);
  background: color-mix(in srgb, var(--surface-2) 72%, transparent);
  cursor: pointer;
  font-size: calc(13px * var(--ui-scale));
  gap: 12px;
}

.hub-utility-actions > button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text-1);
}

.hub-utility-actions > button span {
  color: var(--accent-strong);
  font-size: 17px;
}

.hub-utility-section {
  display: grid;
  padding: 18px 0 0;
  border-top: 1px solid var(--line);
  gap: 12px;
}

.hub-utility-settings {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.hub-utility-section .theme-switcher {
  display: flex;
  width: 100%;
  margin: 0;
  min-width: 0;
}
.hub-utility-panel .hub-utility-section .theme-switcher button {
  flex: 1;
  width: auto;
  min-height: 42px;
  justify-content: center;
  font: inherit;
}
.hub-utility-panel .hub-utility-section .theme-switcher span {
  display: inline;
}
.hub-utility-settings :is(button, .display-settings) {
  width: 100%;
  min-width: 0;
}
.hub-utility-panel .hub-utility-settings button {
  min-height: 38px;
  padding: 8px;
  justify-content: center;
  font-size: calc(11px * var(--ui-scale));
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-2);
}

.worker-panel {
  position: absolute !important;
  top: calc(100% + 8px) !important;
  right: 0 !important;
  max-height: calc(100dvh - 88px) !important;
  overflow: auto !important;
}

@media (max-width: 1040px) {
  .hub-brand span:last-child,
  .hub-header .worker-pill span {
    display: none;
  }

  .hub-header .worker-pill {
    min-width: 94px;
  }
}

@media (max-width: 820px) {
  .hub-header .hub-status-group .operations-control.is-compact .operations-pill {
    min-width: 36px;
    width: 36px;
    padding: 0;
  }

  .hub-header .operations-compact-label,
  .hub-header .worker-pill span {
    display: none;
  }

  .hub-header .worker-pill {
    min-width: 84px;
  }

  .hub-header-create {
    width: 40px;
    min-width: 40px;
    padding: 0;
  }

  .hub-header-create b {
    display: none;
  }
}

@media (max-width: 640px) {
  .hub-header {
    height: 60px;
    padding-inline: 9px;
  }

  .hub-header-actions {
    gap: 5px;
  }

  .hub-brand .brand-mark {
    width: 30px;
    height: 30px;
  }

  .hub-brand strong {
    font-size: calc(13px * var(--ui-scale));
  }

  .hub-header .worker-pill {
    width: 36px;
    min-width: 36px;
    justify-content: center;
    padding: 0;
  }

  .hub-header .worker-pill > div,
  .hub-header .worker-pill > b {
    display: none;
  }

  .hub-header .worker-pill {
    position: relative;
  }

  .hub-header .worker-pill .worker-engine-mark {
    display: block;
  }

  .hub-header .worker-pill > i {
    position: absolute;
    right: 5px;
    bottom: 5px;
    width: 5px;
    height: 5px;
    border: 1px solid var(--hub-surface);
  }

  .hub-header-create span {
    margin: 0;
    font-size: 18px;
  }

  .hub-utility-panel {
    top: calc(100% + 8px) !important;
    right: 0 !important;
    left: auto !important;
    width: min(360px, calc(100vw - 16px)) !important;
    max-height: calc(100dvh - 74px) !important;
  }
  .worker-panel {
    position: fixed !important;
    top: 70px !important;
    right: 10px !important;
    left: 10px !important;
    width: auto !important;
    max-height: calc(100dvh - 90px) !important;
  }
}

@media (max-width: 470px) {
  .hub-brand > div {
    display: none;
  }

  .hub-status-divider {
    display: none;
  }
}

/* The 3D stage remains the backdrop; the project chapter itself carries the translucent veil. */
.hub-shell .hub-artifact-background {
  opacity: 1;
  filter: none;
  transform: none;
}

.hub-shell .hub-projects::before {
  background:
    radial-gradient(
      ellipse at 74% 5%,
      color-mix(in srgb, var(--hub-sage) 9%, transparent),
      transparent 32%
    ),
    radial-gradient(
      ellipse at 9% 62%,
      color-mix(in srgb, var(--hub-accent) 7%, transparent),
      transparent 34%
    ),
    linear-gradient(
      to bottom,
      color-mix(in srgb, var(--hub-bg) 62%, transparent),
      color-mix(in srgb, var(--hub-bg) 76%, transparent) 260px,
      color-mix(in srgb, var(--hub-bg) 84%, transparent)
  );
  box-shadow: 0 -24px 72px color-mix(in srgb, var(--hub-bg) 22%, transparent);
  backdrop-filter: none;
}

.hub-shell .hub-section-heading {
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--hub-bg) 84%, transparent),
    color-mix(in srgb, var(--hub-bg) 68%, transparent)
  );
}`;

const companionMessages = {
  crew: "已打板",
  lens: "焦点确认",
  dragonfly: "收音就位",
  moth: "分镜标记",
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

function projectChapterTop(shell: HTMLElement, section: HTMLElement) {
  const header = shell.querySelector<HTMLElement>(".hub-header");
  const headerHeight = header?.offsetHeight ?? 72;
  return Math.max(0, section.offsetTop - headerHeight);
}

function projectScrollLimit(shell: HTMLElement, section: HTMLElement) {
  const header = shell.querySelector<HTMLElement>(".hub-header");
  const headerHeight = header?.offsetHeight ?? 72;
  const chapterTop = projectChapterTop(shell, section);
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
  storageRootId?: string;
  storageFolder?: string;
};

function ActionIcon({ name }: { name: "open" | "rename" | "delete" | "export" }) {
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
  if (name === "export") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v11m-4-4 4 4 4-4" />
        <path d="M5 16v4h14v-4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13m-5-5 5 5-5 5" />
    </svg>
  );
}

function boardLayout(board: ProjectBoardPreview | undefined, aspectRatio: number) {
  if (!board || board.nodes.length === 0) return { nodes: [], edges: [] };
  const minX = Math.min(...board.nodes.map((node) => node.x));
  const minY = Math.min(...board.nodes.map((node) => node.y));
  const maxX = Math.max(...board.nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...board.nodes.map((node) => node.y + node.height));
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min(84 / spanX, 70 / (spanY * aspectRatio));
  const offsetX = (100 - spanX * scale) / 2;
  const offsetY = (80 - spanY * scale * aspectRatio) / 2;
  const nodes = board.nodes.map((node) => ({
    ...node,
    left: offsetX + (node.x - minX) * scale,
    top: offsetY + (node.y - minY) * scale * aspectRatio,
    previewWidth: node.width * scale,
    previewHeight: node.height * scale * aspectRatio,
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
  const previewRef = useRef<HTMLButtonElement>(null);
  const [previewAspect, setPreviewAspect] = useState(2);
  const [previewVisible, setPreviewVisible] = useState(false);
  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.height > 0)
        setPreviewAspect(entry.contentRect.width / entry.contentRect.height);
    });
    observer.observe(element);
    const visibility = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setPreviewVisible(true);
          visibility.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    visibility.observe(element);
    return () => {
      observer.disconnect();
      visibility.disconnect();
    };
  }, []);
  const canManage = project.role !== "viewer" || project.accessSource === "instance_admin";
  const canDelete = project.role === "owner" || project.accessSource === "instance_admin";
  const accessLabel =
    project.accessSource === "instance_admin"
      ? "ADMIN ACCESS"
      : (project.membershipRole?.toUpperCase() ?? project.role.toUpperCase());
  const activeBoard = project.boards[Math.min(boardIndex, Math.max(project.boards.length - 1, 0))];
  const preview = useMemo(
    () => boardLayout(activeBoard, previewAspect),
    [activeBoard, previewAspect],
  );

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
          ref={previewRef}
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
                  {node.assetId && node.mediaType === "image" ? (
                    <img
                      loading="lazy"
                      src={projectApi.assetUrl(project.key, node.assetId)}
                      alt=""
                    />
                  ) : node.assetId && node.mediaType === "video" && previewVisible ? (
                    <VideoThumbnail
                      src={projectApi.assetUrl(project.key, node.assetId)}
                      label={`${node.label} 预览`}
                    />
                  ) : (
                    <i />
                  )}
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
          <em
            className={`project-role role-${project.accessSource === "instance_admin" ? "admin" : project.role}`}
            title={
              project.accessSource === "instance_admin"
                ? "实例管理员可进行故障恢复；这不代表项目 Owner 成员关系"
                : undefined
            }
          >
            {accessLabel}
          </em>
        </div>
        <div className="project-card-actions">
          <button
            className="project-card-open-button"
            type="button"
            onClick={onOpen}
            disabled={busy}
          >
            {project.unavailable ? "项目位置不可用" : "打开画板"} <ActionIcon name="open" />
          </button>
          {canManage ? (
            <button type="button" onClick={onRename} aria-label={`重命名 ${project.title}`}>
              <ActionIcon name="rename" />
            </button>
          ) : null}
          {canDelete ? (
            project.activeRunCount === 0 ? (
              <a
                href={`/api/projects/${encodeURIComponent(project.key)}/export`}
                download
                aria-label={`导出 ${project.title}`}
                title="导出完整项目包"
              >
                <ActionIcon name="export" />
              </a>
            ) : (
              <button
                type="button"
                disabled
                aria-label={`${project.title} 正在生成，暂时不能导出`}
                title="等待生成任务结束后再导出"
              >
                <ActionIcon name="export" />
              </button>
            )
          ) : null}
          {canDelete ? (
            <button
              className="project-card-delete-button"
              type="button"
              onClick={onDelete}
              disabled={busy}
              aria-label={`删除 ${project.title}`}
            >
              <ActionIcon name="delete" />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function ProjectHub({
  busy,
  error,
  notice,
  onCreate,
  onDelete,
  onImport,
  onOpen,
  onRename,
  onRestore,
  projects,
  trashedProjects,
  worker,
  workerBusy,
}: {
  busy: boolean;
  error: string | null;
  notice: string | null;
  onCreate: (input: NewProjectInput) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onOpen: (key: string) => Promise<void>;
  onRename: (key: string, title: string) => Promise<void>;
  onRestore: (trashKey: string) => Promise<void>;
  projects: ProjectCatalogItem[];
  trashedProjects: TrashedProjectItem[];
  worker: WorkerStatus | null;
  workerBusy: boolean;
}) {
  const { local, accountsConfigured, openAccount } = useAuth();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ProjectCatalogItem | null>(null);
  const [deleting, setDeleting] = useState<ProjectCatalogItem | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [title, setTitle] = useState("");
  const [projectLocation, setProjectLocation] = useState<ProjectLocationChoice | null>(null);
  const [projectLocationValid, setProjectLocationValid] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectSort, setProjectSort] = useState<"recent" | "name">("recent");
  const [projectsVisible, setProjectsVisible] = useState(false);
  const [workerPanelOpen, setWorkerPanelOpen] = useState(false);
  const workerControl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!workerPanelOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !workerControl.current?.contains(event.target))
        setWorkerPanelOpen(false);
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [workerPanelOpen]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [utilityOpen, setUtilityOpen] = useState(false);
  const [sceneQuality, setSceneQuality] = useState<SceneQuality>(savedSceneQuality);
  const [companionMoment, setCompanionMoment] = useState<keyof typeof companionMessages | null>(
    null,
  );
  const titleInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const projectsRef = useRef<HTMLElement>(null);
  const utilityRef = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    if (
      !creating &&
      !renaming &&
      !deleting &&
      !workerPanelOpen &&
      !helpOpen &&
      !recycleOpen &&
      !utilityOpen
    )
      return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setCreating(false);
      setRenaming(null);
      setDeleting(null);
      setWorkerPanelOpen(false);
      setHelpOpen(false);
      setRecycleOpen(false);
      setUtilityOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [creating, deleting, helpOpen, recycleOpen, renaming, utilityOpen, workerPanelOpen]);

  useEffect(() => {
    const closeMenus = () => {
      setWorkerPanelOpen(false);
      setUtilityOpen(false);
    };
    window.addEventListener("takeboard:open-settings", closeMenus);
    return () => window.removeEventListener("takeboard:open-settings", closeMenus);
  }, []);

  useEffect(() => {
    if (!utilityOpen) return;
    const closeUtility = (event: PointerEvent) => {
      if (!utilityRef.current?.contains(event.target as Node)) setUtilityOpen(false);
    };
    window.addEventListener("pointerdown", closeUtility);
    return () => window.removeEventListener("pointerdown", closeUtility);
  }, [utilityOpen]);

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

  useEffect(() => {
    const changeQuality = (event: Event) => {
      const quality = (event as CustomEvent<SceneQuality>).detail;
      setSceneQuality(quality);
    };
    window.addEventListener("takeboard:scene-quality", changeQuality);
    return () => window.removeEventListener("takeboard:scene-quality", changeQuality);
  }, []);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const handleWheel = (event: WheelEvent) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        target.closest('.worker-panel, .modal-backdrop, [role="dialog"]')
      )
        return;
      if (event.deltaY === 0) return;
      const section = projectsRef.current;
      if (!section) return;
      const deltaUnit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? shell.clientHeight
            : 1;
      const maxTop = projectScrollLimit(shell, section);
      const chapterTop = projectChapterTop(shell, section);
      const requestedTop = Math.max(
        0,
        Math.min(maxTop, shell.scrollTop + event.deltaY * deltaUnit),
      );
      // A single large gesture reveals the project shelf without flying past
      // its heading. A later gesture can continue only when the shelf itself
      // is taller than the available viewport.
      const nextTop =
        event.deltaY > 0 && shell.scrollTop < chapterTop && requestedTop > chapterTop
          ? chapterTop
          : event.deltaY < 0 && shell.scrollTop > chapterTop && requestedTop < chapterTop
            ? chapterTop
            : requestedTop;
      event.preventDefault();
      if (shell.scrollTop !== nextTop) shell.scrollTop = nextTop;
    };
    shell.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => shell.removeEventListener("wheel", handleWheel, true);
  }, []);

  const revealCompanionMoment = (moment: keyof typeof companionMessages) => {
    if (companionTimer.current !== null) window.clearTimeout(companionTimer.current);
    setCompanionMoment(moment);
    companionTimer.current = window.setTimeout(() => {
      setCompanionMoment(null);
      companionTimer.current = null;
    }, 1800);
  };

  return (
    <main
      ref={shellRef}
      className="hub-shell"
      onScroll={(event) => {
        const shell = event.currentTarget;
        const section = projectsRef.current;
        const boundedTop = section
          ? Math.min(shell.scrollTop, projectScrollLimit(shell, section))
          : shell.scrollTop;
        if (shell.scrollTop !== boundedTop) shell.scrollTop = boundedTop;
      }}
    >
      <style>{hubChromeCss}</style>
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
            <DeviceIndicator />
            <div className="hub-status-group">
              <Suspense fallback={null}>
                <OperationsCenter compact onOpenProject={onOpen} />
              </Suspense>
              <span className="hub-status-divider" aria-hidden="true" />
              <div className="worker-control" ref={workerControl}>
                <button
                  className={`worker-pill worker-${worker?.status ?? "loading"}`}
                  type="button"
                  aria-expanded={workerPanelOpen}
                  aria-label="选择生成设备"
                  onClick={() => {
                    setUtilityOpen(false);
                    setWorkerPanelOpen((current) => !current);
                  }}
                >
                  <i />
                  <svg className="worker-engine-mark" viewBox="0 0 20 20" aria-hidden="true">
                    <rect x="5" y="5" width="10" height="10" rx="2" />
                    <path d="M8 8h4v4H8zM7 2.8v2.1M13 2.8v2.1M7 15.1v2.1M13 15.1v2.1M2.8 7h2.1M15.1 7h2.1M2.8 13h2.1M15.1 13h2.1" />
                  </svg>
                  <div>
                    <strong title={worker?.connection?.address}>
                      {worker?.status === "ready"
                        ? worker.connection?.kind !== "existing"
                          ? worker.connection?.name || "ComfyUI"
                          : worker.connection?.address
                            ? new URL(worker.connection.address).host
                            : "ComfyUI"
                        : "生成设备"}
                    </strong>
                    <span>
                      {workerBusy
                        ? "检测中"
                        : worker?.status === "ready"
                          ? "使用中"
                          : worker?.status === "offline"
                            ? "离线"
                            : "连接中"}
                    </span>
                  </div>
                  <b aria-hidden="true">⌄</b>
                </button>
                {workerPanelOpen ? (
                  <aside className="worker-panel" aria-label="选择生成设备">
                    <div className="worker-panel-heading">
                      <div>
                        <span>GENERATION</span>
                        <strong>选择生成设备</strong>
                      </div>
                      <button
                        type="button"
                        aria-label="关闭 ComfyUI 面板"
                        onClick={() => setWorkerPanelOpen(false)}
                      >
                        ×
                      </button>
                    </div>
                    <Suspense fallback={<p>读取设备…</p>}>
                      <GenerationConnectionPanel />
                    </Suspense>
                  </aside>
                ) : null}
              </div>
            </div>
            <input
              ref={importInput}
              className="visually-hidden"
              type="file"
              accept=".tgz,.gz,application/gzip,application/x-gzip"
              aria-label="选择 TakeBoard 项目包"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void onImport(file).catch(() => undefined);
              }}
            />
            <button
              className="hub-header-create"
              type="button"
              aria-label="新建项目"
              onClick={() => setCreating(true)}
            >
              <span aria-hidden="true">＋</span>
              <b>新建项目</b>
            </button>
            <AccountButton compact />
            <div className="hub-utility-control" ref={utilityRef}>
              <button
                className="hub-utility-trigger"
                type="button"
                aria-expanded={utilityOpen}
                aria-haspopup="dialog"
                aria-label="打开工作区选项"
                title="工作区选项"
                onClick={() => {
                  setWorkerPanelOpen(false);
                  setUtilityOpen((current) => !current);
                }}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M4 5h12M4 10h12M4 15h12" />
                  <circle cx="8" cy="5" r="1.7" />
                  <circle cx="13" cy="10" r="1.7" />
                  <circle cx="7" cy="15" r="1.7" />
                </svg>
              </button>
              {utilityOpen ? (
                <section className="hub-utility-panel" role="dialog" aria-label="工作区选项">
                  <header>
                    <div>
                      <strong>工作区选项</strong>
                      <span>项目包、回收区与偏好</span>
                    </div>
                    <button
                      type="button"
                      aria-label="关闭工作区选项"
                      onClick={() => setUtilityOpen(false)}
                    >
                      ×
                    </button>
                  </header>
                  <div className="hub-utility-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setUtilityOpen(false);
                        importInput.current?.click();
                      }}
                    >
                      <span aria-hidden="true">＋</span>
                      导入项目包
                    </button>
                    <button
                      type="button"
                      disabled={trashedProjects.length === 0}
                      onClick={() => {
                        setUtilityOpen(false);
                        setRecycleOpen(true);
                      }}
                    >
                      <span aria-hidden="true">↶</span>
                      {trashedProjects.length > 0 ? `回收区 ${trashedProjects.length}` : "回收区"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUtilityOpen(false);
                        setHelpOpen(true);
                      }}
                    >
                      <span aria-hidden="true">?</span>
                      使用帮助
                    </button>
                  </div>
                  <div className="hub-utility-section">
                    <span>外观</span>
                    <ThemeSwitcher />
                    <div className="hub-utility-settings">
                      <DisplaySettings />
                      <SettingsButton />
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
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
                aria-label={`${companionMessages[companion]}互动`}
                onClick={() => revealCompanionMoment(companion)}
              >
                <span className="scene-companion-visual" aria-hidden="true" />
                <em role="status">{companionMessages[companion]}</em>
              </button>
            ),
          )}
          <div className="scene-curiosities" aria-hidden="true">
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
        {sceneQuality !== "lite" ? (
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
              quality={sceneQuality === "full" ? "full" : "balanced"}
              workerReady={worker?.status === "ready"}
              projectCount={projects.length}
              recentProjectTitle={recentProject?.title ?? null}
            />
          </Suspense>
        ) : (
          <div
            className="studio-universe artifact-universe universe-lite-mode"
            role="img"
            aria-label="TakeBoard 导演板静态封面；可在显示设置中启用三维效果"
          >
            <span className="universe-fallback artifact-fallback" aria-hidden="true">
              <i />
              <i />
              <i />
              <span />
            </span>
          </div>
        )}
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
            <span className="section-kicker">{local ? "此设备项目" : "你的项目"}</span>
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
          {local && accountsConfigured ? (
            <button className="no-projects" type="button" onClick={() => openAccount()}>
              <span>↗</span>
              <strong>查看账号项目</strong>
              <small>已有项目未删除，登录后按账号权限显示</small>
            </button>
          ) : null}
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
              if (projectLocationValid) void onCreate({ title, ...projectLocation });
            }}
          >
            <div className="modal-title">
              <div>
                <span className="section-kicker">NEW WORKSPACE</span>
                <h2 id="new-project-title">新建项目</h2>
                <p>设置名称和保存位置，即可开始创作。</p>
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
            <ProjectLocationPicker
              onChange={setProjectLocation}
              onValid={setProjectLocationValid}
            />
            {error ? <p className="form-error">{error}</p> : null}
            <div className="modal-actions">
              <span>创建空白画布 · 保存到所选设备</span>
              <button type="submit" disabled={busy || !title.trim() || !projectLocationValid}>
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
                <h2 id="start-guide-title">开始使用 TakeBoard</h2>
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
                  安装 TakeBoard 后，从“应用程序”或开始菜单打开即可。默认无需注册，
                  新建项目后就能导入素材；生成需要连接 ComfyUI。
                </p>
              </article>
              <article>
                <span>02</span>
                <strong>连接远程服务器</strong>
                <p>
                  在“设置 → 设备连接”添加 ComfyUI
                  设备。项目留在当前电脑，结果会下载到项目文件夹。需要服务器上的项目时，再打开“远程项目”。
                </p>
              </article>
              <article>
                <span>03</span>
                <strong>遇到打不开</strong>
                <p>
                  在“设置 → 运行诊断”点击开始检测，可复制或下载报告。App 更新在“设置 →
                  关于与更新”中检查。
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
                    : "需要生成时，在设置中添加设备或安全启动服务。"}
                </span>
              </div>
            </div>
            <small className="start-guide-note">
              “导入项目包”用于恢复 TakeBoard 导出的 .takeboard.tgz
              文件，不要求原来的文件夹结构。普通图片和视频请在项目画布或资产库中导入。
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
                <p>项目仍保存在原设备，恢复不会重新生成或复制素材。</p>
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
      {notice ? (
        <div className="toast success" role="status">
          ✓ {notice}
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
