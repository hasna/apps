import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerCryptoTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("encrypt_metadata_fields")) {
    server.tool(
      "encrypt_metadata_fields",
      "Encrypt sensitive fields in a metadata object using local key (TODOS_ENCRYPTION_KEY or key file).",
      { metadata: z.record(z.unknown()) },
      async ({ metadata }) => {
        try {
          const { encryptSensitiveFields } = await import("../../lib/local-encryption.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(encryptSensitiveFields(metadata), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("decrypt_metadata_fields")) {
    server.tool(
      "decrypt_metadata_fields",
      "Decrypt sensitive fields in a metadata object.",
      { metadata: z.record(z.unknown()) },
      async ({ metadata }) => {
        try {
          const { decryptSensitiveFields } = await import("../../lib/local-encryption.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(decryptSensitiveFields(metadata), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("apply_export_profile")) {
    server.tool(
      "apply_export_profile",
      "Apply secure export profile (redacted, encrypted, plaintext) to data bundle.",
      {
        data: z.record(z.unknown()),
        profile: z.enum(["redacted", "encrypted", "plaintext"]),
        acknowledge_plaintext: z.boolean().optional(),
      },
      async ({ data, profile, acknowledge_plaintext }) => {
        try {
          const { applyExportProfile } = await import("../../lib/local-encryption.js");
          const result = applyExportProfile(data, { profile, acknowledge_plaintext });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("crypto_status")) {
    server.tool(
      "crypto_status",
      "Show local encryption key status (never exposes key material).",
      {},
      async () => {
        try {
          const { getEncryptionKeySource } = await import("../../lib/local-encryption.js");
          const source = getEncryptionKeySource();
          return { content: [{ type: "text" as const, text: `Encryption key source: ${source}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
