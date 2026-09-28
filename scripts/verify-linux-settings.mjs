// Real WebKitGTK + installed Tauri host. No stubbed native bridge or browser replacement.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifyNativeSettings({
  start,
  until,
  capture,
  health,
  dataRoot,
  executable,
  vacantPort,
}) {
  const port = await vacantPort();
  const nativePort = await vacantPort();
  const driver = start("tauri-driver", [
    "--port",
    String(port),
    "--native-port",
    String(nativePort),
  ]);
  let session;
  const request = async (path, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      signal: AbortSignal.timeout(45000),
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result.value));
    return result.value;
  };
  const command = (path, body, method) => request(`/session/${session}${path}`, body, method);
  const find = async (selector) =>
    until(`native element ${selector}`, async () => {
      const element = await command("/element", { using: "css selector", value: selector });
      return element["element-6066-11e4-a52e-4f735466cecf"];
    });
  const click = async (selector) => command(`/element/${await find(selector)}/click`, {});
  const windows = (pid) =>
    execFileSync(
      "xdotool",
      ["search", "--all", "--onlyvisible", "--pid", String(pid), "--name", "^TakeBoard"],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n");
  try {
    await until("native WebDriver ready", () => request("/status"));
    const created = await request("/session", {
      capabilities: { alwaysMatch: { "tauri:options": { application: executable } } },
    });
    session = created.sessionId;
    assert.ok(session, "WebDriver session missing");
    const record = await until("automated native server ready", async () => {
      const value = JSON.parse(await readFile(join(dataRoot, ".system/instance.json"), "utf8"));
      return (await health(value.port))?.instanceId === value.instanceId && value;
    });
    await find('[aria-label="打开工作区选项"]');
    const main = execFileSync("xdotool", ["search", "--onlyvisible", "--name", "^TakeBoard"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")[0];
    const pid = execFileSync("xdotool", ["getwindowpid", main], { encoding: "utf8" }).trim();
    assert.equal(windows(pid).length, 1, "Fresh native app has one workspace window");
    execFileSync("xdotool", ["windowactivate", "--sync", main]);
    execFileSync("xdotool", ["key", "--clearmodifiers", "ctrl+shift+k"]);
    // This is a native <dialog>; its implicit ARIA role is not a role attribute.
    await find("dialog[open] .remote-project-settings");
    assert.equal(
      windows(pid).length,
      1,
      "Connection settings must not open the removed standalone window",
    );
    capture(main, "connection-settings");
    await click('.remote-project-settings select option[value="https"]');
    const address = await find(".remote-project-settings input[required]");
    await command(`/element/${address}/value`, { text: `http://127.0.0.1:${record.port}` });
    await click('.remote-project-settings button[type="submit"]');
    const remote = await until("verified native remote workspace", () =>
      windows(pid).find((id) => id !== main),
    );
    capture(remote, "remote-workspace");
    execFileSync("xdotool", ["windowactivate", "--sync", remote]);
    execFileSync("xdotool", ["key", "--clearmodifiers", "alt+F4"]);
    await until("remote window closed", () => windows(pid).length === 1);
    assert.equal(
      (await health(record.port))?.instanceId,
      record.instanceId,
      "Closing remote workspace must not stop its server",
    );
    // Exercise the window manager's actual close path, not WebDriver session
    // disposal (which is allowed to leave the application process running).
    execFileSync("xdotool", ["windowactivate", "--sync", main]);
    execFileSync("xdotool", ["key", "--clearmodifiers", "alt+F4"]);
    await until(
      "automated app releases owned server",
      async () =>
        !(await health(record.port)) && !existsSync(join(dataRoot, ".system/instance.json")),
    );
    console.log(
      "PASS: native menu opens Settings, real connection opens workspace, remote close preserves server, app exit releases owned service",
    );
  } catch (error) {
    console.error(driver.log);
    if (session) {
      const source = await command("/source").catch(() => null);
      if (source) await writeFile("test-results/linux-desktop/settings-failure.html", source);
      const screenshot = await command("/screenshot").catch(() => null);
      if (screenshot)
        await writeFile(
          "test-results/linux-desktop/settings-failure.png",
          Buffer.from(screenshot, "base64"),
        );
    }
    throw error;
  } finally {
    if (session) await command("", undefined, "DELETE").catch(() => {});
    driver.child.kill("SIGTERM");
  }
}
