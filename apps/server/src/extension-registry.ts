import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type ExtensionManifest,
  type ExtensionQcIssue,
  extensionManifestSchema,
  type InstalledExtension,
  installedExtensionSchema,
  type ProjectSnapshot,
} from "@takeboard/contracts";
import { toIsoTimestamp } from "@takeboard/domain";

type ExtensionFile = { version: 1; extensions: InstalledExtension[] };

const productionQcManifest = extensionManifestSchema.parse({
  format: "takeboard.extension",
  manifestVersion: 1,
  id: "studio.takeboard.production-qc",
  name: "成片完整性质检",
  version: "1.0.0",
  description: "在提交成片前检查未采用镜头、失败运行、素材元数据与未知成本。",
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

function canonicalManifest(manifest: ExtensionManifest) {
  return JSON.stringify(manifest);
}

export function extensionContentSha(manifest: ExtensionManifest) {
  return createHash("sha256").update(canonicalManifest(manifest)).digest("hex");
}

function builtInExtension(): InstalledExtension {
  const timestamp = "2026-08-31T00:00:00.000Z";
  return {
    manifest: productionQcManifest,
    contentSha256: extensionContentSha(productionQcManifest),
    source: "built_in",
    enabled: true,
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
        return parsed.success && parsed.data.source === "local_manifest" ? [parsed.data] : [];
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
    return [builtInExtension(), ...this.extensions].map((extension) => ({
      ...extension,
      manifest: { ...extension.manifest },
    }));
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
    if (inspected.manifest.id === productionQcManifest.id) {
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
    const extension = this.extensions.find((candidate) => candidate.manifest.id === extensionId);
    if (!extension) throw new Error("扩展不存在或属于不可停用的内置能力");
    extension.enabled = enabled;
    extension.updatedAt = toIsoTimestamp();
    await this.persist();
    return extension;
  }

  async remove(extensionId: string) {
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
