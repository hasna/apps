import { readFileSync } from "fs";

const evidenceTypes = readFileSync("dist/lib/evidence.d.ts", "utf8");
const storeTypes = readFileSync("dist/store/types.d.ts", "utf8");
const apiStoreTypes = readFileSync("dist/store/api-store.d.ts", "utf8");
const localStoreTypes = readFileSync("dist/store/local-store.d.ts", "utf8");
const rootTypes = readFileSync("dist/index.d.ts", "utf8");
const generatedSdk = readFileSync("src/sdk/client.ts", "utf8");

assertIncludes(
  evidenceTypes,
  "Promise<EvidenceUploadResult>",
  "public uploadEvidenceFile declaration must preserve EvidenceUploadResult",
);
for (const [name, declarations] of [
  ["FilesStore", storeTypes],
  ["ApiStore", apiStoreTypes],
  ["LocalStore", localStoreTypes],
] as const) {
  const uploadLine = declarations.split("\n").find((line) => line.includes("uploadEvidenceFile(")) ?? "";
  assertIncludes(uploadLine, "Promise<EvidenceUploadResult>", `${name} upload result compatibility`);
}
assertIncludes(rootTypes, "EvidenceUploadReceipt, EvidenceUploadResult", "root evidence result exports");
assertIncludes(generatedSdk, "createEvidenceUploadIntent(", "generated create-intent SDK operation");
assertIncludes(generatedSdk, "completeEvidenceUpload(", "generated completion SDK operation");
assertIncludes(generatedSdk, "interface EvidenceUploadReceipt", "generated safe upload receipt schema");

console.log("evidence package API contract: ok");

function assertIncludes(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) throw new Error(`${label}: missing ${needle}`);
}
