import { createHash } from "node:crypto";
import type {
  Asset,
  CanvasEdge,
  CanvasItem,
  CommandEffect,
  Entity,
  ProjectCommand,
  ProjectCommandEnvelope,
  ProjectCommandPreview,
  ProjectSnapshot,
  Shot,
  TextItem,
} from "@takeboard/contracts";
import { createTakeBoardId, toIsoTimestamp } from "@takeboard/domain";
import type { ProjectStore, StoredProjectCommand } from "./storage/project-store.js";

export class ProjectCommandError extends Error {
  constructor(
    readonly statusCode: 400 | 404 | 409,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ProjectCommandError";
  }
}

type RestoreItemInverse = {
  kind: "restore_item";
  item: CanvasItem;
  edges: CanvasEdge[];
};

type ProjectCommandInverse =
  | {
      kind: "remove_created_text";
      textId: string;
      textUpdatedAt: string;
      itemId: string;
      itemUpdatedAt: string;
    }
  | {
      kind: "remove_created_shot";
      shotId: string;
      shotUpdatedAt: string;
      itemId: string;
      itemUpdatedAt: string;
    }
  | {
      kind: "remove_created_item";
      itemId: string;
      itemUpdatedAt: string;
    }
  | {
      kind: "restore_connection_change";
      createdEdgeId: string;
      replacedEdges: CanvasEdge[];
    }
  | { kind: "restore_edge"; edge: CanvasEdge }
  | {
      kind: "restore_position";
      itemId: string;
      from: { x: number; y: number };
      applied: { x: number; y: number };
    }
  | {
      kind: "restore_positions";
      items: Array<{
        itemId: string;
        from: { x: number; y: number };
        applied: { x: number; y: number };
      }>;
    }
  | RestoreItemInverse
  | {
      kind: "restore_domain_record";
      refType: "text" | "entity" | "asset" | "shot";
      previous: TextItem | Entity | Asset | Shot;
      applied: TextItem | Entity | Asset | Shot;
    }
  | {
      kind: "restore_shot";
      shot: Shot;
      items: CanvasItem[];
      edges: CanvasEdge[];
      sceneOrders: Array<{ shotId: string; order: number }>;
    }
  | {
      kind: "restore_shot_orders";
      sceneId: string;
      previous: Array<{ shotId: string; order: number }>;
      applied: Array<{ shotId: string; order: number }>;
    };

type CommandPlan = {
  snapshot: ProjectSnapshot;
  summary: string;
  effects: CommandEffect[];
  warnings: string[];
  requiresConfirmation: boolean;
  inverse: ProjectCommandInverse | null;
  result: Record<string, unknown>;
};

export type CommandExecutionResult = {
  commandId: string;
  replayed: boolean;
  status: "applied" | "undone";
  result: Record<string, unknown>;
  revision: number;
  snapshot: ProjectSnapshot;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function itemLabel(snapshot: ProjectSnapshot, item: CanvasItem) {
  if (item.refType === "text") {
    return snapshot.textItems.find((candidate) => candidate.id === item.refId)?.title || "文字节点";
  }
  if (item.refType === "entity") {
    return snapshot.entities.find((candidate) => candidate.id === item.refId)?.name || "实体节点";
  }
  if (item.refType === "asset") {
    return (
      snapshot.assets.find((candidate) => candidate.id === item.refId)?.originalName || "素材节点"
    );
  }
  return snapshot.shots.find((candidate) => candidate.id === item.refId)?.label || "镜头节点";
}

function sourceExists(snapshot: ProjectSnapshot, refType: CanvasItem["refType"], refId: string) {
  return {
    text: snapshot.textItems.some((item) => item.id === refId),
    entity: snapshot.entities.some((item) => item.id === refId),
    asset: snapshot.assets.some((item) => item.id === refId),
    shot: snapshot.shots.some((item) => item.id === refId),
    take_stack: snapshot.shots.some((item) => item.id === refId),
  }[refType];
}

function canvasSourceAssetId(
  snapshot: ProjectSnapshot,
  source: CanvasItem,
  mediaType: "image" | "video" | "audio",
) {
  if (source.refType === "asset") return source.refId;
  if (source.refType === "entity") {
    return snapshot.entities
      .find((entity) => entity.id === source.refId)
      ?.referenceAssetIds.find((assetId) =>
        snapshot.assets.some((asset) => asset.id === assetId && asset.mediaType === mediaType),
      );
  }
  if (source.refType === "shot") {
    const shot = snapshot.shots.find((candidate) => candidate.id === source.refId);
    const take =
      snapshot.takes.find((candidate) => candidate.id === shot?.approvedTakeId) ??
      [...snapshot.takes]
        .reverse()
        .find((candidate) => candidate.shotId === source.refId && candidate.status !== "rejected");
    return snapshot.assets.some(
      (asset) => asset.id === take?.assetId && asset.mediaType === mediaType,
    )
      ? take?.assetId
      : undefined;
  }
  return undefined;
}

function effect(
  action: CommandEffect["action"],
  entityType: CommandEffect["entityType"],
  entityId: string | null,
  label: string,
  detail: string | null = null,
): CommandEffect {
  return { action, entityType, entityId, label, detail };
}

function touch(snapshot: ProjectSnapshot, timestamp: string) {
  snapshot.project.updatedAt = timestamp;
  snapshot.exportedAt = timestamp;
}

function assertRevision(expectedRevision: number | undefined, currentRevision: number) {
  if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
    throw new ProjectCommandError(
      409,
      `项目已由其他操作更新（当前版本 ${currentRevision}，请求基于版本 ${expectedRevision}），请刷新后重试`,
      { code: "REVISION_CONFLICT", currentRevision, expectedRevision },
    );
  }
}

function confirmationToken(command: ProjectCommand, revision: number) {
  return createHash("sha256")
    .update(JSON.stringify({ command, revision, purpose: "takeboard-command-confirmation-v1" }))
    .digest("hex");
}

function buildPlan(
  snapshotInput: ProjectSnapshot,
  command: ProjectCommand,
  timestamp: string,
  previewMode = false,
): CommandPlan {
  const snapshot = clone(snapshotInput);

  if (command.type === "canvas.create_shot") {
    const scene =
      (command.sceneId
        ? snapshot.scenes.find((candidate) => candidate.id === command.sceneId)
        : undefined) ?? snapshot.scenes[0];
    if (!scene) throw new ProjectCommandError(409, "项目还没有可用画板");
    const order = snapshot.shots.filter((shot) => shot.sceneId === scene.id).length;
    const shotId = createTakeBoardId("shot");
    const itemId = createTakeBoardId("canvas_item");
    const shot: Shot = {
      id: shotId,
      projectId: snapshot.project.id,
      sceneId: scene.id,
      label: command.label || `SH-${String(order + 1).padStart(2, "0")}`,
      order,
      intent: command.intent ?? "",
      durationSeconds: command.durationSeconds ?? 5,
      aspectRatio: command.aspectRatio ?? snapshot.project.defaultAspectRatio,
      workflowPath: null,
      status: "draft",
      approvedTakeId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const item: CanvasItem = {
      id: itemId,
      sceneId: scene.id,
      refType: "shot",
      refId: shotId,
      x: command.x ?? 180 + order * 380,
      y: command.y ?? 180,
      width: 330,
      height: 190,
      zIndex: Math.max(0, ...snapshot.canvasItems.map((candidate) => candidate.zIndex)) + 1,
      parentGroupId: null,
      collapsed: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    snapshot.shots.push(shot);
    snapshot.canvasItems.push(item);
    touch(snapshot, timestamp);
    return {
      snapshot,
      summary: `创建镜头“${shot.label}”`,
      effects: [
        effect("create", "shot", previewMode ? null : shotId, shot.label),
        effect("create", "canvas_item", previewMode ? null : itemId, `${shot.label} 的画布节点`),
      ],
      warnings: [],
      requiresConfirmation: false,
      inverse: {
        kind: "remove_created_shot",
        shotId,
        shotUpdatedAt: timestamp,
        itemId,
        itemUpdatedAt: timestamp,
      },
      result: { shotId, itemId, sceneId: scene.id },
    };
  }

  if (command.type === "canvas.add_item") {
    if (!sourceExists(snapshot, command.refType, command.refId)) {
      throw new ProjectCommandError(404, "节点来源不存在");
    }
    const sourceShot = snapshot.shots.find((shot) => shot.id === command.refId);
    const sceneId =
      command.refType === "shot" || command.refType === "take_stack"
        ? sourceShot?.sceneId
        : (command.sceneId ?? snapshot.scenes[0]?.id);
    if (!sceneId || !snapshot.scenes.some((scene) => scene.id === sceneId)) {
      throw new ProjectCommandError(400, "节点场景无效");
    }
    const itemId = createTakeBoardId("canvas_item");
    const item: CanvasItem = {
      id: itemId,
      sceneId,
      refType: command.refType,
      refId: command.refId,
      x: command.x ?? 180,
      y: command.y ?? 180,
      width: command.width ?? (command.refType === "shot" ? 330 : 280),
      height: command.refType === "shot" ? 190 : 180,
      zIndex: Math.max(0, ...snapshot.canvasItems.map((candidate) => candidate.zIndex)) + 1,
      parentGroupId: null,
      collapsed: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    snapshot.canvasItems.push(item);
    touch(snapshot, timestamp);
    const label = itemLabel(snapshot, item);
    return {
      snapshot,
      summary: `将“${label}”加入画布`,
      effects: [effect("create", "canvas_item", previewMode ? null : itemId, label)],
      warnings: [],
      requiresConfirmation: false,
      inverse: { kind: "remove_created_item", itemId, itemUpdatedAt: timestamp },
      result: { itemId, sceneId },
    };
  }

  if (command.type === "canvas.create_text") {
    const scene =
      (command.sceneId
        ? snapshot.scenes.find((candidate) => candidate.id === command.sceneId)
        : undefined) ?? snapshot.scenes[0];
    if (!scene) throw new ProjectCommandError(409, "项目还没有可用画板");
    const textId = createTakeBoardId("text");
    const itemId = createTakeBoardId("canvas_item");
    const text: TextItem = {
      id: textId,
      projectId: snapshot.project.id,
      sceneId: scene.id,
      kind: "direction_note",
      title: command.title || "新笔记",
      body: command.body ?? "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const item: CanvasItem = {
      id: itemId,
      sceneId: scene.id,
      refType: "text",
      refId: textId,
      x: command.x ?? 180,
      y: command.y ?? 180,
      width: 300,
      height: 190,
      zIndex: Math.max(0, ...snapshot.canvasItems.map((candidate) => candidate.zIndex)) + 1,
      parentGroupId: null,
      collapsed: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    snapshot.textItems.push(text);
    snapshot.canvasItems.push(item);
    touch(snapshot, timestamp);
    return {
      snapshot,
      summary: `创建笔记“${text.title}”`,
      effects: [
        effect("create", "text", previewMode ? null : text.id, text.title),
        effect("create", "canvas_item", previewMode ? null : item.id, `${text.title} 的画布节点`),
      ],
      warnings: [],
      requiresConfirmation: false,
      inverse: {
        kind: "remove_created_text",
        textId,
        textUpdatedAt: timestamp,
        itemId,
        itemUpdatedAt: timestamp,
      },
      result: { textId, itemId, sceneId: scene.id },
    };
  }

  if (command.type === "canvas.duplicate_item") {
    const source = snapshot.canvasItems.find((candidate) => candidate.id === command.itemId);
    if (!source) throw new ProjectCommandError(404, "画布节点不存在");
    const itemId = createTakeBoardId("canvas_item");
    const item: CanvasItem = {
      ...clone(source),
      id: itemId,
      x: command.x ?? source.x + 36,
      y: command.y ?? source.y + 36,
      zIndex: Math.max(0, ...snapshot.canvasItems.map((candidate) => candidate.zIndex)) + 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    if (source.refType === "shot") {
      const sourceShot = snapshot.shots.find((candidate) => candidate.id === source.refId);
      if (!sourceShot) throw new ProjectCommandError(404, "镜头节点关联内容不存在");
      const shotId = createTakeBoardId("shot");
      const sceneShots = snapshot.shots.filter(
        (candidate) => candidate.sceneId === sourceShot.sceneId,
      );
      const baseLabel = `${sourceShot.label} 副本`.slice(0, 80);
      let label = baseLabel;
      for (
        let copyNumber = 2;
        snapshot.shots.some((candidate) => candidate.label === label);
        copyNumber += 1
      ) {
        const suffix = ` ${copyNumber}`;
        label = `${baseLabel.slice(0, 80 - suffix.length)}${suffix}`;
      }
      const shot: Shot = {
        ...clone(sourceShot),
        id: shotId,
        label,
        order: sceneShots.length,
        status: "draft",
        approvedTakeId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      item.refId = shotId;
      snapshot.shots.push(shot);
      snapshot.canvasItems.push(item);
      touch(snapshot, timestamp);
      return {
        snapshot,
        summary: `创建镜头“${shot.label}”的独立副本`,
        effects: [
          effect("create", "shot", previewMode ? null : shotId, shot.label),
          effect("create", "canvas_item", previewMode ? null : itemId, `${shot.label} 的画布节点`),
        ],
        warnings: ["副本会保留镜头设置，但不会继承候选结果、批准状态或生成记录"],
        requiresConfirmation: false,
        inverse: {
          kind: "remove_created_shot",
          shotId,
          shotUpdatedAt: timestamp,
          itemId,
          itemUpdatedAt: timestamp,
        },
        result: { itemId, shotId, sourceItemId: source.id, copyMode: "independent" },
      };
    }

    if (source.refType === "text") {
      const sourceText = snapshot.textItems.find((candidate) => candidate.id === source.refId);
      if (!sourceText) throw new ProjectCommandError(404, "文字节点关联内容不存在");
      const textId = createTakeBoardId("text");
      const text: TextItem = {
        ...clone(sourceText),
        id: textId,
        title: `${sourceText.title} 副本`.slice(0, 200),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      item.refId = textId;
      snapshot.textItems.push(text);
      snapshot.canvasItems.push(item);
      touch(snapshot, timestamp);
      return {
        snapshot,
        summary: `创建笔记“${text.title}”的独立副本`,
        effects: [
          effect("create", "text", previewMode ? null : textId, text.title),
          effect("create", "canvas_item", previewMode ? null : itemId, `${text.title} 的画布节点`),
        ],
        warnings: [],
        requiresConfirmation: false,
        inverse: {
          kind: "remove_created_text",
          textId,
          textUpdatedAt: timestamp,
          itemId,
          itemUpdatedAt: timestamp,
        },
        result: { itemId, textId, sourceItemId: source.id, copyMode: "independent" },
      };
    }

    snapshot.canvasItems.push(item);
    touch(snapshot, timestamp);
    const label = itemLabel(snapshot, item);
    return {
      snapshot,
      summary: `复制“${label}”的画布节点`,
      effects: [effect("create", "canvas_item", previewMode ? null : itemId, `${label}（副本）`)],
      warnings: ["复制的是画布呈现，底层素材、人物或候选记录仍为同一份内容"],
      requiresConfirmation: false,
      inverse: { kind: "remove_created_item", itemId, itemUpdatedAt: timestamp },
      result: { itemId, sourceItemId: source.id, copyMode: "reference" },
    };
  }

  if (command.type === "canvas.edit_item") {
    if (Object.keys(command).every((key) => key === "type" || key === "itemId")) {
      throw new ProjectCommandError(400, "没有需要保存的修改");
    }
    const item = snapshot.canvasItems.find((candidate) => candidate.id === command.itemId);
    if (!item) throw new ProjectCommandError(404, "画布节点不存在");
    if (item.refType === "take_stack") {
      throw new ProjectCommandError(409, "候选组由运行记录管理，不能直接编辑");
    }
    const previous =
      item.refType === "text"
        ? snapshot.textItems.find((candidate) => candidate.id === item.refId)
        : item.refType === "entity"
          ? snapshot.entities.find((candidate) => candidate.id === item.refId)
          : item.refType === "asset"
            ? snapshot.assets.find((candidate) => candidate.id === item.refId)
            : snapshot.shots.find((candidate) => candidate.id === item.refId);
    if (!previous) throw new ProjectCommandError(404, "节点关联内容不存在");
    const before = clone(previous);
    if (item.refType === "text") {
      const text = previous as TextItem;
      if (command.title !== undefined) text.title = command.title.trim().slice(0, 200);
      if (command.body !== undefined) text.body = command.body.slice(0, 100_000);
      text.updatedAt = timestamp;
    } else if (item.refType === "entity") {
      const entity = previous as Entity;
      if (command.title?.trim()) entity.name = command.title.trim().slice(0, 200);
      if (command.body !== undefined) entity.description = command.body.slice(0, 10_000);
      entity.updatedAt = timestamp;
    } else if (item.refType === "asset") {
      const asset = previous as Asset;
      if (command.title?.trim()) asset.originalName = command.title.trim().slice(0, 512);
      if (command.customTags) {
        if (new Set(command.customTags).size !== command.customTags.length) {
          throw new ProjectCommandError(400, "自定义标签不能重复");
        }
        asset.customTags = command.customTags;
      }
      asset.updatedAt = timestamp;
    } else {
      const shot = previous as Shot;
      if (command.title?.trim()) shot.label = command.title.trim().slice(0, 80);
      if (command.body !== undefined) shot.intent = command.body.slice(0, 20_000);
      if (command.durationSeconds !== undefined) shot.durationSeconds = command.durationSeconds;
      if (command.aspectRatio !== undefined) shot.aspectRatio = command.aspectRatio;
      if (command.workflowPath !== undefined) {
        const runWorkflowPath = [...snapshot.runs].reverse().find((run) => run.shotId === shot.id)
          ?.parameters.recipePath;
        const lockedWorkflowPath =
          shot.workflowPath ?? (typeof runWorkflowPath === "string" ? runWorkflowPath : null);
        if (
          snapshot.runs.some((run) => run.shotId === shot.id) &&
          lockedWorkflowPath &&
          lockedWorkflowPath !== command.workflowPath
        ) {
          throw new ProjectCommandError(409, "这个镜头已有运行记录，工作流已锁定");
        }
        shot.workflowPath = command.workflowPath;
      }
      shot.updatedAt = timestamp;
    }
    const applied = clone(previous);
    touch(snapshot, timestamp);
    const label = itemLabel(snapshot, item);
    const entityType = item.refType;
    return {
      snapshot,
      summary: `更新“${label}”`,
      effects: [effect("update", entityType, item.refId, label)],
      warnings: [],
      requiresConfirmation: false,
      inverse: {
        kind: "restore_domain_record",
        refType: item.refType,
        previous: before,
        applied,
      },
      result: { itemId: item.id, refType: item.refType, refId: item.refId },
    };
  }

  if (command.type === "canvas.connect_items") {
    const source = snapshot.canvasItems.find((item) => item.id === command.sourceItemId);
    const target = snapshot.canvasItems.find((item) => item.id === command.targetItemId);
    if (
      !source ||
      !target ||
      source.sceneId !== target.sceneId ||
      !["asset", "entity", "shot"].includes(source.refType) ||
      source.id === target.id ||
      target.refType !== "shot"
    ) {
      throw new ProjectCommandError(400, "图片、视频、实体或其他镜头的生成结果才能连接到镜头输入");
    }
    const expectedMediaType =
      command.targetSlot === "reference_video"
        ? "video"
        : command.targetSlot === "reference_audio"
          ? "audio"
          : "image";
    const assetId = canvasSourceAssetId(snapshot, source, expectedMediaType);
    const asset = snapshot.assets.find(
      (candidate) => candidate.id === assetId && candidate.mediaType === expectedMediaType,
    );
    if (!asset) {
      const mediaLabel =
        expectedMediaType === "video" ? "视频" : expectedMediaType === "audio" ? "音频" : "图片";
      throw new ProjectCommandError(400, `该节点没有可用的${mediaLabel}素材`);
    }
    const occupiedEdges = snapshot.canvasEdges.filter(
      (edge) => edge.targetItemId === target.id && edge.targetSlot === command.targetSlot,
    );
    const multipleSlot = ["reference", "reference_video", "reference_audio"].includes(
      command.targetSlot,
    );
    if (multipleSlot && occupiedEdges.some((edge) => edge.sourceItemId === source.id)) {
      return {
        snapshot,
        summary: `“${itemLabel(snapshot, source)}”已连接到“${itemLabel(snapshot, target)}”`,
        effects: [],
        warnings: [],
        requiresConfirmation: false,
        inverse: null,
        result: {
          existingEdgeId: occupiedEdges.find((edge) => edge.sourceItemId === source.id)?.id,
        },
      };
    }
    const capacity = command.targetSlot === "reference" ? 9 : 3;
    if (multipleSlot && occupiedEdges.length >= capacity) {
      const message =
        command.targetSlot === "reference_video"
          ? "这个工作流最多连接 3 段参考视频"
          : command.targetSlot === "reference_audio"
            ? "这个工作流最多连接 3 段参考音频"
            : "这个工作流最多连接 9 张参考图";
      throw new ProjectCommandError(409, message);
    }
    const replacedEdges = multipleSlot ? [] : occupiedEdges.filter((edge) => !edge.immutable);
    if (replacedEdges.length > 0) {
      const replaced = new Set(replacedEdges.map((edge) => edge.id));
      snapshot.canvasEdges = snapshot.canvasEdges.filter((edge) => !replaced.has(edge.id));
    }
    const edgeId = createTakeBoardId("canvas_edge");
    const edge: CanvasEdge = {
      id: edgeId,
      sceneId: target.sceneId,
      sourceItemId: source.id,
      targetItemId: target.id,
      relation: "reference",
      targetSlot: command.targetSlot,
      targetSlotIndex: multipleSlot
        ? Math.max(-1, ...occupiedEdges.map((candidate) => candidate.targetSlotIndex)) + 1
        : 0,
      runId: null,
      immutable: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    snapshot.canvasEdges.push(edge);
    touch(snapshot, timestamp);
    const sourceLabel = itemLabel(snapshot, source);
    const targetLabel = itemLabel(snapshot, target);
    const effects = [
      ...replacedEdges.map((candidate) =>
        effect("disconnect", "canvas_edge", candidate.id, "替换原有输入连线"),
      ),
      effect(
        "connect",
        "canvas_edge",
        previewMode ? null : edgeId,
        `${sourceLabel} → ${targetLabel}`,
        command.targetSlot,
      ),
    ];
    return {
      snapshot,
      summary: `连接“${sourceLabel}”与“${targetLabel}”`,
      effects,
      warnings: replacedEdges.length > 0 ? ["该输入位已有连线，执行后会替换原连线"] : [],
      requiresConfirmation: replacedEdges.length > 0,
      inverse: { kind: "restore_connection_change", createdEdgeId: edgeId, replacedEdges },
      result: { edgeId, assetId, replacedEdgeIds: replacedEdges.map((candidate) => candidate.id) },
    };
  }

  if (command.type === "canvas.disconnect") {
    const edge = snapshot.canvasEdges.find((candidate) => candidate.id === command.edgeId);
    if (!edge) throw new ProjectCommandError(404, "连线不存在");
    if (edge.immutable) throw new ProjectCommandError(409, "生成溯源连线不能删除");
    snapshot.canvasEdges = snapshot.canvasEdges.filter((candidate) => candidate.id !== edge.id);
    touch(snapshot, timestamp);
    return {
      snapshot,
      summary: "删除画布连线",
      effects: [effect("disconnect", "canvas_edge", edge.id, "画布输入连线", edge.targetSlot)],
      warnings: [],
      requiresConfirmation: false,
      inverse: { kind: "restore_edge", edge: clone(edge) },
      result: { removedEdgeId: edge.id },
    };
  }

  if (command.type === "canvas.move_item") {
    const item = snapshot.canvasItems.find((candidate) => candidate.id === command.itemId);
    if (!item) throw new ProjectCommandError(404, "画布节点不存在");
    const from = { x: item.x, y: item.y };
    item.x = command.x;
    item.y = command.y;
    item.updatedAt = timestamp;
    touch(snapshot, timestamp);
    return {
      snapshot,
      summary: `移动“${itemLabel(snapshot, item)}”`,
      effects: [
        effect("update", "canvas_item", item.id, itemLabel(snapshot, item), "更新画布位置"),
      ],
      warnings: [],
      requiresConfirmation: false,
      inverse: {
        kind: "restore_position",
        itemId: item.id,
        from,
        applied: { x: item.x, y: item.y },
      },
      result: { itemId: item.id, x: item.x, y: item.y },
    };
  }

  if (command.type === "canvas.arrange_scene") {
    const scene =
      (command.sceneId
        ? snapshot.scenes.find((candidate) => candidate.id === command.sceneId)
        : undefined) ?? snapshot.scenes[0];
    if (!scene) throw new ProjectCommandError(409, "项目还没有可用画板");
    const items = snapshot.canvasItems.filter((item) => item.sceneId === scene.id);
    if (items.length < 2) throw new ProjectCommandError(409, "至少需要两个节点才能整理画布");
    const itemById = new Map(items.map((item) => [item.id, item]));
    const layers = new Map(
      items.map((item) => [
        item.id,
        item.refType === "take_stack" ? 2 : item.refType === "shot" ? 1 : 0,
      ]),
    );
    const edges = snapshot.canvasEdges.filter(
      (edge) =>
        edge.sceneId === scene.id &&
        itemById.has(edge.sourceItemId) &&
        itemById.has(edge.targetItemId),
    );
    // Longest-path relaxation creates a readable left-to-right flow. The iteration
    // cap makes cycles harmless: they retain a bounded, deterministic layout.
    let cyclicFlow = false;
    for (let pass = 0; pass < items.length; pass += 1) {
      let changed = false;
      for (const edge of edges) {
        const sourceLayer = layers.get(edge.sourceItemId) ?? 0;
        const targetLayer = layers.get(edge.targetItemId) ?? 0;
        const nextLayer = Math.min(items.length, sourceLayer + 1);
        if (nextLayer > targetLayer) {
          layers.set(edge.targetItemId, nextLayer);
          changed = true;
        }
      }
      if (changed && pass === items.length - 1) cyclicFlow = true;
      if (!changed) break;
    }
    for (const item of items) {
      if (item.refType !== "take_stack") continue;
      const shotItem = items.find(
        (candidate) => candidate.refType === "shot" && candidate.refId === item.refId,
      );
      layers.set(item.id, Math.min(items.length, (layers.get(shotItem?.id ?? "") ?? 1) + 1));
    }
    const usedLayers = [...new Set(layers.values())].sort((left, right) => left - right);
    const compactLayer = new Map(usedLayers.map((layer, index) => [layer, index]));
    const grouped = new Map<number, CanvasItem[]>();
    for (const item of items) {
      const layer = compactLayer.get(layers.get(item.id) ?? 0) ?? 0;
      grouped.set(layer, [...(grouped.get(layer) ?? []), item]);
    }
    const originX = Math.min(...items.map((item) => item.x));
    const originY = Math.min(...items.map((item) => item.y));
    const columnX = new Map<number, number>();
    let nextX = originX;
    for (const layer of [...grouped.keys()].sort((left, right) => left - right)) {
      columnX.set(layer, nextX);
      const widest = Math.max(...(grouped.get(layer) ?? []).map((item) => item.width));
      nextX += widest + 120;
    }
    const moved: Array<{
      itemId: string;
      from: { x: number; y: number };
      applied: { x: number; y: number };
    }> = [];
    for (const [layer, layerItems] of grouped) {
      let nextY = originY;
      for (const item of [...layerItems].sort(
        (left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id),
      )) {
        const applied = { x: columnX.get(layer) ?? originX, y: nextY };
        nextY += Math.max(120, item.height) + 64;
        if (Math.abs(item.x - applied.x) < 1 && Math.abs(item.y - applied.y) < 1) continue;
        moved.push({ itemId: item.id, from: { x: item.x, y: item.y }, applied });
        item.x = applied.x;
        item.y = applied.y;
        item.updatedAt = timestamp;
      }
    }
    if (moved.length === 0) throw new ProjectCommandError(409, "当前画布已经排列整齐");
    touch(snapshot, timestamp);
    return {
      snapshot,
      summary: `整理“${scene.title || scene.label}”的 ${moved.length} 个节点`,
      effects: moved.map((entry) => {
        const item = itemById.get(entry.itemId) as CanvasItem;
        return effect(
          "update",
          "canvas_item",
          entry.itemId,
          itemLabel(snapshot, item),
          "重新排列位置",
        );
      }),
      warnings: [
        "只调整节点位置；不会更改连线、素材、镜头或生成记录",
        ...(cyclicFlow ? ["检测到循环连线；循环部分按稳定顺序分层"] : []),
      ],
      requiresConfirmation: true,
      inverse: { kind: "restore_positions", items: moved },
      result: { sceneId: scene.id, movedItemIds: moved.map((entry) => entry.itemId) },
    };
  }

  if (command.type === "canvas.remove_item") {
    const item = snapshot.canvasItems.find((candidate) => candidate.id === command.itemId);
    if (!item) throw new ProjectCommandError(404, "画布节点不存在");
    const edges = snapshot.canvasEdges.filter(
      (edge) => edge.sourceItemId === item.id || edge.targetItemId === item.id,
    );
    const edgeIds = new Set(edges.map((edge) => edge.id));
    snapshot.canvasItems = snapshot.canvasItems.filter((candidate) => candidate.id !== item.id);
    snapshot.canvasEdges = snapshot.canvasEdges.filter((edge) => !edgeIds.has(edge.id));
    touch(snapshot, timestamp);
    const label = itemLabel(snapshotInput, item);
    return {
      snapshot,
      summary: `从画布移除“${label}”`,
      effects: [
        effect("remove", "canvas_item", item.id, label, "保留素材或镜头本体"),
        ...edges.map((edge) => effect("disconnect", "canvas_edge", edge.id, "随节点移除的连线")),
      ],
      warnings: edges.length > 0 ? [`同时移除 ${edges.length} 条相连的连线`] : [],
      requiresConfirmation: true,
      inverse: { kind: "restore_item", item: clone(item), edges: clone(edges) },
      result: { removedItemId: item.id, removedEdgeIds: [...edgeIds] },
    };
  }

  if (command.type === "shot.reorder") {
    const target = snapshot.shots.find((candidate) => candidate.id === command.shotId);
    if (!target) throw new ProjectCommandError(404, "镜头不存在");
    const sceneShots = snapshot.shots
      .filter((candidate) => candidate.sceneId === target.sceneId)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    if (command.toIndex >= sceneShots.length) {
      throw new ProjectCommandError(400, "目标顺序超出当前场次的镜头范围");
    }
    const fromIndex = sceneShots.findIndex((candidate) => candidate.id === target.id);
    if (fromIndex === command.toIndex) {
      throw new ProjectCommandError(409, "镜头已经位于这个顺序");
    }
    const previous = sceneShots.map((candidate) => ({
      shotId: candidate.id,
      order: candidate.order,
    }));
    const [moved] = sceneShots.splice(fromIndex, 1);
    if (!moved) throw new ProjectCommandError(404, "镜头不存在");
    sceneShots.splice(command.toIndex, 0, moved);
    const changed: Shot[] = [];
    sceneShots.forEach((candidate, order) => {
      if (candidate.order === order) return;
      candidate.order = order;
      candidate.updatedAt = timestamp;
      changed.push(candidate);
    });
    const applied = sceneShots.map((candidate) => ({
      shotId: candidate.id,
      order: candidate.order,
    }));
    touch(snapshot, timestamp);
    return {
      snapshot,
      summary: `将“${target.label}”移到第 ${command.toIndex + 1} 位`,
      effects: changed.map((candidate) =>
        effect(
          "update",
          "shot",
          candidate.id,
          candidate.label,
          `顺序调整为 ${candidate.order + 1}`,
        ),
      ),
      warnings: ["只调整当前场次的播放顺序；画布节点位置和生成记录保持不变"],
      requiresConfirmation: false,
      inverse: {
        kind: "restore_shot_orders",
        sceneId: target.sceneId,
        previous,
        applied,
      },
      result: {
        shotId: target.id,
        sceneId: target.sceneId,
        fromIndex,
        toIndex: command.toIndex,
        orderedShotIds: sceneShots.map((candidate) => candidate.id),
      },
    };
  }

  const shot = snapshot.shots.find((candidate) => candidate.id === command.shotId);
  if (!shot) throw new ProjectCommandError(404, "镜头不存在");
  if (snapshot.runs.some((run) => run.shotId === shot.id)) {
    throw new ProjectCommandError(
      409,
      "这个镜头已有生成记录。为保留成片与参数溯源，请先保留镜头或仅移除画布节点。",
    );
  }
  const items = snapshot.canvasItems.filter(
    (item) => item.refId === shot.id && (item.refType === "shot" || item.refType === "take_stack"),
  );
  const itemIds = new Set(items.map((item) => item.id));
  const edges = snapshot.canvasEdges.filter(
    (edge) => itemIds.has(edge.sourceItemId) || itemIds.has(edge.targetItemId),
  );
  const sceneOrders = snapshot.shots
    .filter((candidate) => candidate.sceneId === shot.sceneId)
    .map((candidate) => ({ shotId: candidate.id, order: candidate.order }));
  snapshot.shots = snapshot.shots.filter((candidate) => candidate.id !== shot.id);
  snapshot.canvasItems = snapshot.canvasItems.filter((item) => !itemIds.has(item.id));
  snapshot.canvasEdges = snapshot.canvasEdges.filter(
    (edge) => !itemIds.has(edge.sourceItemId) && !itemIds.has(edge.targetItemId),
  );
  snapshot.shots
    .filter((candidate) => candidate.sceneId === shot.sceneId)
    .sort((left, right) => left.order - right.order)
    .forEach((candidate, order) => {
      candidate.order = order;
      candidate.updatedAt = timestamp;
    });
  touch(snapshot, timestamp);
  return {
    snapshot,
    summary: `删除镜头“${shot.label}”`,
    effects: [
      effect("remove", "shot", shot.id, shot.label),
      ...items.map((item) => effect("remove", "canvas_item", item.id, `${shot.label} 的画布节点`)),
      ...edges.map((edge) => effect("disconnect", "canvas_edge", edge.id, "随镜头删除的连线")),
    ],
    warnings: ["镜头会从镜头列表和画布中同时移除"],
    requiresConfirmation: true,
    inverse: {
      kind: "restore_shot",
      shot: clone(shot),
      items: clone(items),
      edges: clone(edges),
      sceneOrders,
    },
    result: { removedShotId: shot.id, removedItemIds: [...itemIds] },
  };
}

function assertEdgeCanBeRestored(snapshot: ProjectSnapshot, edge: CanvasEdge) {
  if (snapshot.canvasEdges.some((candidate) => candidate.id === edge.id)) {
    throw new ProjectCommandError(409, "无法撤销：同标识的连线已经存在");
  }
  if (
    !snapshot.canvasItems.some((item) => item.id === edge.sourceItemId) ||
    !snapshot.canvasItems.some((item) => item.id === edge.targetItemId)
  ) {
    throw new ProjectCommandError(409, "无法撤销：连线端点已被删除");
  }
  if (
    snapshot.canvasEdges.some(
      (candidate) =>
        candidate.targetItemId === edge.targetItemId &&
        candidate.targetSlot === edge.targetSlot &&
        (candidate.targetSlotIndex === edge.targetSlotIndex ||
          candidate.sourceItemId === edge.sourceItemId),
    )
  ) {
    throw new ProjectCommandError(409, "无法撤销：原输入位置已被新的连线占用");
  }
}

function applyInverse(
  snapshotInput: ProjectSnapshot,
  inverse: ProjectCommandInverse,
  timestamp: string,
) {
  const snapshot = clone(snapshotInput);

  if (inverse.kind === "remove_created_shot") {
    const shot = snapshot.shots.find((candidate) => candidate.id === inverse.shotId);
    const item = snapshot.canvasItems.find((candidate) => candidate.id === inverse.itemId);
    if (!shot || !item) throw new ProjectCommandError(409, "无法撤销：新建的镜头或节点已不存在");
    if (shot.updatedAt !== inverse.shotUpdatedAt || item.updatedAt !== inverse.itemUpdatedAt) {
      throw new ProjectCommandError(409, "无法撤销：镜头在创建后已经被修改");
    }
    if (
      snapshot.runs.some((run) => run.shotId === shot.id) ||
      snapshot.canvasEdges.some(
        (edge) => edge.sourceItemId === item.id || edge.targetItemId === item.id,
      ) ||
      snapshot.canvasItems.some(
        (candidate) => candidate.id !== item.id && candidate.refId === shot.id,
      )
    ) {
      throw new ProjectCommandError(409, "无法撤销：该镜头已有后续内容或连接");
    }
    snapshot.shots = snapshot.shots.filter((candidate) => candidate.id !== shot.id);
    snapshot.canvasItems = snapshot.canvasItems.filter((candidate) => candidate.id !== item.id);
    snapshot.shots
      .filter((candidate) => candidate.sceneId === shot.sceneId)
      .sort((left, right) => left.order - right.order)
      .forEach((candidate, order) => {
        candidate.order = order;
        candidate.updatedAt = timestamp;
      });
  } else if (inverse.kind === "remove_created_text") {
    const text = snapshot.textItems.find((candidate) => candidate.id === inverse.textId);
    const item = snapshot.canvasItems.find((candidate) => candidate.id === inverse.itemId);
    if (!text || !item) throw new ProjectCommandError(409, "无法撤销：新建的笔记或节点已不存在");
    if (text.updatedAt !== inverse.textUpdatedAt || item.updatedAt !== inverse.itemUpdatedAt) {
      throw new ProjectCommandError(409, "无法撤销：笔记在创建后已经被修改");
    }
    if (
      snapshot.canvasEdges.some(
        (edge) => edge.sourceItemId === item.id || edge.targetItemId === item.id,
      ) ||
      snapshot.canvasItems.some(
        (candidate) => candidate.id !== item.id && candidate.refId === text.id,
      )
    ) {
      throw new ProjectCommandError(409, "无法撤销：该笔记已有后续画布内容");
    }
    snapshot.textItems = snapshot.textItems.filter((candidate) => candidate.id !== text.id);
    snapshot.canvasItems = snapshot.canvasItems.filter((candidate) => candidate.id !== item.id);
  } else if (inverse.kind === "remove_created_item") {
    const item = snapshot.canvasItems.find((candidate) => candidate.id === inverse.itemId);
    if (!item) throw new ProjectCommandError(409, "无法撤销：新建的节点已不存在");
    if (
      item.updatedAt !== inverse.itemUpdatedAt ||
      snapshot.canvasEdges.some(
        (edge) => edge.sourceItemId === item.id || edge.targetItemId === item.id,
      )
    ) {
      throw new ProjectCommandError(409, "无法撤销：该节点在创建后已经修改或连接");
    }
    snapshot.canvasItems = snapshot.canvasItems.filter((candidate) => candidate.id !== item.id);
  } else if (inverse.kind === "restore_connection_change") {
    if (!snapshot.canvasEdges.some((edge) => edge.id === inverse.createdEdgeId)) {
      throw new ProjectCommandError(409, "无法撤销：新连线已被修改或删除");
    }
    snapshot.canvasEdges = snapshot.canvasEdges.filter((edge) => edge.id !== inverse.createdEdgeId);
    for (const edge of inverse.replacedEdges) assertEdgeCanBeRestored(snapshot, edge);
    snapshot.canvasEdges.push(...clone(inverse.replacedEdges));
  } else if (inverse.kind === "restore_edge") {
    assertEdgeCanBeRestored(snapshot, inverse.edge);
    snapshot.canvasEdges.push(clone(inverse.edge));
  } else if (inverse.kind === "restore_position") {
    const item = snapshot.canvasItems.find((candidate) => candidate.id === inverse.itemId);
    if (!item) throw new ProjectCommandError(409, "无法撤销：节点已经不存在");
    if (item.x !== inverse.applied.x || item.y !== inverse.applied.y) {
      throw new ProjectCommandError(409, "无法撤销：节点位置后来又发生了变化");
    }
    item.x = inverse.from.x;
    item.y = inverse.from.y;
    item.updatedAt = timestamp;
  } else if (inverse.kind === "restore_positions") {
    for (const entry of inverse.items) {
      const item = snapshot.canvasItems.find((candidate) => candidate.id === entry.itemId);
      if (!item) throw new ProjectCommandError(409, "无法撤销：整理过的节点已经不存在");
      if (item.x !== entry.applied.x || item.y !== entry.applied.y) {
        throw new ProjectCommandError(409, "无法撤销：整理后有节点又被移动过");
      }
    }
    for (const entry of inverse.items) {
      const item = snapshot.canvasItems.find((candidate) => candidate.id === entry.itemId);
      if (!item) continue;
      item.x = entry.from.x;
      item.y = entry.from.y;
      item.updatedAt = timestamp;
    }
  } else if (inverse.kind === "restore_shot_orders") {
    const current = snapshot.shots
      .filter((shot) => shot.sceneId === inverse.sceneId)
      .map((shot) => ({ shotId: shot.id, order: shot.order }))
      .sort((left, right) => left.shotId.localeCompare(right.shotId));
    const applied = [...inverse.applied].sort((left, right) =>
      left.shotId.localeCompare(right.shotId),
    );
    if (JSON.stringify(current) !== JSON.stringify(applied)) {
      throw new ProjectCommandError(409, "无法撤销：镜头顺序在本次调整后又发生了变化");
    }
    for (const previous of inverse.previous) {
      const shot = snapshot.shots.find((candidate) => candidate.id === previous.shotId);
      if (!shot) throw new ProjectCommandError(409, "无法撤销：原顺序中的镜头已不存在");
      shot.order = previous.order;
      shot.updatedAt = timestamp;
    }
  } else if (inverse.kind === "restore_domain_record") {
    const collection =
      inverse.refType === "text"
        ? snapshot.textItems
        : inverse.refType === "entity"
          ? snapshot.entities
          : inverse.refType === "asset"
            ? snapshot.assets
            : snapshot.shots;
    const index = collection.findIndex((candidate) => candidate.id === inverse.applied.id);
    const current = collection[index];
    if (!current) throw new ProjectCommandError(409, "无法撤销：被编辑的内容已不存在");
    if (JSON.stringify(current) !== JSON.stringify(inverse.applied)) {
      throw new ProjectCommandError(409, "无法撤销：该内容在编辑后又发生了变化");
    }
    if (inverse.refType === "text") {
      snapshot.textItems[index] = clone(inverse.previous as TextItem);
    } else if (inverse.refType === "entity") {
      snapshot.entities[index] = clone(inverse.previous as Entity);
    } else if (inverse.refType === "asset") {
      snapshot.assets[index] = clone(inverse.previous as Asset);
    } else {
      snapshot.shots[index] = clone(inverse.previous as Shot);
    }
  } else if (inverse.kind === "restore_item") {
    if (snapshot.canvasItems.some((item) => item.id === inverse.item.id)) {
      throw new ProjectCommandError(409, "无法撤销：同标识的节点已经存在");
    }
    if (
      !snapshot.scenes.some((scene) => scene.id === inverse.item.sceneId) ||
      !sourceExists(snapshot, inverse.item.refType, inverse.item.refId)
    ) {
      throw new ProjectCommandError(409, "无法撤销：节点关联的原始内容已不存在");
    }
    snapshot.canvasItems.push(clone(inverse.item));
    for (const edge of inverse.edges) assertEdgeCanBeRestored(snapshot, edge);
    snapshot.canvasEdges.push(...clone(inverse.edges));
  } else {
    if (snapshot.shots.some((shot) => shot.id === inverse.shot.id)) {
      throw new ProjectCommandError(409, "无法撤销：同标识的镜头已经存在");
    }
    if (!snapshot.scenes.some((scene) => scene.id === inverse.shot.sceneId)) {
      throw new ProjectCommandError(409, "无法撤销：镜头所属画板已不存在");
    }
    const originalSceneShotIds = new Set(inverse.sceneOrders.map((entry) => entry.shotId));
    if (
      snapshot.shots.some(
        (shot) => shot.sceneId === inverse.shot.sceneId && !originalSceneShotIds.has(shot.id),
      )
    ) {
      throw new ProjectCommandError(409, "无法撤销：删除后该画板又创建了新的镜头");
    }
    const itemIds = new Set(inverse.items.map((item) => item.id));
    if (snapshot.canvasItems.some((item) => itemIds.has(item.id))) {
      throw new ProjectCommandError(409, "无法撤销：镜头的画布位置已被其他节点占用");
    }
    snapshot.shots.push(clone(inverse.shot));
    snapshot.canvasItems.push(...clone(inverse.items));
    for (const edge of inverse.edges) assertEdgeCanBeRestored(snapshot, edge);
    snapshot.canvasEdges.push(...clone(inverse.edges));
    for (const order of inverse.sceneOrders) {
      const shot = snapshot.shots.find((candidate) => candidate.id === order.shotId);
      if (shot) {
        shot.order = order.order;
        shot.updatedAt = timestamp;
      }
    }
  }

  touch(snapshot, timestamp);
  return snapshot;
}

function parseInverse(command: StoredProjectCommand): ProjectCommandInverse {
  if (!command.inverse || typeof command.inverse !== "object" || !("kind" in command.inverse)) {
    throw new ProjectCommandError(409, "这条操作不支持撤销");
  }
  return command.inverse as ProjectCommandInverse;
}

export class ProjectCommandService {
  preview(
    store: ProjectStore,
    request: { command: ProjectCommand; expectedRevision?: number | undefined },
  ) {
    const current = store.loadCurrent();
    if (!current) throw new ProjectCommandError(404, "项目不存在");
    assertRevision(request.expectedRevision, current.revision);
    const plan = buildPlan(current.snapshot, request.command, toIsoTimestamp(), true);
    return {
      commandType: request.command.type,
      summary: plan.summary,
      currentRevision: current.revision,
      effects: plan.effects,
      warnings: plan.warnings,
      requiresConfirmation: plan.requiresConfirmation,
      undoable: plan.inverse !== null,
      confirmationToken: plan.requiresConfirmation
        ? confirmationToken(request.command, current.revision)
        : null,
    } satisfies ProjectCommandPreview;
  }

  async execute(
    store: ProjectStore,
    envelope: ProjectCommandEnvelope,
  ): Promise<CommandExecutionResult> {
    const current = store.loadCurrent();
    if (!current) throw new ProjectCommandError(404, "项目不存在");
    const prior = store.findCommandByRequestId(current.snapshot.project.id, envelope.requestId);
    if (prior) {
      if (JSON.stringify(prior.request) !== JSON.stringify(envelope)) {
        throw new ProjectCommandError(409, "这个请求标识已经用于另一项操作");
      }
      return {
        commandId: prior.id,
        replayed: true,
        status: prior.status,
        result: prior.result,
        revision: current.revision,
        snapshot: current.snapshot,
      };
    }
    assertRevision(envelope.expectedRevision, current.revision);
    const timestamp = toIsoTimestamp();
    const plan = buildPlan(current.snapshot, envelope.command, timestamp);
    if (
      plan.requiresConfirmation &&
      envelope.confirmationToken !== confirmationToken(envelope.command, current.revision)
    ) {
      throw new ProjectCommandError(409, "这项操作会移除或替换内容，请先预览并确认影响范围");
    }
    const commandId = createTakeBoardId("command");
    const saved = await store.save(plan.snapshot, {
      type: "command.applied",
      payload: { commandId, commandType: envelope.command.type },
      command: {
        id: commandId,
        commandType: envelope.command.type,
        requestId: envelope.requestId,
        request: envelope,
        inverse: plan.inverse,
        result: plan.result,
        effects: plan.effects,
        summary: plan.summary,
      },
    });
    return {
      commandId,
      replayed: false,
      status: "applied",
      result: plan.result,
      ...saved,
    };
  }

  async undo(store: ProjectStore, commandId: string): Promise<CommandExecutionResult> {
    const current = store.loadCurrent();
    if (!current) throw new ProjectCommandError(404, "项目不存在");
    const original = store.loadCommand(current.snapshot.project.id, commandId);
    if (!original) throw new ProjectCommandError(404, "操作记录不存在");
    if (original.status === "undone") throw new ProjectCommandError(409, "这条操作已经撤销");
    const inverse = parseInverse(original);
    const timestamp = toIsoTimestamp();
    const snapshot = applyInverse(current.snapshot, inverse, timestamp);
    const undoCommandId = createTakeBoardId("command");
    const result = { undoneCommandId: original.id };
    const effects = original.effects.map(
      (originalEffect): CommandEffect => ({
        ...originalEffect,
        action: {
          create: "remove",
          remove: "create",
          connect: "disconnect",
          disconnect: "connect",
          update: "update",
        }[originalEffect.action] as CommandEffect["action"],
        detail: "撤销原操作",
      }),
    );
    const saved = await store.save(snapshot, {
      type: "command.undone",
      payload: { commandId: original.id, undoCommandId },
      undoesCommandId: original.id,
      command: {
        id: undoCommandId,
        commandType: "command.undo",
        requestId: null,
        request: { type: "command.undo", targetCommandId: original.id },
        inverse: null,
        result,
        effects,
        summary: `撤销：${original.summary}`,
      },
    });
    return {
      commandId: undoCommandId,
      replayed: false,
      status: "applied",
      result,
      ...saved,
    };
  }
}
