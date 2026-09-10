import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Builds the extension and zips extension/dist into release/ for Chrome Web
// Store upload. Run: node scripts/package.mjs
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(root, "extension", "dist");
const releaseDir = path.join(root, "release");

console.log("=== build ===");
execSync("node scripts/build.mjs", { cwd: root, stdio: "inherit" });

if (!existsSync(distDir)) {
  throw new Error(`Build output not found at ${distDir}`);
}

const manifest = JSON.parse(
  readFileSync(path.join(root, "extension", "manifest.json"), "utf8")
);
const version = manifest.version ?? "0.0.0";

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

const zipName = `github-topic-radar-v${version}.zip`;
const zipPath = path.join(releaseDir, zipName);

console.log(`=== zip -> release/${zipName} ===`);
execSync(`cd "${distDir}" && zip -r -q "${zipPath}" .`, { shell: "/bin/bash" });

console.log(`\nDone: release/${zipName}`);
console.log("Upload this file to the Chrome Web Store Developer Dashboard.");
