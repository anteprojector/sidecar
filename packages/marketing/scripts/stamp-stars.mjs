#!/usr/bin/env node
// Stamps the current GitHub star count into site/index.html so the page loads
// with a fresh number even before (or without) the client-side refresh in
// main.js. Runs in the Pages workflow before the artifact upload; any failure
// leaves the checked-in count in place rather than failing the deploy.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "anteprojector/sidecar";
const indexPath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "site", "index.html");

function format(count) {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`;
}

try {
  // Actions runners share egress IPs, so unauthenticated calls get rate
  // limited; the workflow passes the job's GITHUB_TOKEN.
  const headers = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
  const response = await fetch(`https://api.github.com/repos/${REPO}`, { headers });
  if (!response.ok) throw new Error(`GitHub API responded ${response.status}`);
  const { stargazers_count: stars } = await response.json();
  if (typeof stars !== "number") throw new Error("no stargazers_count in response");

  const html = fs.readFileSync(indexPath, "utf8");
  const stamped = html.replace(/(<span[^>]*\bdata-stars\b[^>]*>)[^<]*(<\/span>)/g, `$1${format(stars)}$2`);
  if (!html.includes("data-stars")) throw new Error("data-stars placeholder not found");
  fs.writeFileSync(indexPath, stamped, "utf8");
  console.log(`stamped ${stars} stars into ${indexPath}`);
} catch (error) {
  console.warn(`stamp-stars: ${error instanceof Error ? error.message : String(error)}; keeping checked-in count`);
}
