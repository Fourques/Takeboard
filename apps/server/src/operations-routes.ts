import { constants } from "node:fs";
import { access, mkdir, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type {
  OperationsDiagnosticCheck,
  OperationTask,
  StorageCategory,
} from "@takeboard/contracts";
import type { FastifyInstance } from "fastify";
import { authContext } from "./auth-routes.js";
import type { AuthService } from "./auth-service.js";
import { listInstanceBackups } from "./instance-backup.js";
import { projectKey } from "./project-routes.js";
import { ProjectStore } from "./storage/project-store.js";
import { diskCapacity, projectStorageReserveBytes } from "./storage-capacity.js";

const activeStatuses = new Set([
  "draft",
  "validating",
  "uploading_inputs",
  "queued",
  "running",
  "collecting_outputs",
  "reconciling",
]);

function emptyCategories(): StorageCategory {
  return {
    originals: 0,
    proxies: 0,
    renders: 0,
    runData: 0,
    recipes: 0,
    exports: 0,
    backups: 0,
    other: 0,
  };
}

function storageCategory(root: string, path: string): keyof StorageCategory {
  const portable = relative(root, path).split(sep).join("/");
  if (portable.startsWith("assets/originals/")) return "originals";
  if (portable.startsWith("assets/proxies/")) return "proxies";
  if (portable.startsWith("renders/")) return "renders";
  if (portable.startsWith("runs/")) return "runData";
  if (portable.startsWith("recipes/")) return "recipes";
  if (portable.startsWith("exports/")) return "exports";
  if (portable.startsWith("backups/")) return "backups";
  return "other";
}

async function directoryUsage(directory: string, categorize = false) {
  const root = resolve(directory);
  const categories = emptyCategories();
  let totalBytes = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        pending.push(path);
      }
    }
    const files = entries
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
      .map((entry) => join(current, entry.name));
    for (let offset = 0; offset < files.length; offset += 64) {
      const batch = files.slice(offset, offset + 64);
      const sizes = await Promise.all(
        batch.map(async (path) => ({ path, information: await stat(path).catch(() => null) })),
      );
      for (const { path, information } of sizes) {
        if (!information) continue;
        totalBytes += information.size;
        categories[categorize ? storageCategory(root, path) : "other"] += information.size;
      }
    }
  }
  return { totalBytes, categories };
}

function effectiveProjectRole(
  auth: AuthService,
  projectId: string,
  context: ReturnType<typeof authContext>,
) {
  if (!context || context.user.instanceRole === "admin") return "owner" as const;
  return auth.projectRole(projectId, context.user.id);
}

function loadProjectForOperations(directory: string) {
  let store: ProjectStore | null = null;
  try {
    store = ProjectStore.openExisting(directory);
    if (!store) return { current: null, unreadable: true } as const;
    const current = store.loadCurrent();
    return { current, unreadable: current === null } as const;
  } catch {
    return { current: null, unreadable: true } as const;
  } finally {
    try {
      store?.close();
    } catch {
      // A broken project remains isolated; diagnostics reports it without exposing its path.
    }
  }
}

export function registerOperationsRoutes(
  app: FastifyInstance,
  projectsRoot: string,
  auth: AuthService,
  options: { version: string; comfyUrl: string; webRoot: string | null },
) {
  const root = resolve(projectsRoot);

  app.get("/api/operations/tasks", async (request) => {
    const context = authContext(request);
    const accessible = context
      ? auth.accessibleProjectIds(context.user.id, context.user.instanceRole)
      : null;
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const tasks: OperationTask[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !projectKey(entry.name)) continue;
      const { current } = loadProjectForOperations(join(root, entry.name));
      if (!current || (accessible && !accessible.has(current.snapshot.project.id))) continue;
      const role = effectiveProjectRole(auth, current.snapshot.project.id, context);
      if (!role) continue;
      for (const run of current.snapshot.runs) {
        const shot = current.snapshot.shots.find((candidate) => candidate.id === run.shotId);
        tasks.push({
          projectKey: entry.name,
          projectId: current.snapshot.project.id,
          projectTitle: current.snapshot.project.title,
          projectRole: role,
          canCancel: role !== "viewer",
          shotId: run.shotId,
          shotLabel: shot?.label || "镜头",
          runId: run.id,
          status: run.status,
          recipePath:
            typeof run.parameters.recipePath === "string" ? run.parameters.recipePath : null,
          outputMediaType:
            run.parameters.outputMediaType === "image" || run.parameters.outputMediaType === "video"
              ? run.parameters.outputMediaType
              : null,
          progress: null,
          errorMessage: run.errorMessage,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        });
      }
    }
    const ordered = tasks.sort((left, right) => {
      const activeDifference =
        Number(activeStatuses.has(right.status)) - Number(activeStatuses.has(left.status));
      return activeDifference || right.updatedAt.localeCompare(left.updatedAt);
    });
    const visible = [
      ...ordered.filter((task) => activeStatuses.has(task.status)),
      ...ordered.filter((task) => !activeStatuses.has(task.status)).slice(0, 20),
    ];
    return {
      tasks: visible,
      activeCount: visible.filter((task) => activeStatuses.has(task.status)).length,
      failedCount: visible.filter((task) => task.status === "failed" || task.status === "orphaned")
        .length,
      updatedAt: new Date().toISOString(),
    };
  });

  app.get("/api/operations/storage", async (request) => {
    const context = authContext(request);
    const accessible = context
      ? auth.accessibleProjectIds(context.user.id, context.user.instanceRole)
      : null;
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !projectKey(entry.name)) continue;
      const directory = join(root, entry.name);
      const { current } = loadProjectForOperations(directory);
      if (!current || (accessible && !accessible.has(current.snapshot.project.id))) continue;
      const usage = await directoryUsage(directory, true);
      projects.push({
        projectKey: entry.name,
        projectId: current.snapshot.project.id,
        projectTitle: current.snapshot.project.title,
        totalBytes: usage.totalBytes,
        categories: usage.categories,
      });
    }

    let trashBytes = 0;
    const trashRoot = join(root, ".trash");
    const trashEntries = await readdir(trashRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of trashEntries) {
      if (!entry.isDirectory()) continue;
      const directory = join(trashRoot, entry.name);
      const { current } = loadProjectForOperations(directory);
      if (!current) continue;
      const role = effectiveProjectRole(auth, current.snapshot.project.id, context);
      if (!role || (context && context.user.instanceRole !== "admin" && role !== "owner")) continue;
      trashBytes += (await directoryUsage(directory)).totalBytes;
    }

    const activeProjectBytes = projects.reduce((sum, project) => sum + project.totalBytes, 0);
    const systemBytes =
      context?.user.instanceRole === "admin"
        ? (await directoryUsage(join(root, ".system"))).totalBytes
        : null;
    const reserveBytes = projectStorageReserveBytes();
    const filesystemCapacity = await diskCapacity(root);
    return {
      projects: projects.sort((left, right) => right.totalBytes - left.totalBytes),
      activeProjectBytes,
      trashBytes,
      systemBytes,
      visibleBytes: activeProjectBytes + trashBytes + (systemBytes ?? 0),
      filesystem: filesystemCapacity
        ? {
            ...filesystemCapacity,
            reserveBytes,
            generationReady: filesystemCapacity.availableBytes >= reserveBytes,
          }
        : null,
      scannedAt: new Date().toISOString(),
    };
  });

  app.get("/api/operations/diagnostics", async (request) => {
    const context = authContext(request);
    const accessible = context
      ? auth.accessibleProjectIds(context.user.id, context.user.instanceRole)
      : null;
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    let visibleProjects = 0;
    let activeRuns = 0;
    let failedRuns = 0;
    let unreadableProjects = 0;
    const canInspectInstance = !context || context.user.instanceRole === "admin";
    for (const entry of entries) {
      if (!entry.isDirectory() || !projectKey(entry.name)) continue;
      const loaded = loadProjectForOperations(join(root, entry.name));
      if (loaded.unreadable) {
        if (canInspectInstance) unreadableProjects += 1;
        continue;
      }
      const current = loaded.current;
      if (!current || (accessible && !accessible.has(current.snapshot.project.id))) continue;
      visibleProjects += 1;
      for (const run of current.snapshot.runs) {
        if (activeStatuses.has(run.status)) activeRuns += 1;
        if (run.status === "failed" || run.status === "orphaned") failedRuns += 1;
      }
    }

    const checks: OperationsDiagnosticCheck[] = [];
    const addCheck = (check: OperationsDiagnosticCheck) => checks.push(check);
    await mkdir(root, { recursive: true });
    const dataWritable = await access(root, constants.W_OK)
      .then(() => true)
      .catch(() => false);
    addCheck({
      id: "data.writable",
      category: "data",
      status: dataWritable ? "pass" : "blocked",
      title: dataWritable ? "项目目录可写" : "项目目录不可写",
      detail: dataWritable
        ? "服务可以保存项目、素材索引和运行状态。"
        : "服务没有项目目录的写入权限；继续操作可能无法保存。",
      action: dataWritable ? null : "检查 TAKEBOARD_DATA_ROOT 所在目录的所有者和写入权限。",
    });
    if (canInspectInstance) {
      addCheck({
        id: "data.projects",
        category: "data",
        status: unreadableProjects === 0 ? "pass" : "warning",
        title:
          unreadableProjects === 0
            ? "项目数据库均可读取"
            : `${unreadableProjects} 个项目目录需要修复`,
        detail:
          unreadableProjects === 0
            ? "运行中心可以读取当前实例内的全部项目状态。"
            : "其他项目仍可使用；问题目录已从本次扫描隔离，名称与路径不会进入报告。",
        action:
          unreadableProjects === 0
            ? null
            : "先创建实例备份，再检查服务日志和项目目录权限；不要直接覆盖数据库。",
      });
    }

    const capacity = await diskCapacity(root);
    const reserveBytes = projectStorageReserveBytes();
    addCheck({
      id: "storage.reserve",
      category: "storage",
      status:
        capacity === null
          ? "warning"
          : capacity.availableBytes >= reserveBytes
            ? "pass"
            : "blocked",
      title:
        capacity === null
          ? "无法读取磁盘余量"
          : capacity.availableBytes >= reserveBytes
            ? "项目盘空间充足"
            : "项目盘低于安全余量",
      detail:
        capacity === null
          ? "当前平台没有返回文件系统容量；生成前仍会再次检查。"
          : `可用 ${Math.round(capacity.availableBytes / 1024 ** 3)} GB，安全余量 ${Math.round(reserveBytes / 1024 ** 3)} GB。`,
      action:
        capacity && capacity.availableBytes < reserveBytes
          ? "释放磁盘空间，或将 TAKEBOARD_DATA_ROOT 迁移到容量更充足的磁盘。"
          : null,
    });

    const webReady = options.webRoot
      ? await stat(join(options.webRoot, "index.html"))
          .then((information) => information.isFile())
          .catch(() => false)
      : true;
    addCheck({
      id: "runtime.web",
      category: "runtime",
      status: webReady ? "pass" : "blocked",
      title: options.webRoot ? (webReady ? "网页构建可用" : "网页构建缺失") : "开发网页服务",
      detail: options.webRoot
        ? webReady
          ? "服务已找到生产网页入口。"
          : "配置了网页目录，但没有找到 index.html。"
        : "当前由独立开发服务器提供网页。",
      action: webReady ? null : "运行 pnpm build 后重启 TakeBoard。",
    });

    const workerReady = await fetch(`${options.comfyUrl.replace(/\/$/, "")}/system_stats`, {
      signal: AbortSignal.timeout(1_500),
    })
      .then((response) => response.ok)
      .catch(() => false);
    addCheck({
      id: "worker.comfy",
      category: "worker",
      status: workerReady ? "pass" : "warning",
      title: workerReady ? "ComfyUI 已连接" : "ComfyUI 当前离线",
      detail: workerReady
        ? "执行端接口已响应，可以继续做工作流预检与生成。"
        : "项目管理和画布仍可使用，但暂时不能提交真实生成。",
      action: workerReady ? null : "在首页重新检测；需要时使用经过资源预检的安全启动。",
    });

    const configuredHost = process.env.TAKEBOARD_HOST ?? "127.0.0.1";
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(configuredHost.toLowerCase());
    const secureExposure = loopback || auth.mode === "required";
    addCheck({
      id: "security.exposure",
      category: "security",
      status: loopback ? "pass" : secureExposure ? "warning" : "blocked",
      title: loopback ? "仅本机监听" : secureExposure ? "已启用远程身份认证" : "远程暴露不安全",
      detail: loopback
        ? "默认回环监听不会直接暴露到局域网或公网。"
        : secureExposure
          ? "服务允许非回环访问；公网入口还必须由 HTTPS 反向代理保护。"
          : "非回环监听没有强制账号认证。",
      action: loopback
        ? null
        : secureExposure
          ? "确认入口使用 HTTPS、限定 Host / Origin，且不要公开 ComfyUI 端口。"
          : "恢复 127.0.0.1 监听，或把 TAKEBOARD_AUTH_MODE 设为 required。",
    });

    const canInspectBackups = !context || context.user.instanceRole === "admin";
    const backups = canInspectBackups ? await listInstanceBackups(root) : null;
    if (backups) {
      const latest = backups[0] ?? null;
      const backupAge = latest
        ? Date.now() - Date.parse(latest.createdAt)
        : Number.POSITIVE_INFINITY;
      const recent = backupAge <= 7 * 24 * 60 * 60 * 1_000;
      addCheck({
        id: "backup.recent",
        category: "backup",
        status: recent ? "pass" : "warning",
        title: recent ? "最近 7 天有实例备份" : latest ? "实例备份已经超过 7 天" : "还没有实例备份",
        detail: latest
          ? `本机保留 ${backups.length} 份可验证实例备份。`
          : "项目包可以单独导出，但账号和全部项目还没有统一恢复点。",
        action: recent ? null : "由实例管理员在账号设置中创建备份，并下载到另一块磁盘。",
      });
    }

    return {
      format: "takeboard.support-report" as const,
      reportVersion: 1 as const,
      generatedAt: new Date().toISOString(),
      application: {
        version: options.version,
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        uptimeSeconds: Math.max(0, Math.floor(process.uptime())),
        authMode: auth.mode,
      },
      workload: { visibleProjects, activeRuns, failedRuns },
      backup: backups
        ? { count: backups.length, latestCreatedAt: backups[0]?.createdAt ?? null }
        : null,
      checks,
      privacy:
        "不包含项目名称、账号、素材内容、提示词、绝对路径、Cookie、Token 或环境变量值。" as const,
    };
  });
}
