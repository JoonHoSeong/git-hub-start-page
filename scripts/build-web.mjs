import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const OUT = "web/dist";

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// Bundle the web entry point into plain JS the browser can load.
await build({
  entryPoints: {
    main: "web/src/main.ts",
  },
  bundle: true,
  format: "esm",
  target: "es2022",
  outdir: OUT,
  logLevel: "info",
});

// Copy static assets (HTML/CSS/icons) alongside the bundle.
await cp("web/public/index.html", `${OUT}/index.html`);
await cp("extension/popup.css", `${OUT}/popup.css`);
await cp("extension/icons/icon128.png", `${OUT}/icon128.png`);

console.log(`\nBuilt web app -> ${OUT}`);
console.log("Serve it with: npx wrangler dev (from web/) or deploy with: npx wrangler deploy");
