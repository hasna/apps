/** Disposable wire-level fixtures. Never forwards a request to another service. */
import { createHash, randomUUID } from "node:crypto";

type QueueMessage = { id: string; body: string; receipt: string; visibleAt: number; receives: number };
export type FixtureEvent = { operation: string; id?: string; status: number; bodySha256?: string };
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export class FixtureTransports {
  readonly events: FixtureEvent[] = [];
  readonly messages: QueueMessage[] = [];
  readonly objects = new Map<string, string>();
  readonly sends: Array<{ provider: "ses" | "resend"; id: string; body: unknown }> = [];
  readonly attempts: Array<{ provider: "ses" | "resend"; id: string; body: unknown; status: number }> = [];
  objectMode: "normal" | "fail" | "stall" = "normal";
  sendMode: "normal" | "reject" | "uncertain" = "normal";
  deleteFailures = 0;
  private stalled: Array<() => void> = [];

  constructor(readonly controlToken: string, readonly visibilityMs = 1200) {
    if (controlToken.length < 32 || !Number.isSafeInteger(visibilityMs) || visibilityMs < 100) {
      throw new Error("invalid synthetic fixture configuration");
    }
  }

  close() {
    for (const release of this.stalled.splice(0)) release();
  }

  private log(operation: string, status: number, id?: string, body?: string) {
    if (this.events.length >= 10000) throw new Error("fixture event limit");
    this.events.push({ operation, status, ...(id ? { id } : {}), ...(body ? { bodySha256: digest(body) } : {}) });
  }

  private json(value: unknown, status = 200) {
    return Response.json(value, { status });
  }

  private async input(request: Request): Promise<Record<string, any>> {
    const raw = await request.text();
    if (raw.length > 1024 * 1024) throw new Error("fixture request limit");
    const value = JSON.parse(raw || "{}");
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("fixture object required");
    return value;
  }

  private async control(request: Request, path: string) {
    if (request.headers.get("authorization") !== `Bearer ${this.controlToken}`) return this.json({}, 401);
    if (request.method === "GET" && path === "/control/state") {
      return this.json({ events: this.events, sends: this.sends, attempts: this.attempts, queue: this.messages.map(({ body, receipt, ...row }) => row) });
    }
    if (request.method !== "POST") return this.json({}, 405);
    const body = await this.input(request);
    if (path === "/control/enqueue") {
      if (this.messages.length >= 256) return this.json({}, 429);
      if (typeof body.body !== "string" || body.body.length > 256000) return this.json({}, 400);
      const id = randomUUID();
      this.messages.push({ id, body: body.body, receipt: randomUUID(), visibleAt: 0, receives: 0 });
      return this.json({ id });
    }
    if (path === "/control/object") {
      if (this.objects.size >= 256) return this.json({}, 429);
      if (typeof body.path !== "string" || !/^\/[a-z0-9-]+\/[a-zA-Z0-9/_.-]+$/.test(body.path)
        || typeof body.raw !== "string" || body.raw.length > 256000) return this.json({}, 400);
      this.objects.set(body.path, body.raw);
      return this.json({ stored: true });
    }
    if (path === "/control/mode") {
      if (body.object !== undefined) {
        if (!["normal", "fail", "stall"].includes(body.object)) return this.json({}, 400);
        this.objectMode = body.object;
        if (this.objectMode !== "stall") this.close();
      }
      if (body.send !== undefined) {
        if (!["normal", "reject", "uncertain"].includes(body.send)) return this.json({}, 400);
        this.sendMode = body.send;
      }
      if (body.deleteFailures !== undefined) {
        if (!Number.isSafeInteger(body.deleteFailures) || body.deleteFailures < 0 || body.deleteFailures > 3) return this.json({}, 400);
        this.deleteFailures = body.deleteFailures;
      }
      return this.json({ configured: true });
    }
    return this.json({}, 404);
  }

  private async sqs(request: Request, operation: string) {
    const body = await this.input(request);
    if (operation === "GetQueueAttributes") {
      const visible = this.messages.filter(row => row.visibleAt <= Date.now()).length;
      this.log("sqs.attributes", 200);
      return this.json({ Attributes: { ApproximateNumberOfMessages: String(visible) } });
    }
    if (operation === "ReceiveMessage") {
      // A short synthetic visibility interval makes redelivery deterministic;
      // the protocol fixture never claims to measure a managed queue's timing.
      let rows = this.messages.filter(row => row.visibleAt <= Date.now()).slice(0, 1);
      if (!rows.length) {
        await Bun.sleep(200);
        rows = this.messages.filter(row => row.visibleAt <= Date.now()).slice(0, 1);
      }
      for (const row of rows) {
        row.visibleAt = Date.now() + this.visibilityMs;
        row.receipt = randomUUID();
        row.receives++;
        this.log("sqs.receive", 200, row.id, row.body);
      }
      return this.json({ Messages: rows.map(row => ({ MessageId: row.id, Body: row.body,
        ReceiptHandle: row.receipt, MD5OfBody: createHash("md5").update(row.body).digest("hex") })) });
    }
    if (operation === "DeleteMessage") {
      const index = this.messages.findIndex(row => row.receipt === body.ReceiptHandle);
      if (index < 0) return this.json({ __type: "ReceiptHandleIsInvalid" }, 400);
      if (this.deleteFailures > 0) {
        this.deleteFailures--;
        this.log("sqs.delete", 500, this.messages[index]!.id);
        return this.json({ __type: "ServiceUnavailable", message: "synthetic delete failure" }, 500);
      }
      const [row] = this.messages.splice(index, 1);
      this.log("sqs.delete", 200, row!.id);
      return this.json({});
    }
    this.log("unexpected.sqs", 400);
    return this.json({ __type: "InvalidAction" }, 400);
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (path.startsWith("/control/")) return await this.control(request, path);
      const target = request.headers.get("x-amz-target");
      if (target?.startsWith("AmazonSQS.") && request.method === "POST") return await this.sqs(request, target.slice(10));
      if (request.method === "POST" && ["/v2/email/outbound-emails", "/emails"].includes(path)) {
        if (this.attempts.length >= 256) return this.json({}, 429);
        const provider = path === "/emails" ? "resend" : "ses";
        const body = await this.input(request);
        const status = this.sendMode === "reject" ? 400 : this.sendMode === "uncertain" ? 503 : 200;
        const id = `${provider}-${randomUUID()}`;
        this.attempts.push({ provider, id, body, status });
        this.log(`${provider}.send`, status, id, JSON.stringify(body));
        if (status === 400) return this.json({ name: "validation_error", message: "synthetic rejection", code: "MessageRejected" }, status);
        if (status === 503) return this.json({ message: "synthetic uncertain response" }, status);
        this.sends.push({ provider, id, body });
        return this.json(provider === "ses" ? { MessageId: id } : { id });
      }
      if (request.method === "GET" && path.startsWith("/emails/")) {
        const send = this.sends.find(row => row.provider === "resend" && path === `/emails/${row.id}`);
        this.log("resend.read", send ? 200 : 404);
        return send ? this.json({ id: send.id, message_id: `<${send.id}@fixture.test>`, last_event: "sent" }) : this.json({}, 404);
      }
      if (request.method === "GET" && this.objects.has(path)) {
        this.log("s3.get", this.objectMode === "fail" ? 500 : 200, path);
        if (this.objectMode === "stall") await new Promise<void>(resolve => this.stalled.push(resolve));
        if (this.objectMode === "fail") return new Response("<Error><Code>InternalError</Code></Error>", { status: 500 });
        return new Response(this.objects.get(path), { headers: { "content-type": "message/rfc822" } });
      }
      this.log("unexpected.request", 404);
      return this.json({}, 404);
    } catch {
      this.log("invalid.request", 400);
      return this.json({ error: "invalid synthetic fixture request" }, 400);
    }
  }
}

if (import.meta.main) {
  const token = process.env.PAIR_FIXTURE_CONTROL_TOKEN ?? "";
  const fixture = new FixtureTransports(token);
  const server = Bun.serve({ hostname: "0.0.0.0", port: 9000, fetch: request => fixture.fetch(request), idleTimeout: 120, maxRequestBodySize: 1024 * 1024 });
  let tls: ReturnType<typeof Bun.serve> | undefined;
  if (process.env.PAIR_FIXTURE_TLS_CERT && process.env.PAIR_FIXTURE_TLS_KEY) {
    tls = Bun.serve({ hostname: "0.0.0.0", port: 443, fetch: request => fixture.fetch(request), maxRequestBodySize: 1024 * 1024,
      tls: { cert: Bun.file(process.env.PAIR_FIXTURE_TLS_CERT), key: Bun.file(process.env.PAIR_FIXTURE_TLS_KEY) } });
  }
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { fixture.close(); server.stop(true); tls?.stop(true); process.exit(0); });
}
