import type { SkillBundleEntry } from "./skill-bundle.js";

export function contentEntry(path: string, value: string | number[], mode = 0o644): SkillBundleEntry {
  return { path, bytes: typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value), mode };
}

export function contentHashFixture(): SkillBundleEntry[] {
  return [
    contentEntry("SKILL.md", "---\r\nname: hash-fixture\r\ndescription: Hash fixture.\r\n---\r\nBody.\rNext.\n"),
    contentEntry("skill.json", JSON.stringify({ name: "hash-fixture", version: "1.0.0", content_hash: "a".repeat(64), provenance: { source_commit: "fixture", content_hash: "b".repeat(64) }, nested: { z: [3, { b: 2, a: 1 }], a: "first" } })),
    contentEntry("AGENTS.md", "Instruction.\r\n"),
    contentEntry("package.json", "{\"name\":\"hash-fixture\"}\r\n"),
    contentEntry("tsconfig.json", "{}\r"),
    contentEntry("src/index.ts", "export const value = 1;\r\n", 0o755),
    contentEntry("scripts/build", "regular file, included\r\n", 0o755),
    contentEntry("assets/image.bin", [0, 255, 13, 10, 0, 42]),
    contentEntry("references/text.txt", [255, 13, 10, 65]),
    contentEntry("references/café.txt", "Unicode path.\r\n"),
    contentEntry("README.md", "outside coverage"),
    contentEntry("build/output.txt", "excluded root"),
    contentEntry("src/node_modules/dependency.txt", "excluded nested"),
    contentEntry("assets/build/output.txt", "excluded nested build"),
    contentEntry("assets/.hidden", "excluded dotfile"),
  ];
}
