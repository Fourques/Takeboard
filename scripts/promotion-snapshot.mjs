#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const repository = "Fourques/Takeboard";

export function summarizeDownloads(assets) {
  if (!Array.isArray(assets)) return null;
  const installers = assets.filter((asset) => /\.(dmg|exe|deb)$/.test(asset.name ?? ""));
  if (
    installers.some(
      (asset) => !Number.isSafeInteger(asset.download_count) || asset.download_count < 0,
    )
  )
    return null;
  return {
    total: installers.reduce((sum, asset) => sum + asset.download_count, 0),
    installers: installers.map((asset) => ({ name: asset.name, downloads: asset.download_count })),
    meaning: "Download events, including maintainer/CI downloads; not unique users or activations.",
  };
}

function readApi(endpoint, args = []) {
  try {
    return {
      available: true,
      data: JSON.parse(
        execFileSync("gh", ["api", endpoint, ...args], {
          encoding: "utf8",
          timeout: 30_000,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ),
    };
  } catch {
    // Do not print credentials, proxy details or response bodies from failed commands.
    return { available: false, data: null };
  }
}

export function collectSnapshot() {
  const repo = readApi(`repos/${repository}`).data;
  const release = readApi(`repos/${repository}/releases/tags/v0.2.0-beta.17`).data;
  const views = readApi(`repos/${repository}/traffic/views`).data;
  const clones = readApi(`repos/${repository}/traffic/clones`).data;
  const weekly = readApi("repos/ruanyf/weekly/issues/11963").data;
  const directory = readApi(
    "repos/light-and-ray/awesome-alternative-uis-for-comfyui/issues/107",
  ).data;
  const discussion = readApi("graphql", [
    "-f",
    'query={repository(owner:"Fourques",name:"Takeboard"){discussion(number:10){comments{totalCount}}}}',
  ]).data?.data?.repository?.discussion;
  return {
    observedAt: new Date().toISOString(),
    campaignRelease: "v0.2.0-beta.17",
    stars: repo?.stargazers_count ?? null,
    forks: repo?.forks_count ?? null,
    downloads: summarizeDownloads(release?.assets),
    traffic14Days: views ? { views: views.count, uniqueVisitors: views.uniques } : null,
    clones14Days: clones ? { clones: clones.count, uniqueCloners: clones.uniques } : null,
    feedbackComments: discussion?.comments?.totalCount ?? null,
    weeklySubmission: weekly
      ? { state: weekly.state, comments: weekly.comments, url: weekly.html_url }
      : null,
    comfyDirectorySubmission: directory
      ? { state: directory.state, comments: directory.comments, url: directory.html_url }
      : null,
    limitations: [
      "null means unavailable, not zero.",
      "Traffic windows overlap. Do not add weekly snapshots together or attribute them to a channel.",
      "Clones may be CI or bots. Downloads and stars do not prove installation, retention or real users.",
      "A closed submission does not prove editorial acceptance. Read the actual response before recording inclusion.",
      "No application telemetry or individual user data is collected.",
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(collectSnapshot(), null, 2));
}
