import assert from "node:assert/strict";
import test from "node:test";
import { reviewRustAudit } from "./check-rust-audit-report.mjs";

const now = Date.parse("2026-10-10T00:00:00Z");
const policy = {
  exceptions: [
    {
      advisoryId: "RUSTSEC-2024-0429",
      package: "glib",
      affectedVersions: ["0.18.5"],
      expiresOn: "2026-12-15",
    },
  ],
};
const finding = {
  package: { name: "glib", version: "0.18.5" },
  advisory: { id: "RUSTSEC-2024-0429", title: "Unsound iterator" },
};
const clean = () => ({
  database: { "advisory-count": 1296 },
  lockfile: { "dependency-count": 494 },
  settings: { ignore: [] },
  vulnerabilities: { found: false, count: 0, list: [] },
  warnings: {},
});

test("reports the existing bounded warning as unresolved, not fixed", () => {
  const report = clean();
  report.warnings.unsound = [finding];
  assert.match(reviewRustAudit(report, policy, now)[0], /unresolved; exception until 2026-12-15/);
});

test("rejects new unsound advisories, version changes and expired exceptions", () => {
  const report = clean();
  report.warnings.unsound = [finding];
  assert.throws(() => reviewRustAudit(report, { exceptions: [] }, now), /Unreviewed/);
  assert.throws(() => reviewRustAudit(report, policy, Date.parse("2026-12-16")), /expired/);
  report.warnings.unsound = [{ ...finding, package: { name: "glib", version: "0.18.6" } }];
  assert.throws(() => reviewRustAudit(report, policy, now), /version changed/);
});

test("keeps maintenance warnings visible and does not add vulnerability exceptions", () => {
  const report = clean();
  report.warnings.unmaintained = [finding];
  assert.match(reviewRustAudit(report, policy, now)[0], /Unsound iterator/);
  report.vulnerabilities = { found: true, count: 1, list: [finding] };
  assert.throws(() => reviewRustAudit(report, policy, now), /require a dependency fix/);
});

test("rejects suppressed, incomplete and inconsistent reports", () => {
  assert.deepEqual(reviewRustAudit(clean(), policy, now), []);
  for (const mutate of [
    (report) => (report.database = {}),
    (report) => (report.lockfile = {}),
    (report) => (report.settings.ignore = ["RUSTSEC-2024-0429"]),
    (report) => (report.vulnerabilities.count = 1),
    (report) => (report.vulnerabilities.list = [finding]),
    (report) => delete report.warnings,
    (report) => (report.warnings.unsound = [{}]),
    (report) => (report.warnings.unsound = {}),
  ]) {
    const report = clean();
    mutate(report);
    assert.throws(() => reviewRustAudit(report, policy, now));
  }
});
