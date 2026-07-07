#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const localPackages = [
  {
    name: "@hasna/actions",
    source: "../open-actions",
    requiredFiles: ["package.json", "dist/index.js", "dist/index.d.ts"],
    rebuild: true,
  },
  {
    name: "@hasna/cloud",
    source: "../open-cloud",
    requiredFiles: ["package.json", "dist/storage.js", "dist/storage.d.ts"],
    rebuild: false,
  },
];

for (const localPackage of localPackages) {
  prepareLocalPackage(localPackage);
}

function prepareLocalPackage(localPackage) {
  const sourcePath = resolveLocalSource(localPackage);
  const targetPath = packageTarget(localPackage.name);

  if (isUsablePackage(targetPath, localPackage.requiredFiles) && !localPackage.rebuild) {
    return;
  }

  if (isUsablePackage(targetPath, localPackage.requiredFiles) && localPackage.rebuild && isPreparedCopy(targetPath)) {
    return;
  }

  copyPackageSource(sourcePath, targetPath, { includeDist: !localPackage.rebuild });

  if (localPackage.rebuild) {
    run("bun", ["install", "--frozen-lockfile", "--backend=copyfile", "--ignore-scripts"], targetPath);
    run("bun", ["run", "build"], targetPath);
  }

  if (!isUsablePackage(targetPath, localPackage.requiredFiles)) {
    const missing = localPackage.requiredFiles
      .filter((file) => !isFile(join(targetPath, file)))
      .join(", ");
    throw new Error(
      `${localPackage.name} local file dependency is not prepared. Missing ${missing}. ` +
        `Source: ${sourcePath}. Target: ${targetPath}.`,
    );
  }
}

function resolveLocalSource(localPackage) {
  const sourcePath = resolve(projectRoot, localPackage.source);
  if (!existsSync(sourcePath)) {
    throw new Error(`${localPackage.name} local file dependency source is missing: ${sourcePath}`);
  }
  return realpathSync(sourcePath);
}

function packageTarget(packageName) {
  const [scope, name] = packageName.split("/");
  return join(projectRoot, "node_modules", scope, name);
}

function isUsablePackage(packagePath, requiredFiles) {
  return requiredFiles.every((file) => isFile(join(packagePath, file)));
}

function isPreparedCopy(packagePath) {
  return isFile(join(packagePath, "node_modules", ".bun", "bun.lockb")) || existsSync(join(packagePath, "node_modules"));
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function copyPackageSource(sourcePath, targetPath, options) {
  rmSync(targetPath, { recursive: true, force: true });
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, {
    recursive: true,
    dereference: true,
    filter(source) {
      const localPath = relative(sourcePath, source);
      if (!localPath) return true;
      const parts = localPath.split(sep);
      if (parts.includes(".git") || parts.includes("node_modules")) return false;
      if (!options.includeDist && parts[0] === "dist") return false;
      return true;
    },
  });
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed in ${cwd}`);
  }
}
