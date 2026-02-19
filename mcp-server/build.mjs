import { build } from "esbuild";
import { builtinModules } from "module";

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
    js: `import { createRequire } from "module"; const require = createRequire(import.meta.url);`,
  },
});
