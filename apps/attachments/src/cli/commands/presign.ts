import { Command } from "commander";
import { getConfig, parseExpiryStrict } from "../../core/config";
import { resolveStore } from "../../core/store";
import { sha256File } from "../../core/artifact-keys";
import { formatExpiry, exitError } from "../utils";

// Presigned direct-to-S3 upload works on both backends: the store that holds
// the S3 credentials mints the PUT URL (the client's own config in local mode,
// the /v1 server in self_hosted/cloud mode), so the client needs none.

export function presignUploadCommand(): Command {
  const cmd = new Command("presign-upload")
    .description("Generate a presigned PUT URL for direct S3 upload")
    .argument("<filename>", "Filename for the upload (e.g. report.pdf)")
    .option("--expiry <time>", "URL expiry duration (e.g. 1h, 30m, 7d)", "1h")
    .option("--content-type <type>", "Content type for the upload")
    .action(async (filename: string, options) => {
      // Parse expiry
      let expiryMs: number | null;
      try {
        expiryMs = parseExpiryStrict(options.expiry as string).milliseconds;
      } catch (err) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
      if (expiryMs === null) {
        process.stderr.write(`Error: Presigned upload expiry cannot be never\n`);
        process.exit(1);
      }

      // Digest the local bytes so the request lands under the canonical
      // content-addressed key (a duplicate upload of identical bytes reuses
      // the same object) and the server can presign the PUT with the checksum
      // baked in — S3 then rejects any PUT whose bytes disagree.
      let sha256: string | undefined;
      try {
        sha256 = await sha256File(filename);
      } catch {
        sha256 = undefined;
      }

      const store = resolveStore();
      try {
        const result = await store.presignUpload(filename, options.contentType as string | undefined, expiryMs, sha256);
        process.stdout.write(`Upload URL: ${result.uploadUrl} (expires in ${options.expiry})\n`);
        process.stdout.write(`ID: ${result.id}\n`);
        process.stdout.write(`Finalize: attachments presign-complete ${result.id}\n`);
        if (sha256) {
          const checksumB64 = Buffer.from(sha256, "hex").toString("base64");
          process.stdout.write(
            `Usage: curl -X PUT -H "Content-Type: ${result.contentType}" -H "x-amz-checksum-sha256: ${checksumB64}" -T ${result.filename} "${result.uploadUrl}"\n`,
          );
        } else {
          process.stdout.write(`Usage: curl -X PUT -H "Content-Type: ${result.contentType}" -T ${result.filename} "${result.uploadUrl}"\n`);
        }
      } catch (err) {
        exitError(err instanceof Error ? err.message : String(err));
      } finally {
        store.close();
      }
    });

  return cmd;
}

export function presignCompleteCommand(): Command {
  const cmd = new Command("presign-complete")
    .description("Finalize a direct S3 upload created by presign-upload")
    .argument("<id>", "Pending attachment ID")
    .option("--expiry <time>", "Share link expiry duration (e.g. 7d, 24h, never)")
    .option("--password <password>", "Require a password before public download")
    .option("--max-downloads <count>", "Maximum successful downloads for the generated share link")
    .option("--link-type <type>", "Link type: presigned or server")
    .option("--format <format>", "Output format: human or json", "human")
    .option("--brief", "Only print the generated link")
    .action(async (id: string, options) => {
      const config = getConfig();

      const format = String(options.format ?? "human");
      if (!["human", "json"].includes(format)) {
        process.stderr.write("Error: --format must be one of: human, json\n");
        process.exit(1);
      }

      const linkType = (options.linkType ?? config.defaults.linkType) as "presigned" | "server";
      if (linkType !== "presigned" && linkType !== "server") {
        process.stderr.write("Error: --link-type must be one of: presigned, server\n");
        process.exit(1);
      }

      const maxDownloads = options.maxDownloads ? parseInt(options.maxDownloads as string, 10) : undefined;
      if (maxDownloads !== undefined && (!Number.isInteger(maxDownloads) || maxDownloads <= 0)) {
        process.stderr.write("Error: --max-downloads must be a positive integer\n");
        process.exit(1);
      }

      let expiryMs: number | null;
      try {
        expiryMs = parseExpiryStrict(options.expiry ?? config.defaults.expiry).milliseconds;
      } catch (err) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }

      const store = resolveStore();
      try {
        const { attachment, link, size } = await store.presignComplete(id, {
          expiryMs,
          password: options.password as string | undefined,
          maxDownloads,
          linkType,
        });
        const expiresAt = expiryMs !== null ? Date.now() + expiryMs : null;

        if (options.brief) {
          process.stdout.write(`${link}\n`);
        } else if (format === "json") {
          process.stdout.write(
            JSON.stringify({ id: attachment.id, filename: attachment.filename, size, link, expiresAt }, null, 2) + "\n"
          );
        } else {
          process.stdout.write(`ID:       ${attachment.id}\n`);
          process.stdout.write(`File:     ${attachment.filename}\n`);
          process.stdout.write(`Size:     ${size}\n`);
          process.stdout.write(`Link:     ${link}\n`);
          process.stdout.write(`Expiry:   ${formatExpiry(expiresAt)}\n`);
        }
      } catch (err) {
        exitError(err instanceof Error ? err.message : String(err));
      } finally {
        store.close();
      }
    });

  return cmd;
}

export function registerPresign(program: Command): void {
  program.addCommand(presignUploadCommand());
  program.addCommand(presignCompleteCommand());
}
