import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isMainModule } from "./is-main-module.mjs";

export function reviewRustAudit(report, policy, now = Date.now()) {
  assert.ok(report?.database?.["advisory-count"] > 0, "Missing RustSec database");
  assert.ok(report?.lockfile?.["dependency-count"] > 0, "Missing audited lockfile");
  assert.deepEqual(report?.settings?.ignore, [], "Do not hide advisories in the scanner");
  const vulnerabilities = report?.vulnerabilities;
  assert.equal(vulnerabilities?.found, false, "Rust vulnerabilities require a dependency fix");
  assert.equal(vulnerabilities?.count, 0);
  assert.deepEqual(vulnerabilities?.list, []);
  assert.ok(report.warnings && typeof report.warnings === "object", "Missing warning report");
  const messages = [];
  for (const [kind, findings] of Object.entries(report.warnings)) {
    assert.ok(Array.isArray(findings), `Invalid ${kind} findings`);
    for (const finding of findings) {
      const { id, title } = finding.advisory ?? {};
      const { name, version } = finding.package ?? {};
      assert.ok(id && title && name && version, "Incomplete RustSec finding");
      if (kind !== "unmaintained" && kind !== "notice") {
        const exception = policy.exceptions?.find(
          (entry) => entry.advisoryId === id && entry.package === name,
        );
        assert.ok(exception, `Unreviewed ${kind} advisory: ${id} (${name} ${version})`);
        assert.ok(
          exception.affectedVersions.includes(version),
          `${id}: dependency version changed`,
        );
        const expiry = Date.parse(`${exception.expiresOn}T23:59:59Z`);
        assert.ok(Number.isFinite(expiry) && now <= expiry, `${id}: exception expired`);
        messages.push(
          `${id}: ${name} ${version} — unresolved; exception until ${exception.expiresOn}`,
        );
      } else {
        messages.push(`${id}: ${name} ${version} — ${title}`);
      }
    }
  }
  return messages;
}

if (isMainModule(import.meta.url)) {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const policy = JSON.parse(
    await readFile(new URL("../security/rust-advisory-exceptions.json", import.meta.url), "utf8"),
  );
  const messages = reviewRustAudit(JSON.parse(input), policy);
  console.log(`RustSec: no vulnerability entries; ${messages.length} unresolved warning(s).`);
  for (const message of messages) console.log(message);
}
