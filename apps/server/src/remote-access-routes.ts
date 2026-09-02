import type { RemoteAccessCheck, RemoteAccessStatus } from "@takeboard/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthService } from "./auth-service.js";
import { isLoopbackHostname } from "./request-security.js";

export type RemoteAccessOptions = {
  auth: AuthService;
  instanceId?: string | null;
  instanceName?: string | null;
  bindHost?: string;
  port?: number;
  publicUrl?: string | null;
  secureCookies?: boolean;
  allowedHosts?: string[];
  allowedOrigins?: string[];
};

function normalizedEntries(values: string[] | undefined) {
  return new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function configuredEntries(value: string | undefined) {
  return value ? value.split(",") : [];
}

function requestOrigin(request: FastifyRequest) {
  const host = request.headers.host ?? "127.0.0.1";
  return `${request.protocol}://${host}`;
}

function requestHostname(request: FastifyRequest) {
  try {
    return new URL(requestOrigin(request)).hostname;
  } catch {
    return "127.0.0.1";
  }
}

function inspectPublicUrl(raw: string | null | undefined) {
  if (!raw?.trim()) return { url: null, error: null };
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return { url: null, error: "团队入口必须使用 HTTPS" };
    if (url.username || url.password || url.search || url.hash) {
      return { url: null, error: "团队入口不能包含账号、密码、查询参数或片段" };
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return { url, error: null };
  } catch {
    return { url: null, error: "TAKEBOARD_PUBLIC_URL 不是有效网址" };
  }
}

export function buildRemoteAccessStatus(
  request: FastifyRequest,
  options: RemoteAccessOptions,
): RemoteAccessStatus {
  const instanceId = options.instanceId?.trim() || null;
  const bindHost = options.bindHost?.trim() || "127.0.0.1";
  const port = options.port && options.port > 0 && options.port <= 65_535 ? options.port : 48_120;
  const publicUrlResult = inspectPublicUrl(options.publicUrl);
  const allowedHosts = normalizedEntries([
    ...configuredEntries(process.env.TAKEBOARD_ALLOWED_HOSTS),
    ...(options.allowedHosts ?? []),
  ]);
  const allowedOrigins = normalizedEntries([
    ...configuredEntries(process.env.TAKEBOARD_ALLOWED_ORIGINS),
    ...(options.allowedOrigins ?? []),
  ]);
  const publicHost = publicUrlResult.url?.host.toLowerCase() ?? null;
  const publicHostname = publicUrlResult.url?.hostname.toLowerCase() ?? null;
  const publicOrigin = publicUrlResult.url?.origin.toLowerCase() ?? null;
  const hostAllowed = Boolean(
    publicHost &&
      publicHostname &&
      (allowedHosts.has(publicHost) || allowedHosts.has(publicHostname)),
  );
  const originAllowed = Boolean(publicOrigin && allowedOrigins.has(publicOrigin));
  const secureCookies = options.secureCookies ?? process.env.TAKEBOARD_SECURE_COOKIES === "1";
  const accountReady = options.auth.mode === "required" && options.auth.configured();
  const checks: RemoteAccessCheck[] = [
    {
      id: "identity",
      label: "实例身份",
      status: instanceId ? "pass" : "warning",
      detail: instanceId
        ? "这台 TakeBoard 已有稳定设备标识"
        : "当前启动方式没有持久实例标识；SSH 可用，但不能安全加入未来的账号门户",
    },
    {
      id: "accounts",
      label: "账号保护",
      status: accountReady ? "pass" : "blocked",
      detail: accountReady
        ? "服务端账号与会话验证已启用"
        : "远程访问必须启用 required 账号模式并完成首位管理员设置",
    },
    {
      id: "binding",
      label: "监听边界",
      status: isLoopbackHostname(bindHost) ? "pass" : "warning",
      detail: isLoopbackHostname(bindHost)
        ? "TakeBoard 只监听本机回环地址，适合 SSH 或出站连接器"
        : `当前监听 ${bindHost}；请确认防火墙只允许受控反向代理访问`,
    },
  ];

  let httpsState: RemoteAccessStatus["https"]["state"] = "not_configured";
  let httpsDetail = "尚未配置团队 HTTPS 入口；个人远程使用可继续采用 SSH";
  if (publicUrlResult.error) {
    httpsState = "blocked";
    httpsDetail = publicUrlResult.error;
  } else if (publicUrlResult.url) {
    const httpsChecks: RemoteAccessCheck[] = [
      {
        id: "https",
        label: "传输加密",
        status: "pass",
        detail: "公开入口使用 HTTPS",
      },
      {
        id: "cookies",
        label: "安全会话",
        status: secureCookies ? "pass" : "blocked",
        detail: secureCookies
          ? "会话 Cookie 仅通过安全连接发送"
          : "配置团队入口时必须设置 TAKEBOARD_SECURE_COOKIES=1",
      },
      {
        id: "allowlist",
        label: "入口白名单",
        status: hostAllowed && originAllowed ? "pass" : "blocked",
        detail:
          hostAllowed && originAllowed
            ? "公开域名已同时加入 Host 与 Origin 白名单"
            : "请把公开域名加入 TAKEBOARD_ALLOWED_HOSTS 与 TAKEBOARD_ALLOWED_ORIGINS",
      },
    ];
    checks.push(...httpsChecks);
    httpsState =
      accountReady && secureCookies && hostAllowed && originAllowed ? "ready" : "blocked";
    httpsDetail =
      httpsState === "ready"
        ? "这个实例已具备通过受控 HTTPS 反向代理访问的必要配置"
        : "HTTPS 地址已填写，但安全配置尚未完整通过";
  } else {
    checks.push({
      id: "https",
      label: "团队入口",
      status: "warning",
      detail: "未配置，不影响本机与 SSH 使用",
    });
  }

  const hostname = requestHostname(request);
  const currentOrigin = requestOrigin(request);
  const currentIsLoopback = isLoopbackHostname(hostname);
  const currentIsHttps = request.protocol === "https" || currentOrigin.startsWith("https://");
  const sshReady = accountReady && isLoopbackHostname(bindHost);

  return {
    instance: {
      id: instanceId,
      name: options.instanceName?.trim().slice(0, 80) || "这台 TakeBoard",
    },
    currentAccess: {
      kind: currentIsLoopback
        ? "local_or_ssh"
        : currentIsHttps || publicUrlResult.url
          ? "https_proxy"
          : "private_network",
      origin: currentOrigin,
      protection: currentIsLoopback ? "loopback" : currentIsHttps ? "tls" : "network",
    },
    ssh: {
      state: sshReady ? "ready" : "attention",
      remotePort: port,
      suggestedLocalPort: 48_230,
      command: `ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 48230:127.0.0.1:${port} your-server`,
      detail: sshReady
        ? "无需公网开放端口；SSH 退出后本地映射会自动释放"
        : "先完成账号保护并保持 TakeBoard 只监听回环地址",
    },
    https: {
      state: httpsState,
      publicUrl: publicUrlResult.url?.toString() ?? null,
      detail: httpsDetail,
    },
    managedPortal: {
      state: "not_available",
      detail: "账号设备门户仍在设计中；当前版本不会把本机账号伪装成云账号",
    },
    checks,
  };
}

export function registerRemoteAccessRoutes(app: FastifyInstance, options: RemoteAccessOptions) {
  app.get("/api/remote-access/status", async (request) =>
    buildRemoteAccessStatus(request, options),
  );
}
