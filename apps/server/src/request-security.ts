import type { FastifyInstance } from "fastify";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

function commaSeparated(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isLoopbackHostname(value: string) {
  const hostname = value
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function requestHostname(host: string) {
  try {
    return new URL(`http://${host}`).hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  } catch {
    return null;
  }
}

function originAllowed(origin: string, configuredOrigins: Set<string>) {
  if (configuredOrigins.has(origin.toLowerCase())) return true;
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") && isLoopbackHostname(url.hostname)
    );
  } catch {
    return false;
  }
}

export function assertSafeBindHost(host: string, allowNonLoopback = false) {
  if (isLoopbackHostname(host) || allowNonLoopback) return;
  throw new Error(
    `TakeBoard 拒绝监听非回环地址 ${host}。当前版本没有账号系统；请使用 SSH 隧道，或在已配置认证反向代理后显式设置 TAKEBOARD_ALLOW_NON_LOOPBACK=1。`,
  );
}

export type RequestSecurityOptions = {
  allowedHosts?: string[];
  allowedOrigins?: string[];
};

export function registerRequestSecurity(
  app: FastifyInstance,
  options: RequestSecurityOptions = {},
) {
  const configuredHosts = new Set([
    ...commaSeparated(process.env.TAKEBOARD_ALLOWED_HOSTS),
    ...(options.allowedHosts ?? []).map((entry) => entry.trim().toLowerCase()),
  ]);
  const configuredOrigins = new Set([
    ...commaSeparated(process.env.TAKEBOARD_ALLOWED_ORIGINS),
    ...(options.allowedOrigins ?? []).map((entry) => entry.trim().toLowerCase()),
  ]);

  app.addHook("onRequest", async (request, reply) => {
    const host = request.headers.host?.trim().toLowerCase();
    const hostname = host ? requestHostname(host) : null;
    if (
      !host ||
      !hostname ||
      (!isLoopbackHostname(hostname) &&
        !configuredHosts.has(host) &&
        !configuredHosts.has(hostname))
    ) {
      return await reply.code(421).send({
        error: "请求主机不在 TakeBoard 允许范围内；请使用本机地址或已认证的 SSH/反向代理入口",
      });
    }

    const origin = request.headers.origin;
    if (origin && !originAllowed(origin, configuredOrigins)) {
      return await reply.code(403).send({
        error: safeMethods.has(request.method)
          ? "跨站页面不能读取 TakeBoard 本地数据"
          : "跨站页面不能修改 TakeBoard 本地项目",
      });
    }
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply
      .header("x-content-type-options", "nosniff")
      .header("referrer-policy", "no-referrer")
      .header("x-frame-options", "DENY")
      .header("cross-origin-resource-policy", "same-origin")
      .header("permissions-policy", "camera=(), microphone=(), geolocation=()")
      .header(
        "content-security-policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      );
    return payload;
  });
}
