import { resolve } from "node:path";

const secureFastUriPath = resolve(import.meta.dir, "../vendor/fast-uri/index.js");

const secureFastUriPlugin: Bun.BunPlugin = {
  name: "contacts-secure-fast-uri",
  setup(build) {
    build.onResolve({ filter: /^fast-uri$/ }, () => ({ path: secureFastUriPath }));
  },
};

type BundleSpec = {
  entrypoint: string;
  outdir: string;
  external?: string[];
};

const allBundles: BundleSpec[] = [
  {
    entrypoint: "src/cli/index.tsx",
    outdir: "dist/cli",
    external: ["ink", "react", "chalk", "pg", "@hasna/contracts"],
  },
  {
    entrypoint: "src/mcp/index.ts",
    outdir: "dist/mcp",
    external: ["pg", "@hasna/contracts"],
  },
  {
    entrypoint: "src/server/index.ts",
    outdir: "dist/server",
    external: ["pg", "@hasna/contracts"],
  },
  { entrypoint: "src/sdk/index.ts", outdir: "dist/sdk" },
  {
    entrypoint: "src/index.ts",
    outdir: "dist",
    external: ["pg", "@hasna/contracts"],
  },
];

const standaloneServer = process.argv.includes("--standalone-server");
const serverOnly = standaloneServer || process.argv.includes("--server-only");

const bundles = standaloneServer
  ? [{ entrypoint: "src/server/cloud-index.ts", outdir: "dist/server" }]
  : serverOnly
    ? allBundles.filter(({ outdir }) => outdir === "dist/server")
    : allBundles;

for (const bundle of bundles) {
  const result = await Bun.build({
    entrypoints: [bundle.entrypoint],
    outdir: bundle.outdir,
    target: "bun",
    external: standaloneServer ? undefined : bundle.external,
    plugins: [secureFastUriPlugin],
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`Failed to build ${bundle.entrypoint}`);
  }
}
