#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import paths, { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { seedWorkflows } from "./seed-workflows.mjs";

// Validate path semantics on the host; Windows drive/UNC roots are not ordinary folders.
export function validateCloudDirectories(config, path = paths) {
  const directories = ["appRoot", "webRoot", "comfyRoot", "python", "dataRoot"];
  for (const key of directories) {
    if (
      typeof config[key] !== "string" ||
      !path.isAbsolute(config[key]) ||
      path.resolve(config[key]) === path.parse(path.resolve(config[key])).root
    )
      throw new Error(`${key} 必须是明确的绝对路径`);
  }
  const dataRoot = path.resolve(config.dataRoot);
  const isOutside = (value) =>
    path.isAbsolute(value) || value === ".." || value.startsWith(`..${path.sep}`);
  for (const key of ["appRoot", "webRoot", "comfyRoot"]) {
    const distance = path.relative(path.resolve(config[key]), dataRoot);
    const reverse = path.relative(dataRoot, path.resolve(config[key]));
    if (!isOutside(distance) || !isOutside(reverse))
      throw new Error("项目数据与程序目录必须相互独立");
  }
  return dataRoot;
}

export function cloudEnvironment(config, inherited = process.env) {
  const dataRoot = validateCloudDirectories(config);
  const mode = config.mode ?? "tunnel";
  if (!["tunnel", "https"].includes(mode)) throw new Error("mode 必须是 tunnel 或 https");
  const port = config.port ?? (mode === "https" ? 6006 : 48120);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 8188)
    throw new Error("TakeBoard 端口无效，且不能占用 ComfyUI 的 8188 端口");
  let publicUrl = null;
  if (mode === "https") {
    try {
      publicUrl = new URL(config.publicUrl);
    } catch {
      /* validated below */
    }
    if (
      publicUrl?.protocol !== "https:" ||
      publicUrl.username ||
      publicUrl.password ||
      publicUrl.pathname !== "/" ||
      publicUrl.search ||
      publicUrl.hash
    )
      throw new Error("公开入口需要平台提供的 HTTPS 根地址，不能猜测地址或使用通配符");
  }
  // Do not inherit desktop/dev-machine bindings or credentials into a cloud instance.
  const env = Object.fromEntries(
    Object.entries(inherited).filter(
      ([key]) => !key.startsWith("TAKEBOARD_") && !key.startsWith("COMFY_"),
    ),
  );
  const loopback = (value) =>
    [
      ...new Set([...(value ?? "").split(",").filter(Boolean), "127.0.0.1", "localhost", "::1"]),
    ].join(",");
  return {
    ...env,
    NODE_ENV: "production",
    NO_PROXY: loopback(inherited.NO_PROXY),
    no_proxy: loopback(inherited.no_proxy),
    TAKEBOARD_HOST: mode === "https" ? "0.0.0.0" : "127.0.0.1",
    TAKEBOARD_PORT: String(port),
    TAKEBOARD_AUTH_MODE: "required",
    TAKEBOARD_ALLOW_NON_LOOPBACK: mode === "https" ? "1" : "0",
    TAKEBOARD_SECURE_COOKIES: mode === "https" ? "1" : "0",
    TAKEBOARD_ALLOWED_HOSTS: publicUrl?.host ?? "",
    TAKEBOARD_ALLOWED_ORIGINS: publicUrl?.origin ?? "",
    TAKEBOARD_PUBLIC_URL: publicUrl?.origin ?? "",
    TAKEBOARD_INSTANCE_NAME: "TakeBoard · AutoDL",
    TAKEBOARD_DATA_ROOT: join(dataRoot, "projects"),
    TAKEBOARD_AUTH_DATABASE: join(dataRoot, "identity", "auth.db"),
    TAKEBOARD_WEB_ROOT: resolve(config.webRoot),
    COMFY_URL: "http://127.0.0.1:8188",
    COMFY_EDITOR_URL: "",
    COMFY_INPUT_ROOT: join(dataRoot, "comfy", "input"),
    COMFY_OUTPUT_ROOT: join(dataRoot, "comfy", "output"),
    COMFY_LAUNCH_PROVIDER: "process",
    COMFY_START_EXECUTABLE: resolve(config.python),
    COMFY_START_CWD: resolve(config.comfyRoot),
    COMFY_START_PID_FILE: join(resolve(config.comfyRoot), ".takeboard-comfy.pid"),
    COMFY_START_ARGS_JSON: JSON.stringify([
      join(resolve(config.comfyRoot), "main.py"),
      "--listen",
      "127.0.0.1",
      "--port",
      "8188",
      "--cuda-device",
      "0",
      "--disable-auto-launch",
      "--disable-all-custom-nodes",
      "--preview-method",
      "none",
      "--input-directory",
      join(dataRoot, "comfy", "input"),
      "--output-directory",
      join(dataRoot, "comfy", "output"),
      "--user-directory",
      join(dataRoot, "comfy", "user"),
      "--temp-directory",
      join(dataRoot, "comfy", "temp"),
    ]),
    COMFY_ACCELERATOR: "nvidia",
    COMFY_MIN_FREE_RAM_GB: "6",
    COMFY_MIN_FREE_VRAM_GB: "8",
    COMFY_MAX_GPU_UTILIZATION: "85",
  };
}

export function hasCloudAdministrator(appRoot, database) {
  if (!existsSync(database)) return false;
  const require = createRequire(join(appRoot, "package.json"));
  const Database = require("better-sqlite3");
  const db = new Database(database, { readonly: true, fileMustExist: true });
  try {
    return (
      db
        .prepare(
          "SELECT 1 FROM auth_users WHERE instance_role = 'admin' AND status = 'active' AND local_identity = 0 LIMIT 1",
        )
        .get() !== undefined
    );
  } finally {
    db.close();
  }
}

export async function start(configFile) {
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  const env = cloudEnvironment(config);
  for (const file of [
    join(config.appRoot, "dist/index.js"),
    join(config.webRoot, "index.html"),
    join(config.comfyRoot, "main.py"),
    config.python,
  ]) {
    if (!existsSync(file)) throw new Error(`安装不完整：${file}`);
  }
  if (
    config.mode === "https" &&
    !hasCloudAdministrator(config.appRoot, env.TAKEBOARD_AUTH_DATABASE)
  )
    throw new Error(
      "尚未完成实例管理员设置。先以 tunnel 模式通过 SSH 初始化，再开放 HTTPS 入口；不会开放无人认领的管理员注册。",
    );
  for (const suffix of [
    "projects",
    "identity",
    "comfy/input",
    "comfy/output",
    "comfy/user",
    "comfy/temp",
  ])
    await mkdir(join(config.dataRoot, suffix), { recursive: true, mode: 0o700 });
  await seedWorkflows(config.dataRoot);
  for (const key of Object.keys(process.env))
    if (key.startsWith("TAKEBOARD_") || key.startsWith("COMFY_")) delete process.env[key];
  Object.assign(process.env, env);
  await import(pathToFileURL(join(config.appRoot, "dist/index.js")).href);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error("用法：node start.mjs /绝对路径/cloud.json");
  await start(resolve(process.argv[2]));
}
