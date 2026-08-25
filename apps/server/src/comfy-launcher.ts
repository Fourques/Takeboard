import { execFile as execFileCallback, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export type ComfyLauncherCheck = {
  id: "launcher";
  label: string;
  status: "pass" | "blocked";
  detail: string;
};

export type ComfyLauncher = {
  kind: "systemd" | "launchd" | "windows-service" | "process" | "unavailable";
  preflight: () => Promise<ComfyLauncherCheck>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

type CommandResult = { stdout: string; stderr: string };

export type LauncherRuntime = {
  execute: (file: string, args: string[]) => Promise<CommandResult>;
  startProcess: (executable: string, args: string[], cwd: string) => number;
  stopProcess: (pid: number) => Promise<void>;
  processRunning: (pid: number) => boolean;
};

export type ComfyLauncherConfig = {
  platform?: NodeJS.Platform;
  provider?: "auto" | ComfyLauncher["kind"];
  systemdService?: string;
  launchdLabel?: string;
  windowsService?: string;
  executable?: string;
  args?: string[];
  cwd?: string;
  pidFile?: string;
  runtime?: Partial<LauncherRuntime>;
};

const defaultRuntime: LauncherRuntime = {
  execute: async (file, args) => {
    const result = await execFile(file, args, { timeout: 8_000, windowsHide: true });
    return { stdout: result.stdout, stderr: result.stderr };
  },
  startProcess: (executable, args, cwd) => {
    const child = spawn(executable, args, {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    if (!child.pid) throw new Error("ComfyUI process did not return a PID");
    child.unref();
    return child.pid;
  },
  stopProcess: async (pid) => {
    if (process.platform === "win32") {
      await execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        timeout: 8_000,
        windowsHide: true,
      });
      return;
    }
    try {
      process.kill(-pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      try {
        process.kill(pid, "SIGTERM");
      } catch (fallbackError) {
        if ((fallbackError as NodeJS.ErrnoException).code !== "ESRCH") throw fallbackError;
      }
    }
  },
  processRunning: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
};

function unavailable(detail: string): ComfyLauncher {
  return {
    kind: "unavailable",
    preflight: async () => ({
      id: "launcher",
      label: "启动方式",
      status: "blocked",
      detail,
    }),
    start: async () => {
      throw new Error(detail);
    },
    stop: async () => undefined,
  };
}

function systemdLauncher(service: string, runtime: LauncherRuntime): ComfyLauncher {
  if (!/^[A-Za-z0-9_.@-]+\.service$/.test(service)) {
    return unavailable("systemd 服务名不安全或无效");
  }
  let owned = false;
  return {
    kind: "systemd",
    preflight: async () => {
      try {
        const { stdout } = await runtime.execute("systemctl", [
          "--user",
          "show",
          service,
          "--property=LoadState,ActiveState,SubState",
          "--no-pager",
        ]);
        const properties = new Map(
          stdout
            .trim()
            .split("\n")
            .flatMap((line) => {
              const separator = line.indexOf("=");
              return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
            }),
        );
        if (properties.get("LoadState") !== "loaded") {
          throw new Error(`${service} 未安装`);
        }
        const active = properties.get("ActiveState");
        const subState = properties.get("SubState");
        if (active !== "inactive" || subState !== "dead") {
          throw new Error(
            `服务当前为 ${active ?? "unknown"}/${subState ?? "unknown"}，不是可安全启动的停止状态`,
          );
        }
        return {
          id: "launcher",
          label: "启动方式",
          status: "pass",
          detail: `Linux user service · ${service}`,
        };
      } catch (error) {
        return {
          id: "launcher",
          label: "启动方式",
          status: "blocked",
          detail: error instanceof Error ? error.message : "无法验证 systemd 服务",
        };
      }
    },
    start: async () => {
      await runtime.execute("systemctl", ["--user", "start", service]);
      owned = true;
    },
    stop: async () => {
      if (!owned) return;
      await runtime.execute("systemctl", ["--user", "stop", service]);
      owned = false;
    },
  };
}

function launchdLauncher(label: string, runtime: LauncherRuntime): ComfyLauncher {
  if (!/^[A-Za-z0-9_.-]+$/.test(label)) return unavailable("launchd Label 不安全或无效");
  const target = `gui/${process.getuid?.() ?? 0}/${label}`;
  let owned = false;
  return {
    kind: "launchd",
    preflight: async () => {
      try {
        const { stdout } = await runtime.execute("launchctl", ["print", target]);
        const state = /\bstate\s*=\s*([^\n]+)/i.exec(stdout)?.[1]?.trim().toLowerCase();
        if (state !== "not running") {
          throw new Error(`launchd 任务当前为 ${state ?? "unknown"}，不是可安全启动的停止状态`);
        }
        return {
          id: "launcher",
          label: "启动方式",
          status: "pass",
          detail: `macOS LaunchAgent · ${label}`,
        };
      } catch (error) {
        return {
          id: "launcher",
          label: "启动方式",
          status: "blocked",
          detail: error instanceof Error ? error.message : "无法验证 launchd 任务",
        };
      }
    },
    start: async () => {
      await runtime.execute("launchctl", ["kickstart", target]);
      owned = true;
    },
    stop: async () => {
      if (!owned) return;
      await runtime.execute("launchctl", ["kill", "SIGTERM", target]);
      owned = false;
    },
  };
}

function windowsServiceLauncher(service: string, runtime: LauncherRuntime): ComfyLauncher {
  if (!/^[A-Za-z0-9_.@ -]+$/.test(service)) return unavailable("Windows 服务名不安全或无效");
  let owned = false;
  return {
    kind: "windows-service",
    preflight: async () => {
      try {
        const { stdout } = await runtime.execute("sc.exe", ["query", service]);
        if (/STATE\s*:\s*\d+\s+RUNNING/i.test(stdout)) {
          throw new Error("Windows 服务已运行但接口未响应，本次不会重复启动");
        }
        if (!/STATE\s*:\s*\d+\s+STOPPED/i.test(stdout)) {
          throw new Error("Windows 服务当前不在可安全启动的停止状态");
        }
        return {
          id: "launcher",
          label: "启动方式",
          status: "pass",
          detail: `Windows Service · ${service}`,
        };
      } catch (error) {
        return {
          id: "launcher",
          label: "启动方式",
          status: "blocked",
          detail: error instanceof Error ? error.message : "无法验证 Windows 服务",
        };
      }
    },
    start: async () => {
      await runtime.execute("sc.exe", ["start", service]);
      owned = true;
    },
    stop: async () => {
      if (!owned) return;
      await runtime.execute("sc.exe", ["stop", service]);
      owned = false;
    },
  };
}

function processLauncher(
  executable: string,
  args: string[],
  cwd: string,
  pidFile: string,
  runtime: LauncherRuntime,
  platform: NodeJS.Platform,
): ComfyLauncher {
  const resolvedCwd = resolve(cwd);
  const resolvedPidFile = resolve(pidFile);
  let ownedPid: number | null = null;
  if (!isAbsolute(executable)) return unavailable("ComfyUI 可执行文件必须使用绝对路径");
  const pidFileRelative = relative(resolvedCwd, resolvedPidFile);
  if (pidFileRelative.startsWith("..") || isAbsolute(pidFileRelative)) {
    return unavailable("PID 文件必须位于 ComfyUI 工作目录内");
  }
  const readRunningPid = async () => {
    try {
      const pid = Number.parseInt(await readFile(resolvedPidFile, "utf8"), 10);
      return Number.isInteger(pid) && pid > 0 && runtime.processRunning(pid) ? pid : null;
    } catch {
      return null;
    }
  };
  return {
    kind: "process",
    preflight: async () => {
      try {
        await access(executable, platform === "win32" ? constants.F_OK : constants.X_OK);
        await access(resolvedCwd);
        await access(dirname(resolvedPidFile), constants.W_OK);
        if ((ownedPid && runtime.processRunning(ownedPid)) || (await readRunningPid())) {
          throw new Error("已记录的 ComfyUI 进程仍在运行，但接口未响应");
        }
        return {
          id: "launcher",
          label: "启动方式",
          status: "pass",
          detail: `独立进程 · ${executable}`,
        };
      } catch (error) {
        return {
          id: "launcher",
          label: "启动方式",
          status: "blocked",
          detail: error instanceof Error ? error.message : "无法验证 ComfyUI 可执行文件",
        };
      }
    },
    start: async () => {
      const pid = runtime.startProcess(executable, args, resolvedCwd);
      ownedPid = pid;
      try {
        await writeFile(resolvedPidFile, `${pid}\n`, { mode: 0o600 });
      } catch (error) {
        try {
          await runtime.stopProcess(pid);
          ownedPid = null;
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "ComfyUI 已启动，但 PID 文件写入和进程回滚均失败",
          );
        }
        throw error;
      }
    },
    stop: async () => {
      // A PID file survives server restarts and its numeric PID may later belong
      // to another program. Only stop a process started by this launcher instance.
      const pid = ownedPid;
      if (!pid) return;
      await runtime.stopProcess(pid);
      ownedPid = null;
      await unlink(resolvedPidFile).catch(() => undefined);
    },
  };
}

function parseArgs(value: string | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

export function launcherConfigFromEnvironment(): ComfyLauncherConfig {
  const launchdLabel = process.env.COMFY_LAUNCHD_LABEL;
  const windowsService = process.env.COMFY_WINDOWS_SERVICE;
  const executable = process.env.COMFY_START_EXECUTABLE;
  const cwd = process.env.COMFY_START_CWD;
  const pidFile = process.env.COMFY_START_PID_FILE;
  return {
    provider: (process.env.COMFY_LAUNCH_PROVIDER as ComfyLauncherConfig["provider"]) ?? "auto",
    systemdService: process.env.COMFY_START_SERVICE ?? "takeboard-comfy.service",
    args: parseArgs(process.env.COMFY_START_ARGS_JSON),
    ...(launchdLabel ? { launchdLabel } : {}),
    ...(windowsService ? { windowsService } : {}),
    ...(executable ? { executable } : {}),
    ...(cwd ? { cwd } : {}),
    ...(pidFile ? { pidFile } : {}),
  };
}

export function createComfyLauncher(config: ComfyLauncherConfig): ComfyLauncher {
  const runtime = { ...defaultRuntime, ...config.runtime };
  const platform = config.platform ?? process.platform;
  const provider = config.provider ?? "auto";
  if (provider === "process" || (provider === "auto" && config.executable)) {
    if (!config.executable || !config.cwd) {
      return unavailable("独立进程模式缺少可执行文件或工作目录");
    }
    return processLauncher(
      config.executable,
      config.args ?? [],
      config.cwd,
      config.pidFile ?? resolve(config.cwd, ".takeboard-comfy.pid"),
      runtime,
      platform,
    );
  }
  if (provider === "systemd" || (provider === "auto" && platform === "linux")) {
    return config.systemdService
      ? systemdLauncher(config.systemdService, runtime)
      : unavailable("Linux 未配置 ComfyUI systemd 用户服务");
  }
  if (provider === "launchd" || (provider === "auto" && platform === "darwin")) {
    return config.launchdLabel
      ? launchdLauncher(config.launchdLabel, runtime)
      : unavailable("macOS 未配置 ComfyUI LaunchAgent Label");
  }
  if (provider === "windows-service" || (provider === "auto" && platform === "win32")) {
    return config.windowsService
      ? windowsServiceLauncher(config.windowsService, runtime)
      : unavailable("Windows 未配置 ComfyUI 服务名");
  }
  return unavailable("当前平台没有可验证的 ComfyUI 启动方式");
}
