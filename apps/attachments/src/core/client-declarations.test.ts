import { expect, test } from "bun:test";
import ts from "typescript";
import { dirname, resolve } from "node:path";

test("public declarations close over pure client DTOs with exact legacy type compatibility", () => {
  const root = resolve(import.meta.dir, "..");
  const out = resolve(root, "../.declaration-test-virtual");
  const roots = ["index.ts", "sdk/index.ts", "testing/client-type-compatibility.ts"].map(p => resolve(root, p));
  const program = ts.createProgram(roots, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true,
    skipLibCheck: true, esModuleInterop: true, types: ["bun-types"],
    declaration: true, emitDeclarationOnly: true, rootDir: root, outDir: out,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  expect(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
  const emitted = new Map<string, string>();
  const result = program.emit(undefined, (path, body) => emitted.set(resolve(path), body));
  expect(result.emitSkipped).toBe(false);
  const pending = [resolve(out, "index.d.ts"), resolve(out, "sdk/index.d.ts")];
  const seen = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const body = emitted.get(file);
    expect(body).toBeDefined();
    expect(body).not.toMatch(/bun:sqlite|AttachmentsDB|LocalObjectStore|createObjectStore|UploadDeps|DownloadDeps/);
    for (const ref of ts.preProcessFile(body!, true, true).importedFiles) {
      if (!ref.fileName.startsWith(".")) continue;
      const base = resolve(dirname(file), ref.fileName.replace(/\.js$/, ""));
      const dependency = [base + ".d.ts", resolve(base, "index.d.ts")].find(p => emitted.has(p));
      expect(dependency).toBeDefined();
      pending.push(dependency!);
    }
  }
  expect(seen.has(resolve(out, "core/client-types.d.ts"))).toBe(true);
  for (const serverFile of ["db", "upload", "download", "object-storage"]) {
    expect(seen.has(resolve(out, `core/${serverFile}.d.ts`))).toBe(false);
  }
}, 30000);
