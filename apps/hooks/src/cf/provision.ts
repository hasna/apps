/**
 * Cloudflare resource provisioning for the hooks registry (`hooks cf deploy`).
 *
 * Provisions D1 database + R2 bucket through the Cloudflare API. Worker upload
 * requires wrangler (workerd target); this module prints the exact wrangler
 * commands instead of shipping a token-bearing upload path.
 */

const CF_API = "https://api.cloudflare.com/client/v4";

export interface ProvisionOptions {
  token: string;
  accountId: string;
  databaseName: string;
  bucketName: string;
  dryRun: boolean;
  fetchFn?: typeof fetch;
}

export interface ProvisionResult {
  d1DatabaseId: string | null;
  d1Created: boolean;
  d1Exists: boolean;
  r2BucketExists: boolean;
  r2Created: boolean;
  commands: string[];
}

async function cfFetch(fetchFn: typeof fetch, token: string, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetchFn(`${CF_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

export async function provisionCloudflareResources(options: ProvisionOptions): Promise<ProvisionResult> {
  const { token, accountId, databaseName, bucketName, dryRun, fetchFn = fetch } = options;
  const result: ProvisionResult = {
    d1DatabaseId: null,
    d1Created: false,
    d1Exists: false,
    r2BucketExists: false,
    r2Created: false,
    commands: [],
  };

  if (dryRun) {
    result.commands = [
      `POST ${CF_API}/accounts/${accountId}/d1/database {"name": "${databaseName}"} (if missing)`,
      `PUT ${CF_API}/accounts/${accountId}/r2/buckets/${bucketName} (if missing)`,
      `wrangler d1 migrations apply ${databaseName} --remote`,
      `wrangler deploy --config wrangler.toml`,
    ];
    return result;
  }

  const d1List = await cfFetch(fetchFn, token, `/accounts/${accountId}/d1/database?name=${encodeURIComponent(databaseName)}`);
  if (!d1List.ok) {
    throw new Error(`failed to list D1 databases (${d1List.status})`);
  }
  const d1Rows = (d1List.data as { result?: Array<{ id: string }> })?.result ?? [];
  if (d1Rows.length > 0) {
    result.d1Exists = true;
    result.d1DatabaseId = d1Rows[0].id;
  } else {
    const created = await cfFetch(fetchFn, token, `/accounts/${accountId}/d1/database`, {
      method: "POST",
      body: JSON.stringify({ name: databaseName }),
    });
    if (!created.ok) {
      throw new Error(`failed to create D1 database '${databaseName}' (${created.status})`);
    }
    result.d1Created = true;
    result.d1DatabaseId = (created.data as { result?: { id: string } })?.result?.id ?? null;
  }

  const r2List = await cfFetch(fetchFn, token, `/accounts/${accountId}/r2/buckets`);
  if (!r2List.ok) {
    throw new Error(`failed to list R2 buckets (${r2List.status})`);
  }
  const bucketNames = ((r2List.data as { result?: { buckets?: Array<{ name: string }> } })?.result?.buckets ?? []).map((b) => b.name);
  if (bucketNames.includes(bucketName)) {
    result.r2BucketExists = true;
  } else {
    const created = await cfFetch(fetchFn, token, `/accounts/${accountId}/r2/buckets/${bucketName}`, {
      method: "PUT",
      body: JSON.stringify({ name: bucketName }),
    });
    if (!created.ok) {
      throw new Error(`failed to create R2 bucket '${bucketName}' (${created.status})`);
    }
    result.r2Created = true;
  }

  result.commands = [
    `wrangler d1 migrations apply ${databaseName} --remote`,
    `wrangler secret put HOOKS_API_KEY`,
    `wrangler deploy --config wrangler.toml`,
  ];
  return result;
}
