import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateRemoteHost } from "./remote-connection.mjs";

const execute = promisify(execFile);

const quotePosix = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const quotePowerShell = (value) => `'${value.replaceAll("'", "''")}'`;

function serviceFailure(message) {
  return Object.assign(
    new Error(typeof message === "string" ? message.slice(0, 2000) : "远程服务管理失败"),
    { code: "REMOTE_SERVICE_ERROR" },
  );
}

export function bootstrapCommand(platform, action, instanceId = "") {
  if (!["posix", "windows"].includes(platform) || !["inspect", "start"].includes(action))
    throw new Error("不支持的远程管理操作");
  if (
    typeof instanceId !== "string" ||
    instanceId.length > 200 ||
    [...instanceId].some((c) => c.charCodeAt(0) < 32)
  )
    throw new Error("实例标识无效");
  if (platform === "windows") {
    const script = `$ErrorActionPreference='Stop'; $roots=@((Join-Path $env:LOCALAPPDATA 'TakeBoard'),(Join-Path $env:ProgramFiles 'TakeBoard')); foreach($root in $roots) { $node=Join-Path $root 'takeboard-node.exe'; $entry=Join-Path $root 'TakeBoard/remote-service.mjs'; if((Test-Path -LiteralPath $node -PathType Leaf) -and (Test-Path -LiteralPath $entry -PathType Leaf)) { & $node $entry ${quotePowerShell(action)} ${quotePowerShell(instanceId)}; exit $LASTEXITCODE } }; Write-Output '{"protocol":1,"installed":false,"state":"not_installed"}'`;
    return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
  }
  // Only known packaged paths are executed; host/address never enters this shell string.
  return `if [ -x /Applications/TakeBoard.app/Contents/MacOS/takeboard-node ] && [ -f /Applications/TakeBoard.app/Contents/Resources/TakeBoard/remote-service.mjs ]; then exec /Applications/TakeBoard.app/Contents/MacOS/takeboard-node /Applications/TakeBoard.app/Contents/Resources/TakeBoard/remote-service.mjs ${quotePosix(action)} ${quotePosix(instanceId)}; elif [ -x /usr/bin/takeboard-node ] && [ -f /usr/lib/TakeBoard/TakeBoard/remote-service.mjs ]; then exec /usr/bin/takeboard-node /usr/lib/TakeBoard/TakeBoard/remote-service.mjs ${quotePosix(action)} ${quotePosix(instanceId)}; else printf '%s\\n' '{"protocol":1,"installed":false,"state":"not_installed"}'; fi`;
}

export async function manageRemoteService(
  { host, platform = "auto", action = "inspect", instanceId = "", signal },
  runtime = execute,
) {
  validateRemoteHost(host);
  const candidates = platform === "auto" ? ["posix", "windows"] : [platform];
  let lastError;
  for (const candidate of candidates) {
    try {
      const { stdout } = await runtime(
        process.platform === "win32" ? "ssh.exe" : "ssh",
        [
          "-n",
          "-T",
          "-o",
          "BatchMode=yes",
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          "ConnectTimeout=10",
          "-o",
          "ControlPath=none",
          "-o",
          "ControlMaster=no",
          "-o",
          "ControlPersist=no",
          host,
          bootstrapCommand(candidate, action, instanceId),
        ],
        {
          timeout: action === "start" ? 80000 : 15000,
          maxBuffer: 65536,
          windowsHide: true,
          signal,
        },
      );
      const value = stdout
        .trim()
        .split(/\r?\n/)
        .reverse()
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .find((item) => item?.protocol === 1);
      if (
        !value ||
        !["not_installed", "running", "stopped", "busy", "failed"].includes(value.state)
      )
        throw new Error("无法识别远程管理响应");
      if (value.state === "failed") throw serviceFailure(value.message);
      if (
        value.state !== "not_installed" &&
        (value.installed !== true ||
          typeof value.version !== "string" ||
          value.version.length > 100 ||
          typeof value.dataRoot !== "string" ||
          value.dataRoot.length > 4096 ||
          !["linux", "darwin", "win32"].includes(value.platform) ||
          (value.instanceId !== null &&
            (typeof value.instanceId !== "string" ||
              !/^[A-Za-z0-9-]{10,100}$/.test(value.instanceId))) ||
          (value.state === "running" &&
            (!Number.isInteger(value.port) ||
              value.port < 1 ||
              value.port > 65535 ||
              !value.instanceId)))
      )
        throw new Error("远程服务返回的设备信息无效");
      return value;
    } catch (error) {
      if (error?.code === "REMOTE_SERVICE_ERROR") throw error;
      // execFile rejects a nonzero exit even when the installed helper returned
      // a useful protocol error. Do not hide that error by scanning other data roots.
      if (typeof error?.stdout === "string" && error.stdout.length <= 65536) {
        for (const line of error.stdout.trim().split(/\r?\n/).reverse()) {
          let payload;
          try {
            payload = JSON.parse(line);
          } catch {
            continue;
          }
          if (payload?.protocol === 1 && payload.state === "failed")
            throw serviceFailure(payload.message);
        }
      }
      lastError = error;
      // A startup attempt must never be repeated with another platform after an
      // ambiguous timeout; the server may already be starting successfully.
      if (signal?.aborted || action === "start") throw error;
    }
  }
  throw lastError ?? new Error("无法连接 SSH 服务");
}
