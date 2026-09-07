import { Command } from "commander";
import { getConfig, setConfig, parseExpiryStrict, CONFIG_PATH } from "../../core/config";
import { resolveStore } from "../../core/store";

export function configCommand(): Command {
  const cmd = new Command("config").description("Manage non-authoritative client preferences");
  cmd.command("show").action(() => {
    process.stdout.write(JSON.stringify({ path: CONFIG_PATH, defaults: getConfig().defaults }, null, 2) + "\n");
  });
  cmd.command("set")
    .option("--expiry <duration>")
    .option("--link-type <type>")
    .option("--bucket <bucket>", "S3 bucket for on-box presigned uploads (local transport)")
    .option("--region <region>", "S3 region for on-box presigned uploads (local transport)")
    .option("--access-key <key>", "S3 access key id (local transport; requires --secret-key)")
    .option("--secret-key <key>", "S3 secret access key (local transport; requires --access-key)")
    .option("--profile <name>", "Named AWS profile for on-box S3 (local transport)")
    .option("--endpoint <url>", "Custom S3-compatible endpoint (e.g. localstack)")
    .action((options) => {
      if (options.expiry) parseExpiryStrict(options.expiry);
      if (options.linkType && !["presigned", "server"].includes(options.linkType)) throw new Error("Invalid link type");
      if (options.bucket || options.region || options.accessKey || options.secretKey || options.profile || options.endpoint) {
        const bucket = options.bucket ?? getConfig().s3.bucket;
        const region = options.region ?? getConfig().s3.region;
        const accessKeyId = options.accessKey ?? getConfig().s3.accessKeyId;
        const secretAccessKey = options.secretKey ?? getConfig().s3.secretAccessKey;
        if (!bucket || !region) throw new Error("S3 configuration requires both --bucket and --region");
        if (!!accessKeyId !== !!secretAccessKey) throw new Error("--access-key and --secret-key must be provided together (or use --profile)");
        setConfig({
          s3: {
            bucket,
            region,
            accessKeyId,
            secretAccessKey,
            ...(options.profile ? { profile: options.profile } : {}),
            ...(options.endpoint ? { endpoint: options.endpoint } : {}),
          },
        });
      }
      setConfig({ defaults: { ...(options.expiry ? { expiry: options.expiry } : {}), ...(options.linkType ? { linkType: options.linkType } : {}) } });
    });
  cmd.command("test").action(async () => {
    const store = resolveStore();
    try {
      await store.list({ limit: 1 });
      process.stdout.write(`Attachments store reachable (${store.transport})\n`);
    } finally {
      store.close();
    }
  });
  return cmd;
}
