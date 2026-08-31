import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectBoardPreview,
  ProjectCatalogItem,
  TrashedProjectItem,
  WorkerStatus,
} from "./api";
import { workerApi } from "./api";
import { AccountButton, useAuth } from "./auth-ui";
import { DisplaySettings, type SceneQuality } from "./display-settings";
import { ThemeSwitcher } from "./theme-switcher";

const loadStudioUniverse = () =>
  import("./studio-universe").then((module) => ({ default: module.StudioUniverse }));
const StudioUniverse = lazy(loadStudioUniverse);
const OperationsCenter = lazy(() =>
  import("./operations-center").then((module) => ({ default: module.OperationsCenter })),
);

const workerFleetCss = `.worker-fleet-list {
  display: grid;
  max-height: 260px;
  overflow: auto;
  padding-right: 2px;
  gap: 7px;
}

.worker-fleet-card {
  display: grid;
  align-items: start;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-2) 76%, transparent);
  grid-template-columns: 8px minmax(0, 1fr) auto;
  gap: 9px;
}

.worker-fleet-card > i {
  width: 7px;
  height: 7px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--faint);
}

.worker-fleet-card.status-ready > i {
  background: var(--green);
  box-shadow: 0 0 10px color-mix(in srgb, var(--green) 60%, transparent);
}

.worker-fleet-card > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.worker-fleet-card :is(strong, span, small) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.worker-fleet-card strong {
  font-size: calc(11px * var(--ui-scale));
}

.worker-fleet-card span,
.worker-fleet-card small {
  color: var(--text-2);
  font-size: calc(9px * var(--ui-scale));
}

.worker-fleet-card small {
  color: var(--faint);
}

.worker-fleet-card-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 150px;
  gap: 4px;
}

.worker-fleet-card-actions > button {
  min-height: 26px;
  padding: 0 7px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text-2);
  background: transparent;
  cursor: pointer;
  font-size: calc(9px * var(--ui-scale));
}

.worker-fleet-card-actions > button.danger,
.worker-action-error {
  color: var(--red);
}

.worker-action-error {
  margin: 0;
  padding: 7px 8px;
  border: 1px solid color-mix(in srgb, var(--red) 28%, var(--line));
  border-radius: 6px;
  background: color-mix(in srgb, var(--red) 5%, transparent);
  font-size: calc(9px * var(--ui-scale));
  line-height: 1.45;
}

.worker-add-form {
  display: grid;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--line));
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-root) 58%, transparent);
  gap: 9px;
}

.worker-add-form label {
  display: grid;
  color: var(--faint);
  font-size: calc(9px * var(--ui-scale));
  gap: 4px;
}

.worker-add-form :is(input, select) {
  min-width: 0;
  height: 32px;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: 7px;
  color: var(--text-1);
  background: var(--surface-2);
  outline: none;
  font-size: calc(10px * var(--ui-scale));
}

.worker-add-form :is(input, select):focus {
  border-color: var(--accent);
}

.worker-add-form p,
.worker-add-form [role="alert"] {
  margin: 0;
  color: var(--faint);
  font-size: calc(9px * var(--ui-scale));
  line-height: 1.5;
}

.worker-add-form [role="alert"] {
  color: var(--red);
}

.worker-add-form > button {
  min-height: 34px;
  border: 0;
  border-radius: 8px;
  color: var(--surface-root);
  background: var(--accent-strong);
  cursor: pointer;
  font-weight: 700;
}`;

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
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.hub-utility-actions > button {
  display: grid;
  min-width: 0;
  min-height: 58px;
  place-content: center;
  padding: 7px;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--text-2);
  background: color-mix(in srgb, var(--surface-2) 72%, transparent);
  cursor: pointer;
  font-size: calc(10px * var(--ui-scale));
  gap: 4px;
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
  padding: 11px 8px 5px;
  border-top: 1px solid var(--line);
  gap: 8px;
}

.hub-utility-settings {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.hub-utility-settings > :is(.theme-switcher, .display-settings) {
  flex: 1 1 140px;
}

.hub-utility-settings :is(.theme-switcher > button, .display-settings > button) {
  width: 100%;
  min-height: 38px;
  justify-content: center;
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

  .hub-utility-panel,
  .worker-panel {
    top: calc(100% + 8px) !important;
    right: 0 !important;
    left: auto !important;
    width: min(360px, calc(100vw - 16px)) !important;
    max-height: calc(100dvh - 74px) !important;
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
.hub-shell .hub-artifact-background,
.hub-shell.project-stage-active .hub-artifact-background {
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

function savedSceneQuality(): SceneQuality {
  const value = window.localStorage.getItem("takeboard.scene-quality");
  return value === "full" || value === "lite" ? value : "auto";
}

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
  const canManage = project.role !== "viewer" || project.accessSource === "instance_admin";
  const canDelete = project.role === "owner" || project.accessSource === "instance_admin";
  const accessLabel =
    project.accessSource === "instance_admin"
      ? "ADMIN ACCESS"
      : (project.membershipRole?.toUpperCase() ?? project.role.toUpperCase());
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
            打开画板 <ActionIcon name="open" />
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
  notice: string | null;
  onCreate: (input: NewProjectInput) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
  onImport: (file: File) => Promise<void>;
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
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ProjectCatalogItem | null>(null);
  const [deleting, setDeleting] = useState<ProjectCatalogItem | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [title, setTitle] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [projectSort, setProjectSort] = useState<"recent" | "name">("recent");
  const [projectsVisible, setProjectsVisible] = useState(false);
  const [workerPanelOpen, setWorkerPanelOpen] = useState(false);
  const [workerFormOpen, setWorkerFormOpen] = useState(false);
  const [workerName, setWorkerName] = useState("");
  const [workerEndpoint, setWorkerEndpoint] = useState("");
  const [workerHourlyRate, setWorkerHourlyRate] = useState("");
  const [workerQuality, setWorkerQuality] = useState<"draft" | "balanced" | "final">("balanced");
  const [workerActionBusy, setWorkerActionBusy] = useState(false);
  const [workerActionError, setWorkerActionError] = useState<string | null>(null);
  const [workerTrustArmed, setWorkerTrustArmed] = useState<string | null>(null);
  const [workerRemoveArmed, setWorkerRemoveArmed] = useState<string | null>(null);
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
  const fleetWorkers = worker?.fleet?.workers ?? [];
  const readyWorkerCount = fleetWorkers.filter((entry) => entry.status === "ready").length;
  const addWorker = async () => {
    const endpoint = workerEndpoint.trim().replace(/\/+$/, "");
    const name = workerName.trim();
    if (!name || !endpoint) {
      setWorkerActionError("请填写执行端名称和地址");
      return;
    }
    const hourlyRate = workerHourlyRate.trim() ? Number(workerHourlyRate) : null;
    if (hourlyRate !== null && (!Number.isFinite(hourlyRate) || hourlyRate < 0)) {
      setWorkerActionError("每小时成本应为大于或等于 0 的数字，或留空表示未知");
      return;
    }
    const isTunnel = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(endpoint);
    setWorkerActionBusy(true);
    setWorkerActionError(null);
    try {
      await workerApi.add({
        name,
        endpoint,
        kind: "remote",
        transport: isTunnel ? "ssh_tunnel" : "https",
        enabled: true,
        allowSensitiveInputs: false,
        qualityTier: workerQuality,
        priority: 50,
        hourlyRate,
        currency: "CNY",
        estimatedJobSeconds: 300,
      });
      setWorkerName("");
      setWorkerEndpoint("");
      setWorkerHourlyRate("");
      setWorkerQuality("balanced");
      setWorkerFormOpen(false);
      await onRefreshWorker();
    } catch (cause) {
      setWorkerActionError(cause instanceof Error ? cause.message : "无法添加执行端");
    } finally {
      setWorkerActionBusy(false);
    }
  };
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
      if (!(target instanceof Element) || target.closest(".worker-panel, .modal-backdrop")) return;
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
      <style>{`${workerFleetCss}\n${hubChromeCss}`}</style>
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
            <div className="hub-status-group">
              <Suspense fallback={null}>
                <OperationsCenter compact onOpenProject={onOpen} />
              </Suspense>
              <span className="hub-status-divider" aria-hidden="true" />
              <div className="worker-control">
                <button
                  className={`worker-pill worker-${worker?.status ?? "loading"}`}
                  type="button"
                  aria-expanded={workerPanelOpen}
                  aria-label="ComfyUI 连接与安全启动"
                  onClick={() => setWorkerPanelOpen((current) => !current)}
                >
                  <i />
                  <svg className="worker-engine-mark" viewBox="0 0 20 20" aria-hidden="true">
                    <rect x="5" y="5" width="10" height="10" rx="2" />
                    <path d="M8 8h4v4H8zM7 2.8v2.1M13 2.8v2.1M7 15.1v2.1M13 15.1v2.1M2.8 7h2.1M15.1 7h2.1M2.8 13h2.1M15.1 13h2.1" />
                  </svg>
                  <div>
                    <strong>ComfyUI</strong>
                    <span>
                      {workerBusy
                        ? "检测中"
                        : readyWorkerCount > 0
                          ? fleetWorkers.length > 1
                            ? `${readyWorkerCount}/${fleetWorkers.length} 可用`
                            : "已连接"
                          : worker?.status === "offline"
                            ? "离线"
                            : "连接中"}
                    </span>
                  </div>
                  <b aria-hidden="true">⌄</b>
                </button>
                {workerPanelOpen ? (
                  <aside className="worker-panel" aria-label="ComfyUI 连接与安全启动面板">
                    <div className="worker-panel-heading">
                      <div>
                        <span>COMPUTE FLEET</span>
                        <strong>
                          {readyWorkerCount > 0
                            ? `${readyWorkerCount} / ${fleetWorkers.length || 1} 在线`
                            : "执行端未连接"}
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
                    {fleetWorkers.length > 0 ? (
                      <div className="worker-fleet-list">
                        {fleetWorkers.map((entry) => (
                          <article
                            className={`worker-fleet-card status-${entry.status}`}
                            key={entry.worker.id}
                          >
                            <i />
                            <div>
                              <strong>{entry.worker.name}</strong>
                              <span>
                                {entry.status === "ready"
                                  ? `${entry.device ?? "ComfyUI"} · 队列 ${entry.queueRunning + entry.queuePending}`
                                  : entry.status === "disabled"
                                    ? "已停用，不参与调度"
                                    : (entry.error ?? "当前离线")}
                              </span>
                              <small>
                                {entry.worker.kind === "local" ? "本机" : "远程"} ·{" "}
                                {entry.worker.qualityTier} ·{" "}
                                {entry.worker.hourlyRate === null
                                  ? "成本未知"
                                  : `${entry.worker.hourlyRate} ${entry.worker.currency}/小时`}
                              </small>
                            </div>
                            {user?.instanceRole === "admin" ? (
                              <div className="worker-fleet-card-actions">
                                <button
                                  type="button"
                                  disabled={workerActionBusy}
                                  title={
                                    entry.worker.allowSensitiveInputs
                                      ? "撤销素材发送权限"
                                      : "明确授权后，图片和视频才可发往此节点"
                                  }
                                  onClick={() => {
                                    if (
                                      !entry.worker.allowSensitiveInputs &&
                                      workerTrustArmed !== entry.worker.id
                                    ) {
                                      setWorkerTrustArmed(entry.worker.id);
                                      setWorkerActionError(
                                        `再次点击“确认素材权限”，才会允许 ${entry.worker.name} 接收图片、视频和音频。`,
                                      );
                                      return;
                                    }
                                    void (async () => {
                                      setWorkerActionBusy(true);
                                      setWorkerActionError(null);
                                      try {
                                        await workerApi.update(entry.worker.id, {
                                          allowSensitiveInputs: !entry.worker.allowSensitiveInputs,
                                        });
                                        setWorkerTrustArmed(null);
                                        await onRefreshWorker();
                                      } catch (cause) {
                                        setWorkerActionError(
                                          cause instanceof Error
                                            ? cause.message
                                            : "无法更新素材权限",
                                        );
                                      } finally {
                                        setWorkerActionBusy(false);
                                      }
                                    })();
                                  }}
                                >
                                  {entry.worker.allowSensitiveInputs
                                    ? "撤销素材权限"
                                    : workerTrustArmed === entry.worker.id
                                      ? "确认素材权限"
                                      : "允许素材"}
                                </button>
                                <button
                                  type="button"
                                  disabled={workerActionBusy}
                                  onClick={() => {
                                    void (async () => {
                                      setWorkerActionBusy(true);
                                      setWorkerActionError(null);
                                      try {
                                        await workerApi.update(entry.worker.id, {
                                          enabled: !entry.worker.enabled,
                                        });
                                        await onRefreshWorker();
                                      } catch (cause) {
                                        setWorkerActionError(
                                          cause instanceof Error ? cause.message : "无法更新执行端",
                                        );
                                      } finally {
                                        setWorkerActionBusy(false);
                                      }
                                    })();
                                  }}
                                >
                                  {entry.worker.enabled ? "停用" : "启用"}
                                </button>
                                {entry.worker.id !== worker?.fleet?.defaultWorkerId ? (
                                  <button
                                    type="button"
                                    className="danger"
                                    disabled={workerActionBusy}
                                    onClick={() => {
                                      if (workerRemoveArmed !== entry.worker.id) {
                                        setWorkerRemoveArmed(entry.worker.id);
                                        setWorkerActionError(
                                          `再次点击“确认移除”将删除 ${entry.worker.name} 的调度配置；运行历史不会删除。`,
                                        );
                                        return;
                                      }
                                      void (async () => {
                                        setWorkerActionBusy(true);
                                        setWorkerActionError(null);
                                        try {
                                          await workerApi.remove(entry.worker.id);
                                          setWorkerRemoveArmed(null);
                                          await onRefreshWorker();
                                        } catch (cause) {
                                          setWorkerActionError(
                                            cause instanceof Error
                                              ? cause.message
                                              : "无法移除执行端",
                                          );
                                        } finally {
                                          setWorkerActionBusy(false);
                                        }
                                      })();
                                    }}
                                  >
                                    {workerRemoveArmed === entry.worker.id ? "确认移除" : "移除"}
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    ) : null}
                    {workerActionError ? (
                      <p className="worker-action-error" role="status">
                        {workerActionError}
                      </p>
                    ) : null}
                    {worker?.status === "ready" ? (
                      <div className="worker-ready-detail">
                        <span>
                          <i /> {worker.device ?? "执行设备"}
                        </span>
                        <small>
                          {worker.version ? `ComfyUI ${worker.version}` : "连接状态正常"}
                        </small>
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
                      {user?.instanceRole === "admin" && worker?.status !== "ready" ? (
                        <button
                          className="worker-safe-start"
                          type="button"
                          disabled={workerBusy || !worker?.startup?.canStart}
                          onClick={() => void onStartWorker()}
                        >
                          {workerBusy ? "正在启动…" : "安全启动"}
                        </button>
                      ) : null}
                      {user?.instanceRole === "admin" ? (
                        <button
                          type="button"
                          onClick={() => setWorkerFormOpen((current) => !current)}
                        >
                          {workerFormOpen ? "收起" : "添加远程算力"}
                        </button>
                      ) : null}
                    </div>
                    {workerFormOpen && user?.instanceRole === "admin" ? (
                      <div className="worker-add-form">
                        <label>
                          <span>名称</span>
                          <input
                            value={workerName}
                            onChange={(event) => setWorkerName(event.target.value)}
                            placeholder="例如：剪辑室 4090"
                          />
                        </label>
                        <label>
                          <span>安全地址</span>
                          <input
                            value={workerEndpoint}
                            onChange={(event) => setWorkerEndpoint(event.target.value)}
                            placeholder="https://worker.example.com 或 http://127.0.0.1:8189"
                          />
                        </label>
                        <label>
                          <span>每小时估算成本</span>
                          <input
                            inputMode="decimal"
                            value={workerHourlyRate}
                            onChange={(event) => setWorkerHourlyRate(event.target.value)}
                            placeholder="可留空 · CNY"
                          />
                        </label>
                        <label>
                          <span>质量定位</span>
                          <select
                            value={workerQuality}
                            onChange={(event) =>
                              setWorkerQuality(event.target.value as typeof workerQuality)
                            }
                          >
                            <option value="draft">预览 · 更适合快速试错</option>
                            <option value="balanced">均衡 · 日常生成</option>
                            <option value="final">终稿 · 优先最终质量</option>
                          </select>
                        </label>
                        <p>
                          普通 HTTP 仅允许 SSH
                          映射后的本机回环地址；图片、视频和音频默认不会发送到新节点。
                        </p>
                        {workerActionError ? <div role="alert">{workerActionError}</div> : null}
                        <button
                          type="button"
                          disabled={workerActionBusy}
                          onClick={() => void addWorker()}
                        >
                          {workerActionBusy ? "验证并保存…" : "添加执行端"}
                        </button>
                      </div>
                    ) : null}
                    <small className="worker-safety-note">
                      {user && user.instanceRole !== "admin"
                        ? "ComfyUI 的启动由工作室管理员负责。"
                        : null}
                      预检不通过时，TakeBoard 不会启动服务。
                    </small>
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
                onClick={() => setUtilityOpen((current) => !current)}
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
                      <span>管理、帮助与显示设置</span>
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
                      <span aria-hidden="true">⇩</span>
                      导入项目
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
                    <span>外观与可读性</span>
                    <div className="hub-utility-settings">
                      <ThemeSwitcher />
                      <DisplaySettings />
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
