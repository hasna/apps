// Derive declarations from the actual public exports; never maintain a divergent facade.
const result = Bun.spawnSync(["bunx", "tsc", "--emitDeclarationOnly", "--declaration", "--declarationMap", "false"], { stdout: "inherit", stderr: "inherit" });
if (result.exitCode !== 0) process.exit(result.exitCode);
