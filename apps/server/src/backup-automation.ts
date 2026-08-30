import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import BetterSqlite3 from "better-sqlite3";
import type { FastifyInstance, FastifyReply } from "fastify";
import { authContext } from "./auth-routes.js";
import type { AuthService } from "./auth-service.js";
import {
  createInstanceBackup,
  instanceBackupPath,
  restoreInstanceOffline,
} from "./instance-backup.js";
import { ProjectStore } from "./storage/project-store.js";

const stateFormat = "takeboard.backup-automation-state";
const externalRecordFormat = "takeboard.external-instance-backup";
const restoreDrillFormat = "takeboard.restore-drill";
const stateFilename = "backup-automation.json";
const externalMetadataSuffix = ".external.json";
const maximumTimerDelay = 2_147_000_000;

export type BackupRetentionPolicy = {
  daily: number;
  weekly: number;
  monthly: number;
};

export type BackupAutomationConfig = {
  destination: string | null;
  intervalHours: number;
  localCopies: number;
  retention: BackupRetentionPolicy;
  restoreDrillIntervalDays: number;
  startupDelayMs?: number;
  configurationError?: string | null;
};

type BackupAutomationState = {
  format: typeof stateFormat;
  version: 1;
  sourceInstanceId: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  lastRestoreDrillAt: string | null;
  lastRestoreDrillPassed: boolean | null;
  lastRestoreDrillError: string | null;
};

export type ExternalBackupRecord = {
  format: typeof externalRecordFormat;
  version: 1;
  sourceInstanceId: string;
  id: string;
  filename: string;
  createdAt: string;
  copiedAt: string;
  size: number;
  archiveSha256: string;
  projectCount: number;
  userCount: number;
  separateDevice: boolean | null;
};

export type RestoreDrillReport = {
  format: typeof restoreDrillFormat;
  version: 1;
  id: string;
  backupId: string;
  backupSha256: string;
  startedAt: string;
  completedAt: string;
  elapsedSeconds: number;
  projectCount: number;
  userCount: number;
  passed: true;
  platform: NodeJS.Platform;
  architecture: string;
};

export type BackupAutomationStatus = {
  enabled: boolean;
  configurationError: string | null;
  destinationLabel: string | null;
  destinationReady: boolean | null;
  separateDevice: boolean | null;
  intervalHours: number;
  localCopies: number;
  retention: BackupRetentionPolicy;
  restoreDrillIntervalDays: number;
  running: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  externalBackupCount: number;
  damagedExternalBackupCount: number;
  latestExternalBackup: ExternalBackupRecord | null;
  lastRestoreDrillAt: string | null;
  lastRestoreDrillPassed: boolean | null;
  lastRestoreDrillError: string | null;
};

export class BackupAutomationError extends Error {
  constructor(
    readonly statusCode: 400 | 409 | 503,
    message: string,
  ) {
    super(message);
    this.name = "BackupAutomationError";
  }
}

function defaultState(sourceInstanceId: string = randomUUID()): BackupAutomationState {
  return {
    format: stateFormat,
    version: 1,
    sourceInstanceId,
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextRunAt: null,
    lastError: null,
    lastRestoreDrillAt: null,
    lastRestoreDrillPassed: null,
    lastRestoreDrillError: null,
  };
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "未知错误";
  return message.replace(/[\r\n]+/g, " ").slice(0, 800);
}

function configuredNumber(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  integer = false,
) {
  const raw = environment[name]?.trim();
  if (!raw) return { value: fallback, error: null };
  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    return {
      value: fallback,
      error: `${name} 必须是 ${minimum}–${maximum} 之间${integer ? "的整数" : "的数字"}`,
    };
  }
  return { value, error: null };
}

export function backupAutomationConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): BackupAutomationConfig {
  const interval = configuredNumber(environment, "TAKEBOARD_BACKUP_INTERVAL_HOURS", 24, 1, 720);
  const localCopies = configuredNumber(environment, "TAKEBOARD_BACKUP_KEEP_LOCAL", 2, 1, 5, true);
  const daily = configuredNumber(environment, "TAKEBOARD_BACKUP_KEEP_DAILY", 7, 1, 90, true);
  const weekly = configuredNumber(environment, "TAKEBOARD_BACKUP_KEEP_WEEKLY", 4, 0, 52, true);
  const monthly = configuredNumber(environment, "TAKEBOARD_BACKUP_KEEP_MONTHLY", 6, 0, 60, true);
  const drill = configuredNumber(
    environment,
    "TAKEBOARD_BACKUP_DRILL_INTERVAL_DAYS",
    30,
    1,
    365,
    true,
  );
  const destination = environment.TAKEBOARD_BACKUP_DESTINATION?.trim() || null;
  const errors = [
    interval.error,
    localCopies.error,
    daily.error,
    weekly.error,
    monthly.error,
    drill.error,
  ].filter((value): value is string => Boolean(value));
  if (destination && !isAbsolute(destination)) {
    errors.push("TAKEBOARD_BACKUP_DESTINATION 必须是绝对路径");
  }
  return {
    destination,
    intervalHours: interval.value,
    localCopies: localCopies.value,
    retention: { daily: daily.value, weekly: weekly.value, monthly: monthly.value },
    restoreDrillIntervalDays: drill.value,
    configurationError: errors.length ? errors.join("；") : null,
  };
}

function validateAutomationConfig(config: BackupAutomationConfig) {
  const errors: string[] = [];
  const numberInRange = (
    value: number,
    name: string,
    minimum: number,
    maximum: number,
    integer = false,
  ) => {
    if (
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum ||
      (integer && !Number.isInteger(value))
    ) {
      errors.push(`${name} 配置无效`);
    }
  };
  numberInRange(config.intervalHours, "备份间隔", 1, 720);
  numberInRange(config.localCopies, "本机副本数", 1, 5, true);
  numberInRange(config.retention.daily, "每日保留数", 1, 90, true);
  numberInRange(config.retention.weekly, "每周保留数", 0, 52, true);
  numberInRange(config.retention.monthly, "每月保留数", 0, 60, true);
  numberInRange(config.restoreDrillIntervalDays, "恢复演练间隔", 1, 365, true);
  if (config.startupDelayMs !== undefined) {
    numberInRange(config.startupDelayMs, "启动延迟", 0, maximumTimerDelay, true);
  }
  if (config.destination && !isAbsolute(config.destination)) {
    errors.push("异地备份目录必须是绝对路径");
  }
  if (config.configurationError) errors.unshift(config.configurationError);
  return errors.length ? [...new Set(errors)].join("；") : null;
}

async function sha256File(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function syncFile(path: string) {
  // Windows FlushFileBuffers requires a write-capable handle. Opening the
  // freshly written file read-only works on POSIX, but fails with EACCES on
  // Windows and used to abort every external backup before publication.
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string) {
  const handle = await open(path, "r").catch(() => null);
  if (!handle) return;
  try {
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close();
  }
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validSourceInstanceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
}

function validExternalRecord(value: unknown): value is ExternalBackupRecord {
  const record = value as Partial<ExternalBackupRecord> | null;
  return Boolean(
    record &&
      record.format === externalRecordFormat &&
      record.version === 1 &&
      validSourceInstanceId(record.sourceInstanceId) &&
      typeof record.id === "string" &&
      /^[A-Za-z0-9-]{10,100}$/.test(record.id) &&
      typeof record.filename === "string" &&
      basename(record.filename) === record.filename &&
      record.filename.endsWith(".takeboard-instance.tgz") &&
      validTimestamp(record.createdAt) &&
      validTimestamp(record.copiedAt) &&
      Number.isSafeInteger(record.size) &&
      (record.size ?? -1) >= 0 &&
      typeof record.archiveSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(record.archiveSha256) &&
      Number.isSafeInteger(record.projectCount) &&
      (record.projectCount ?? -1) >= 0 &&
      Number.isSafeInteger(record.userCount) &&
      (record.userCount ?? -1) >= 0 &&
      (record.separateDevice === null || typeof record.separateDevice === "boolean"),
  );
}

async function inspectExternalBackups(destination: string, sourceInstanceId: string) {
  const entries = await readdir(destination, { withFileTypes: true }).catch(() => []);
  const recognized: ExternalBackupRecord[] = [];
  const available: ExternalBackupRecord[] = [];
  let damaged = 0;
  for (const entry of entries) {
    if (!entry.name.endsWith(externalMetadataSuffix)) continue;
    if (!entry.isFile()) {
      damaged += 1;
      continue;
    }
    try {
      const record = JSON.parse(await readFile(join(destination, entry.name), "utf8")) as unknown;
      const candidate = record as Partial<ExternalBackupRecord> | null;
      // A shared NAS directory may contain backups from several TakeBoard data roots.
      // Valid foreign records are invisible to this instance and must never be pruned.
      if (
        validSourceInstanceId(candidate?.sourceInstanceId) &&
        candidate.sourceInstanceId !== sourceInstanceId
      ) {
        continue;
      }
      if (
        !validExternalRecord(record) ||
        entry.name !== `${record.filename}${externalMetadataSuffix}`
      ) {
        damaged += 1;
        continue;
      }
      recognized.push(record);
      const archive = join(destination, record.filename);
      const information = await lstat(archive);
      if (information.isFile() && information.size === record.size) available.push(record);
      else damaged += 1;
    } catch {
      // A partial or manually changed record is counted but never pruned automatically.
      damaged += 1;
    }
  }
  const newestFirst = (left: ExternalBackupRecord, right: ExternalBackupRecord) =>
    right.createdAt.localeCompare(left.createdAt);
  recognized.sort(newestFirst);
  available.sort(newestFirst);
  return { recognized, available, damaged };
}

function dailyBucket(timestamp: string) {
  return timestamp.slice(0, 10);
}

function monthlyBucket(timestamp: string) {
  return timestamp.slice(0, 7);
}

function weeklyBucket(timestamp: string) {
  const value = new Date(timestamp);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const year = value.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((value.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function selectRetainedBackupIds(
  records: ExternalBackupRecord[],
  policy: BackupRetentionPolicy,
) {
  const ordered = [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const retained = new Set<string>();
  const newest = ordered[0];
  if (newest) retained.add(newest.id);
  const keepBuckets = (limit: number, bucket: (timestamp: string) => string) => {
    if (limit <= 0) return;
    const seen = new Set<string>();
    for (const record of ordered) {
      const key = bucket(record.createdAt);
      if (seen.has(key)) continue;
      seen.add(key);
      retained.add(record.id);
      if (seen.size >= limit) break;
    }
  };
  keepBuckets(policy.daily, dailyBucket);
  keepBuckets(policy.weekly, weeklyBucket);
  keepBuckets(policy.monthly, monthlyBucket);
  return retained;
}

async function pruneExternalBackups(
  destination: string,
  sourceInstanceId: string,
  policy: BackupRetentionPolicy,
) {
  const records = (await inspectExternalBackups(destination, sourceInstanceId)).available;
  const retained = selectRetainedBackupIds(records, policy);
  for (const record of records) {
    if (retained.has(record.id)) continue;
    await rm(join(destination, record.filename), { force: true });
    await rm(join(destination, `${record.filename}${externalMetadataSuffix}`), { force: true });
  }
}

function pathIsInside(parent: string, candidate: string) {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

async function prepareDestination(projectsRoot: string, destination: string) {
  const root = resolve(projectsRoot);
  const target = resolve(destination);
  if (pathIsInside(root, target)) {
    throw new BackupAutomationError(400, "异地备份目录不能位于 TakeBoard 数据目录内部");
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(target, { recursive: true, mode: 0o700 });
  const [realRoot, realDestination] = await Promise.all([realpath(root), realpath(target)]);
  if (pathIsInside(realRoot, realDestination)) {
    throw new BackupAutomationError(400, "异地备份目录经过符号链接后仍位于数据目录内部");
  }
  await access(realDestination, constants.W_OK).catch(() => {
    throw new BackupAutomationError(503, "异地备份目录不可写，请检查磁盘是否挂载及目录权限");
  });
  const [rootInformation, destinationInformation] = await Promise.all([
    stat(realRoot),
    stat(realDestination),
  ]);
  return {
    destination: realDestination,
    separateDevice:
      typeof rootInformation.dev === "number" && typeof destinationInformation.dev === "number"
        ? rootInformation.dev !== destinationInformation.dev
        : null,
  };
}

async function copyExternalBackup(
  projectsRoot: string,
  destination: string,
  sourceInstanceId: string,
  backup: Awaited<ReturnType<typeof createInstanceBackup>>,
) {
  const prepared = await prepareDestination(projectsRoot, destination);
  const source = instanceBackupPath(projectsRoot, backup.id);
  if (!source) throw new BackupAutomationError(503, "新建备份的本机路径无效");
  const finalPath = join(prepared.destination, backup.filename);
  const partialPath = `${finalPath}.${randomUUID()}.partial`;
  const metadataPath = `${finalPath}${externalMetadataSuffix}`;
  const metadataPartialPath = `${metadataPath}.${randomUUID()}.partial`;
  let archivePublished = false;
  let metadataPublished = false;
  try {
    const existing = await Promise.all([
      access(finalPath).then(
        () => true,
        () => false,
      ),
      access(metadataPath).then(
        () => true,
        () => false,
      ),
    ]);
    if (existing.some(Boolean)) {
      throw new BackupAutomationError(409, "同一备份标识的外部副本已经存在");
    }
    await pipeline(
      createReadStream(source),
      createWriteStream(partialPath, { flags: "wx", mode: 0o600 }),
    );
    await syncFile(partialPath);
    const [sourceHash, copiedHash, information] = await Promise.all([
      sha256File(source),
      sha256File(partialPath),
      stat(partialPath),
    ]);
    if (sourceHash !== copiedHash || information.size !== backup.size) {
      throw new BackupAutomationError(503, "异地副本校验失败，未保留不完整文件");
    }
    await rename(partialPath, finalPath);
    archivePublished = true;
    const record: ExternalBackupRecord = {
      format: externalRecordFormat,
      version: 1,
      sourceInstanceId,
      id: backup.id,
      filename: backup.filename,
      createdAt: backup.createdAt,
      copiedAt: new Date().toISOString(),
      size: backup.size,
      archiveSha256: copiedHash,
      projectCount: backup.projectCount,
      userCount: backup.userCount,
      separateDevice: prepared.separateDevice,
    };
    await writeFile(metadataPartialPath, `${JSON.stringify(record, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await syncFile(metadataPartialPath);
    await rename(metadataPartialPath, metadataPath);
    metadataPublished = true;
    await syncDirectory(prepared.destination);
    return record;
  } catch (error) {
    if (archivePublished) await rm(finalPath, { force: true });
    if (metadataPublished) await rm(metadataPath, { force: true });
    throw error;
  } finally {
    await rm(partialPath, { force: true });
    await rm(metadataPartialPath, { force: true });
  }
}

async function restoredProjectCount(root: string) {
  const entries = await readdir(root, { withFileTypes: true });
  let projects = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(".takeboard")) continue;
    const store = ProjectStore.openExisting(join(root, entry.name));
    if (!store) throw new Error("恢复演练无法打开项目数据库");
    try {
      if (!store.loadCurrent()) throw new Error("恢复演练项目没有可读取快照");
      projects += 1;
    } finally {
      store.close();
    }
  }
  return projects;
}

async function executeRestoreDrill(destination: string, record: ExternalBackupRecord) {
  const archive = join(destination, record.filename);
  const actualHash = await sha256File(archive).catch(() => {
    throw new BackupAutomationError(503, "异地备份文件缺失或不可读，恢复演练被阻止");
  });
  if (actualHash !== record.archiveSha256) {
    throw new BackupAutomationError(503, "异地备份哈希已变化，恢复演练被阻止");
  }
  const id = randomUUID();
  const startedAt = new Date();
  const drillRoot = join(destination, ".restore-drill-work", id);
  const restoredRoot = join(drillRoot, "data");
  const authPath = join(restoredRoot, ".system", "auth.db");
  try {
    await mkdir(drillRoot, { recursive: true, mode: 0o700 });
    await restoreInstanceOffline(restoredRoot, archive, authPath);
    const identity = new BetterSqlite3(authPath, { readonly: true, fileMustExist: true });
    let users = 0;
    try {
      if (identity.pragma("quick_check", { simple: true }) !== "ok") {
        throw new Error("恢复演练身份数据库完整性检查失败");
      }
      users = identity.prepare("SELECT COUNT(*) FROM auth_users").pluck().get() as number;
    } finally {
      identity.close();
    }
    const projects = await restoredProjectCount(restoredRoot);
    if (projects !== record.projectCount || users !== record.userCount) {
      throw new Error(
        `恢复演练数量不一致：项目 ${projects}/${record.projectCount}，账号 ${users}/${record.userCount}`,
      );
    }
    const completedAt = new Date();
    const report: RestoreDrillReport = {
      format: restoreDrillFormat,
      version: 1,
      id,
      backupId: record.id,
      backupSha256: record.archiveSha256,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      elapsedSeconds: Math.max(0, Math.round((completedAt.getTime() - startedAt.getTime()) / 1000)),
      projectCount: projects,
      userCount: users,
      passed: true,
      platform: process.platform,
      architecture: process.arch,
    };
    const reportsRoot = join(destination, "restore-drills");
    await mkdir(reportsRoot, { recursive: true, mode: 0o700 });
    const reportPath = join(
      reportsRoot,
      `${completedAt.toISOString().replace(/[:.]/g, "-")}-${id.slice(0, 8)}.json`,
    );
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await syncFile(reportPath);
    await syncDirectory(reportsRoot);
    return report;
  } finally {
    await rm(drillRoot, { recursive: true, force: true });
  }
}

function parseState(value: unknown, fallbackSourceInstanceId: string) {
  const state = value as Partial<BackupAutomationState> | null;
  if (state?.format !== stateFormat || state.version !== 1) {
    return defaultState(fallbackSourceInstanceId);
  }
  return {
    ...defaultState(
      validSourceInstanceId(state.sourceInstanceId)
        ? state.sourceInstanceId
        : fallbackSourceInstanceId,
    ),
    lastAttemptAt: validTimestamp(state.lastAttemptAt) ? state.lastAttemptAt : null,
    lastSuccessAt: validTimestamp(state.lastSuccessAt) ? state.lastSuccessAt : null,
    nextRunAt: validTimestamp(state.nextRunAt) ? state.nextRunAt : null,
    lastError: typeof state.lastError === "string" ? state.lastError.slice(0, 800) : null,
    lastRestoreDrillAt: validTimestamp(state.lastRestoreDrillAt) ? state.lastRestoreDrillAt : null,
    lastRestoreDrillPassed:
      typeof state.lastRestoreDrillPassed === "boolean" ? state.lastRestoreDrillPassed : null,
    lastRestoreDrillError:
      typeof state.lastRestoreDrillError === "string"
        ? state.lastRestoreDrillError.slice(0, 800)
        : null,
  } satisfies BackupAutomationState;
}

export class BackupAutomation {
  private readonly root: string;
  private readonly config: BackupAutomationConfig;
  private state = defaultState();
  private readonly initialized: Promise<void>;
  private timer: NodeJS.Timeout | null = null;
  private currentOperation: Promise<unknown> | null = null;
  private stopped = false;

  constructor(
    projectsRoot: string,
    private readonly auth: AuthService,
    config: BackupAutomationConfig,
    private readonly logAuditError: (error: unknown, action: string) => void = () => undefined,
  ) {
    this.root = resolve(projectsRoot);
    const destination = config.destination ? resolve(config.destination) : null;
    const insideRoot = destination ? pathIsInside(this.root, destination) : false;
    const validationError = validateAutomationConfig(config);
    this.config = {
      ...config,
      destination,
      configurationError:
        [validationError, insideRoot ? "异地备份目录不能位于 TakeBoard 数据目录内部" : null]
          .filter((value): value is string => Boolean(value))
          .join("；") || null,
    };
    this.initialized = this.loadState();
  }

  private get enabled() {
    return Boolean(this.config.destination && !this.config.configurationError);
  }

  private get statePath() {
    return join(this.root, ".system", stateFilename);
  }

  private async loadState() {
    const fallbackSourceInstanceId = this.state.sourceInstanceId;
    try {
      this.state = parseState(
        JSON.parse(await readFile(this.statePath, "utf8")) as unknown,
        fallbackSourceInstanceId,
      );
    } catch {
      this.state = defaultState(fallbackSourceInstanceId);
    }
  }

  private async saveState() {
    const directory = join(this.root, ".system");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.statePath}.${randomUUID()}.partial`;
    try {
      await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      await syncFile(temporary);
      await rename(temporary, this.statePath);
      await syncDirectory(directory);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private ensureConfigured() {
    if (this.config.configurationError) {
      throw new BackupAutomationError(400, this.config.configurationError);
    }
    if (!this.config.destination) {
      throw new BackupAutomationError(
        400,
        "尚未配置异地备份目录，请设置 TAKEBOARD_BACKUP_DESTINATION 后重启",
      );
    }
    return this.config.destination;
  }

  private schedule() {
    if (this.stopped || !this.enabled || this.timer) return;
    const fallback = Date.now() + (this.config.startupDelayMs ?? 60_000);
    const desired = this.state.nextRunAt ? Date.parse(this.state.nextRunAt) : fallback;
    const delay = Math.max(1_000, Math.min(maximumTimerDelay, desired - Date.now()));
    this.timer = setTimeout(() => {
      this.timer = null;
      const nextRun = this.state.nextRunAt ? Date.parse(this.state.nextRunAt) : Number.NaN;
      if (Number.isFinite(nextRun) && nextRun - Date.now() > 1_000) {
        this.schedule();
        return;
      }
      void this.runScheduled();
    }, delay);
    this.timer.unref();
  }

  private async runScheduled() {
    if (this.stopped) return;
    try {
      if (!this.auth.configured()) {
        this.state.nextRunAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        await this.saveState();
        return;
      }
      const result = await this.runBackup();
      this.audit(
        null,
        "backup.external_scheduled",
        "instance_backup",
        result.backup.id,
        {
          projects: result.backup.projectCount,
          users: result.backup.userCount,
          size: result.backup.size,
          restoreDrillPassed: Boolean(result.drill),
          restoreDrillFailed: Boolean(result.drillError),
        },
        null,
      );
    } catch {
      this.audit(null, "backup.external_scheduled_failed", "instance_backup", null, {}, null);
    } finally {
      this.schedule();
    }
  }

  private audit(...arguments_: Parameters<AuthService["audit"]>) {
    try {
      this.auth.audit(...arguments_);
    } catch (error) {
      this.logAuditError(error, arguments_[1]);
    }
  }

  async start() {
    await this.initialized;
    this.schedule();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.currentOperation?.catch(() => undefined);
  }

  private operation<T>(task: () => Promise<T>) {
    if (this.currentOperation) {
      throw new BackupAutomationError(409, "备份或恢复演练已经在运行，请完成后再试");
    }
    const running = task();
    this.currentOperation = running;
    const clear = () => {
      if (this.currentOperation === running) this.currentOperation = null;
    };
    void running.then(clear, clear);
    return running;
  }

  async status(): Promise<BackupAutomationStatus> {
    await this.initialized;
    const destination = this.config.destination;
    const inspection = destination
      ? await inspectExternalBackups(destination, this.state.sourceInstanceId)
      : { recognized: [], available: [], damaged: 0 };
    let destinationReady: boolean | null = null;
    let separateDevice: boolean | null = inspection.recognized[0]?.separateDevice ?? null;
    if (destination) {
      try {
        await access(destination, constants.W_OK);
        const [realRoot, realDestination] = await Promise.all([
          realpath(this.root),
          realpath(destination),
        ]);
        if (pathIsInside(realRoot, realDestination)) {
          throw new Error("backup destination resolves inside data root");
        }
        destinationReady = true;
        const [rootInformation, destinationInformation] = await Promise.all([
          stat(realRoot),
          stat(realDestination),
        ]);
        separateDevice = rootInformation.dev !== destinationInformation.dev;
      } catch {
        destinationReady = false;
      }
    }
    return {
      enabled: this.enabled,
      configurationError: this.config.configurationError ?? null,
      destinationLabel: destination ? basename(destination) || "外部根目录" : null,
      destinationReady,
      separateDevice,
      intervalHours: this.config.intervalHours,
      localCopies: this.config.localCopies,
      retention: this.config.retention,
      restoreDrillIntervalDays: this.config.restoreDrillIntervalDays,
      running: Boolean(this.currentOperation),
      lastAttemptAt: this.state.lastAttemptAt,
      lastSuccessAt: this.state.lastSuccessAt,
      nextRunAt: this.state.nextRunAt,
      lastError: this.state.lastError,
      externalBackupCount: inspection.recognized.length,
      damagedExternalBackupCount: inspection.damaged,
      latestExternalBackup: inspection.recognized[0] ?? null,
      lastRestoreDrillAt: this.state.lastRestoreDrillAt,
      lastRestoreDrillPassed: this.state.lastRestoreDrillPassed,
      lastRestoreDrillError: this.state.lastRestoreDrillError,
    };
  }

  async runBackup() {
    await this.initialized;
    return await this.operation(async () => {
      const destination = this.ensureConfigured();
      const attemptedAt = new Date();
      this.state.lastAttemptAt = attemptedAt.toISOString();
      this.state.lastError = null;
      await this.saveState();
      try {
        const backup = await createInstanceBackup(this.root, this.auth, this.config.localCopies);
        const record = await copyExternalBackup(
          this.root,
          destination,
          this.state.sourceInstanceId,
          backup,
        );
        await pruneExternalBackups(destination, this.state.sourceInstanceId, this.config.retention);
        const drillDue =
          this.state.lastRestoreDrillPassed !== true ||
          !this.state.lastRestoreDrillAt ||
          Date.now() - Date.parse(this.state.lastRestoreDrillAt) >=
            this.config.restoreDrillIntervalDays * 24 * 60 * 60 * 1000;
        let drill: RestoreDrillReport | null = null;
        let drillError: string | null = null;
        if (drillDue) {
          try {
            drill = await executeRestoreDrill(destination, record);
            this.state.lastRestoreDrillAt = drill.completedAt;
            this.state.lastRestoreDrillPassed = true;
            this.state.lastRestoreDrillError = null;
          } catch (error) {
            drillError = safeError(error);
            this.state.lastRestoreDrillAt = new Date().toISOString();
            this.state.lastRestoreDrillPassed = false;
            this.state.lastRestoreDrillError = drillError;
          }
        }
        const completedAt = new Date();
        this.state.lastSuccessAt = completedAt.toISOString();
        this.state.nextRunAt = new Date(
          completedAt.getTime() + this.config.intervalHours * 60 * 60 * 1000,
        ).toISOString();
        this.state.lastError = null;
        await this.saveState();
        return { backup: record, drill, drillError };
      } catch (error) {
        this.state.lastError = safeError(error);
        this.state.nextRunAt = new Date(
          Date.now() + Math.min(60, Math.max(5, this.config.intervalHours * 15)) * 60 * 1000,
        ).toISOString();
        await this.saveState();
        throw error;
      } finally {
        this.schedule();
      }
    });
  }

  async runRestoreDrill() {
    await this.initialized;
    return await this.operation(async () => {
      const destination = this.ensureConfigured();
      const record = (await inspectExternalBackups(destination, this.state.sourceInstanceId))
        .recognized[0];
      if (!record) throw new BackupAutomationError(400, "还没有可用于恢复演练的异地备份");
      try {
        const report = await executeRestoreDrill(destination, record);
        this.state.lastRestoreDrillAt = report.completedAt;
        this.state.lastRestoreDrillPassed = true;
        this.state.lastRestoreDrillError = null;
        await this.saveState();
        return report;
      } catch (error) {
        this.state.lastRestoreDrillAt = new Date().toISOString();
        this.state.lastRestoreDrillPassed = false;
        this.state.lastRestoreDrillError = safeError(error);
        await this.saveState();
        throw error;
      }
    });
  }
}

function sendAutomationError(reply: FastifyReply, error: unknown) {
  if (error instanceof BackupAutomationError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  return reply.code(500).send({ error: "备份运维操作失败，请检查运行诊断和服务日志" });
}

export function registerBackupAutomation(
  app: FastifyInstance,
  projectsRoot: string,
  auth: AuthService,
  config: BackupAutomationConfig = backupAutomationConfigFromEnvironment(),
) {
  const logAuditError = (error: unknown, action: string) => {
    app.log.error({ err: error, action }, "backup automation audit write failed");
  };
  const audit = (...arguments_: Parameters<AuthService["audit"]>) => {
    try {
      auth.audit(...arguments_);
    } catch (error) {
      logAuditError(error, arguments_[1]);
    }
  };
  const automation = new BackupAutomation(projectsRoot, auth, config, logAuditError);
  app.addHook("onReady", async () => automation.start());
  app.addHook("preClose", async () => automation.stop());

  app.get("/api/admin/backups/automation", async () => ({ status: await automation.status() }));
  app.post("/api/admin/backups/automation/run", async (request, reply) => {
    try {
      const result = await automation.runBackup();
      const actor = authContext(request)?.user.id ?? null;
      audit(
        actor,
        "backup.external_created",
        "instance_backup",
        result.backup.id,
        {
          projects: result.backup.projectCount,
          users: result.backup.userCount,
          size: result.backup.size,
          separateDevice: result.backup.separateDevice,
          restoreDrillPassed: Boolean(result.drill),
        },
        request.ip ?? null,
      );
      return await reply.code(201).send(result);
    } catch (error) {
      request.log.error({ error }, "external instance backup failed");
      audit(
        authContext(request)?.user.id ?? null,
        "backup.external_failed",
        "instance_backup",
        null,
        {},
        request.ip ?? null,
      );
      return await sendAutomationError(reply, error);
    }
  });
  app.post("/api/admin/backups/automation/drill", async (request, reply) => {
    try {
      const report = await automation.runRestoreDrill();
      audit(
        authContext(request)?.user.id ?? null,
        "backup.restore_drill_passed",
        "instance_backup",
        report.backupId,
        {
          projects: report.projectCount,
          users: report.userCount,
          elapsedSeconds: report.elapsedSeconds,
        },
        request.ip ?? null,
      );
      return { report };
    } catch (error) {
      request.log.error({ error }, "instance restore drill failed");
      audit(
        authContext(request)?.user.id ?? null,
        "backup.restore_drill_failed",
        "instance_backup",
        null,
        {},
        request.ip ?? null,
      );
      return await sendAutomationError(reply, error);
    }
  });
  return automation;
}
