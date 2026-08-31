import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type ExtensionFeature,
  type ExtensionManifest,
  type ExtensionQcIssue,
  extensionManifestSchema,
  type InstalledExtension,
  installedExtensionSchema,
  type ProjectSnapshot,
} from "@takeboard/contracts";
import { toIsoTimestamp } from "@takeboard/domain";

type ExtensionFile = { version: 1; extensions: InstalledExtension[] };

export const bundledExtensionIds = {
  roughCut: "studio.takeboard.rough-cut",
  costInsights: "studio.takeboard.cost-insights",
  batchReview: "studio.takeboard.batch-review",
  productionQc: "studio.takeboard.production-qc",
} as const;

const roughCutManifest = extensionManifestSchema.parse({
  format: "takeboard.extension",
  manifestVersion: 1,
  id: bundledExtensionIds.roughCut,
  name: "粗剪预览",
  version: "1.0.0",
  description: "按已采用镜头形成只读时间线，用于检查节奏和整片覆盖，不改写原始素材。",
  author: "TakeBoard",
  homepage: null,
  permissions: ["project.read"],
  contributions: { features: ["storyboard.rough_cut"] },
});

const costInsightsManifest = extensionManifestSchema.parse({
  format: "takeboard.extension",
  manifestVersion: 1,
  id: bundledExtensionIds.costInsights,
  name: "成本洞察",
  version: "1.0.0",
  description: "按 Run、镜头和成片分钟查看精确、估算与未知成本，适合配置了算力费率的工作室。",
  author: "TakeBoard",
  homepage: null,
  permissions: ["project.read"],
  contributions: {
    features: ["production.cost_insights"],
    qcRules: [
      {
        id: "unknown-costs",
        title: "运行成本未知",
        description: "执行端没有配置费率或提供账单，因此无法形成完整成本。",
        check: "unknown_costs",
        severity: "info",
      },
    ],
  },
});

const batchReviewManifest = extensionManifestSchema.parse({
  format: "takeboard.extension",
  manifestVersion: 1,
  id: bundledExtensionIds.batchReview,
  name: "批量审片",
  version: "1.0.0",
  description: "跨镜头选择候选、预览替换影响并一次提交，适合集中审片和团队交付。",
  author: "TakeBoard",
  homepage: null,
  permissions: ["project.read", "project.write"],
  contributions: { features: ["production.batch_approval"] },
});

const productionQcManifest = extensionManifestSchema.parse({
  format: "takeboard.extension",
  manifestVersion: 1,
  id: bundledExtensionIds.productionQc,
  name: "成片完整性质检",
  version: "1.0.0",
  description: "在提交成片前检查未采用镜头、失败运行与素材元数据。",
  author: "TakeBoard",
  homepage: null,
  permissions: ["project.read"],
  contributions: {
    qcRules: [
      {
        id: "unapproved-shots",
        title: "仍有镜头未采用",
        description: "有候选结果的镜头仍未建立采用决策。",
        check: "unapproved_shots",
        severity: "blocker",
      },
      {
        id: "failed-runs",
        title: "生成任务需要处理",
        description: "失败或失联任务应在交付前重试或确认。",
        check: "failed_runs",
        severity: "warning",
      },
      {
        id: "asset-metadata",
        title: "视频元数据未完成",
        description: "视频尺寸、帧率或时长仍未完成检测。",
        check: "missing_asset_metadata",
        severity: "warning",
      },
    ],
  },
});

const bundledManifests = [
  roughCutManifest,
  costInsightsManifest,
  batchReviewManifest,
  productionQcManifest,
];
const bundledIds = new Set(bundledManifests.map((manifest) => manifest.id));

function canonicalManifest(manifest: ExtensionManifest) {
  return JSON.stringify(manifest);
}

export function extensionContentSha(manifest: ExtensionManifest) {
  return createHash("sha256").update(canonicalManifest(manifest)).digest("hex");
}

function bundledExtension(manifest: ExtensionManifest): InstalledExtension {
  const timestamp = "2026-08-31T00:00:00.000Z";
  return {
    manifest,
    contentSha256: extensionContentSha(manifest),
    source: "built_in",
    enabled: false,
    trust: "built_in",
    installedAt: timestamp,
    updatedAt: timestamp,
  };
}

export class ExtensionRegistry {
  private extensions: InstalledExtension[];

  constructor(private readonly storagePath: string) {
    this.extensions = this.load();
  }

  private load() {
    if (!existsSync(this.storagePath)) return [];
    try {
      const payload = JSON.parse(readFileSync(this.storagePath, "utf8")) as Partial<ExtensionFile>;
      if (payload.version !== 1 || !Array.isArray(payload.extensions)) return [];
      return payload.extensions.flatMap((extension) => {
        const parsed = installedExtensionSchema.safeParse(extension);
        if (!parsed.success) return [];
        if (parsed.data.source === "built_in" && !bundledIds.has(parsed.data.manifest.id))
          return [];
        if (parsed.data.source === "local_manifest" && bundledIds.has(parsed.data.manifest.id))
          return [];
        return [parsed.data];
      });
    } catch {
      return [];
    }
  }

  private async persist() {
    await mkdir(dirname(this.storagePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.storagePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      `${JSON.stringify({ version: 1, extensions: this.extensions } satisfies ExtensionFile, null, 2)}\n`,
      { flag: "w", mode: 0o600 },
    );
    await rename(temporary, this.storagePath);
    await chmod(this.storagePath, 0o600).catch(() => undefined);
  }

  list() {
    const bundled = bundledManifests.map((manifest) => {
      const saved = this.extensions.find(
        (extension) => extension.source === "built_in" && extension.manifest.id === manifest.id,
      );
      return saved
        ? { ...saved, manifest, contentSha256: extensionContentSha(manifest) }
        : bundledExtension(manifest);
    });
    const local = this.extensions.filter((extension) => extension.source === "local_manifest");
    return [...bundled, ...local].map((extension) => ({
      ...extension,
      manifest: {
        ...extension.manifest,
        permissions: [...extension.manifest.permissions],
        contributions: {
          features: [...extension.manifest.contributions.features],
          links: extension.manifest.contributions.links.map((link) => ({ ...link })),
          qcRules: extension.manifest.contributions.qcRules.map((rule) => ({ ...rule })),
        },
      },
    }));
  }

  features(): ExtensionFeature[] {
    return [
      ...new Set(
        this.list()
          .filter((extension) => extension.enabled)
          .flatMap((extension) => extension.manifest.contributions.features),
      ),
    ];
  }

  hasFeature(feature: ExtensionFeature) {
    return this.features().includes(feature);
  }

  inspect(input: unknown) {
    const parsed = extensionManifestSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? "扩展清单无效");
    }
    const manifest = parsed.data;
    const contentSha256 = extensionContentSha(manifest);
    const warnings = [
      ...(manifest.permissions.includes("network.open")
        ? ["此扩展会显示第三方链接；TakeBoard 只会在新窗口中打开，不会嵌入或自动请求。"]
        : []),
      "声明式扩展不会执行 JavaScript、Python、Shell 或 ComfyUI 自定义节点。",
    ];
    return {
      manifest,
      contentSha256,
      confirmationToken: contentSha256,
      permissions: manifest.permissions,
      warnings,
    };
  }

  async install(input: unknown, confirmationToken: string) {
    const inspected = this.inspect(input);
    if (inspected.confirmationToken !== confirmationToken) {
      throw new Error("扩展内容与预览不一致，请重新检查后安装");
    }
    if (bundledIds.has(inspected.manifest.id)) {
      throw new Error("不能覆盖 TakeBoard 内置扩展");
    }
    const existing = this.extensions.find(
      (extension) => extension.manifest.id === inspected.manifest.id,
    );
    const timestamp = toIsoTimestamp();
    const installed: InstalledExtension = {
      manifest: inspected.manifest,
      contentSha256: inspected.contentSha256,
      source: "local_manifest",
      enabled: false,
      trust: "user_trusted",
      installedAt: existing?.installedAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.extensions = [
      ...this.extensions.filter((extension) => extension.manifest.id !== inspected.manifest.id),
      installed,
    ];
    await this.persist();
    return installed;
  }

  async setEnabled(extensionId: string, enabled: boolean) {
    const listed = this.list().find((candidate) => candidate.manifest.id === extensionId);
    if (!listed) throw new Error("扩展不存在");
    const extension = { ...listed, enabled, updatedAt: toIsoTimestamp() };
    this.extensions = [
      ...this.extensions.filter((candidate) => candidate.manifest.id !== extensionId),
      extension,
    ];
    await this.persist();
    return extension;
  }

  async remove(extensionId: string) {
    if (bundledIds.has(extensionId)) return false;
    const previous = this.extensions.length;
    this.extensions = this.extensions.filter((extension) => extension.manifest.id !== extensionId);
    if (this.extensions.length === previous) return false;
    await this.persist();
    return true;
  }

  evaluate(snapshot: ProjectSnapshot): ExtensionQcIssue[] {
    const issues: ExtensionQcIssue[] = [];
    for (const extension of this.list().filter((candidate) => candidate.enabled)) {
      for (const rule of extension.manifest.contributions.qcRules) {
        let affectedIds: string[] = [];
        if (rule.check === "unapproved_shots") {
          const candidateShots = new Set(snapshot.takes.map((take) => take.shotId));
          affectedIds = snapshot.shots
            .filter((shot) => candidateShots.has(shot.id) && shot.approvedTakeId === null)
            .map((shot) => shot.id);
        } else if (rule.check === "failed_runs") {
          affectedIds = snapshot.runs
            .filter((run) => run.status === "failed" || run.status === "orphaned")
            .map((run) => run.id);
        } else if (rule.check === "missing_asset_metadata") {
          affectedIds = snapshot.assets
            .filter((asset) => asset.mediaType === "video" && asset.metadataInspectedAt === null)
            .map((asset) => asset.id);
        } else if (rule.check === "unknown_costs") {
          affectedIds = snapshot.runs
            .filter(
              (run) =>
                run.actualCost.accuracy === "unknown" && run.estimatedCost.accuracy === "unknown",
            )
            .map((run) => run.id);
        } else if (rule.check === "shots_without_candidates") {
          const candidateShots = new Set(snapshot.takes.map((take) => take.shotId));
          affectedIds = snapshot.shots
            .filter((shot) => !candidateShots.has(shot.id))
            .map((shot) => shot.id);
        }
        issues.push({
          extensionId: extension.manifest.id,
          ruleId: rule.id,
          title: rule.title,
          description: rule.description,
          severity: rule.severity,
          count: affectedIds.length,
          affectedIds: affectedIds.slice(0, 500),
        });
      }
    }
    return issues;
  }
}
