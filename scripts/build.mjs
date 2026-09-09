import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const OUT = "extension/dist";

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// Bundle the three extension entry points into plain JS the browser can load.
await build({
  entryPoints: {
    "service-worker": "extension/src/service-worker.ts",
    popup: "extension/src/popup.ts",
  },
  bundle: true,
  format: "esm",
  target: "chrome110",
  outdir: OUT,
  logLevel: "info",
});

// Copy static assets alongside the bundles.
for (const file of ["manifest.json", "popup.html", "popup.css"]) {
  await cp(`extension/${file}`, `${OUT}/${file}`);
}
if (existsSync("extension/icons")) {
  await cp("extension/icons", `${OUT}/icons`, { recursive: true });
}

console.log(`\nBuilt unpacked extension -> ${OUT}`);
console.log("Load it in chrome://extensions (Developer mode > Load unpacked).");
