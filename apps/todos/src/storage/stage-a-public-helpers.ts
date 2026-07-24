import { assertTodosLocalStorageRole } from "./config.js";
import { resolveTodosStorageRuntimeModulePath } from "./runtime-module-path.js";

type Runtime = typeof import("./stage-a-public-helper-runtime.js");

function loadRuntime(): Runtime {
  assertTodosLocalStorageRole(process.env);
  const runtimePath = resolveTodosStorageRuntimeModulePath(import.meta.url, "stage-a-public-helper-runtime");
  return require(runtimePath) as Runtime;
}

type BuildS3ObjectKey = Runtime["buildS3ObjectKey"];
type BuildS3ObjectUrl = Runtime["buildS3ObjectUrl"];
type SignAwsV4Request = Runtime["signAwsV4Request"];

export const buildS3ObjectKey = function buildS3ObjectKey(
  config: Parameters<BuildS3ObjectKey>[0],
  relativePath: Parameters<BuildS3ObjectKey>[1],
): ReturnType<BuildS3ObjectKey> {
  assertTodosLocalStorageRole(process.env);
  return loadRuntime().buildS3ObjectKey(config, relativePath);
} as BuildS3ObjectKey;

export const buildS3ObjectUrl = function buildS3ObjectUrl(
  config: Parameters<BuildS3ObjectUrl>[0],
  key: Parameters<BuildS3ObjectUrl>[1],
): ReturnType<BuildS3ObjectUrl> {
  assertTodosLocalStorageRole(process.env);
  return loadRuntime().buildS3ObjectUrl(config, key);
} as BuildS3ObjectUrl;

export const signAwsV4Request = function signAwsV4Request(
  input: Parameters<SignAwsV4Request>[0],
): ReturnType<SignAwsV4Request> {
  assertTodosLocalStorageRole(process.env);
  return loadRuntime().signAwsV4Request(input);
} as SignAwsV4Request;
