import { build } from "esbuild";
import { builtinModules } from "module";

async function main() {
  await build({
  entryPoints: ["server.js"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/server.js",
  // Externalize ALL Node built-ins so CJS deps (mailparser, mailsplit)
  // don't hit "Dynamic require of 'stream' is not supported" errors.
  external: builtinModules.flatMap((m) => [m, `node:${m}`]),
  banner: {
    // Provide a real require() for CJS dependencies bundled into ESM.
    // Use a unique identifier so we don't collide with source-level `import { createRequire }` statements
    // (esbuild treats the banner as opaque text and can't dedupe against real imports).
    js: `import { createRequire as __esbuildBannerCreateRequire } from "module"; const require = __esbuildBannerCreateRequire(import.meta.url);`,
  },
});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
