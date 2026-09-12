import { describe, expect, it } from "bun:test";
import { SQSClient, GetQueueAttributesCommand, type QueueAttributeName } from "@aws-sdk/client-sqs";
import {
  createIngestWorkerStatus, evaluateIngestLiveness, fetchIngestQueueAttributes,
  sampleQueueAgeOnce, startIngestProgressHealthServer,
} from "./ingest-worker.js";

// Exercise the real SDK serializer/deserializer with an owned in-memory HTTP
// handler. Its supported subset follows SQS GetQueueAttributes, not the worker.
function sqsFixture() {
  const requests: string[][] = [];
  const client = new SQSClient({
    region: "us-east-1", maxAttempts: 1,
    credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
    requestHandler: {
      async handle(request) {
        expect(request.headers["x-amz-target"]).toBe("AmazonSQS.GetQueueAttributes");
        const body = JSON.parse(String(request.body));
        const names = body.AttributeNames as string[];
        requests.push(names);
        const supported = names.length === 1 && names[0] === "ApproximateNumberOfMessages";
        return { response: {
          statusCode: supported ? 200 : 400,
          headers: { "content-type": "application/x-amz-json-1.0" },
          body: new TextEncoder().encode(JSON.stringify(supported
            ? { Attributes: { ApproximateNumberOfMessages: "17" } }
            : { __type: "InvalidAttributeName", message: "Unsupported queue attribute" })),
        } };
      },
    },
  });
  return { client, requests };
}

describe("ingest SQS request contract and unknown visibility", () => {
  it("real SDK requests the supported visibility attribute and rejects old metric names", async () => {
    const { client, requests } = sqsFixture();
    try {
      const attributes = await fetchIngestQueueAttributes(client, "https://sqs.us-east-1.amazonaws.com/000000000000/fixture");
      expect(attributes).toEqual({ ApproximateNumberOfMessages: "17" });
      expect(requests).toEqual([["ApproximateNumberOfMessages"]]);
      for (const invalid of ["ApproximateAgeOfOldestMessage", "ApproximateNumberOfMessagesVisible"]) {
        await expect(client.send(new GetQueueAttributesCommand({
          QueueUrl: "https://sqs.us-east-1.amazonaws.com/000000000000/fixture",
          AttributeNames: [invalid as QueueAttributeName], // Deliberately invalid control.
        }))).rejects.toMatchObject({ name: "InvalidAttributeName" });
      }
    } finally { client.destroy(); }
  });

  it("missing, malformed and unsafe counts stay unknown and cannot bless a stalled loop", async () => {
    for (const raw of [undefined, "", " ", "-1", "1.5", "NaN", "Infinity", "9007199254740992", "1e2", "00"]) {
      const status = createIngestWorkerStatus(1);
      status.queueVisible = 0; // Invalidate a previous successful empty sample.
      status.oldestMessageAgeSeconds = 12;
      await sampleQueueAgeOnce({ fetchAttributes: async () => raw === undefined ? {} : { ApproximateNumberOfMessages: raw } }, status, 900, () => {}, 600_000);
      expect(status.queueVisible).toBeNull();
      expect(status.oldestMessageAgeSeconds).toBeNull();
      expect(status.queueSampleFailures).toBe(1);
      const decision = evaluateIngestLiveness({
        staleMs: 60_000, lastProgressAt: () => 1,
        queueState: { lastSampleAt: () => status.lastQueueSampleMs, visible: () => status.queueVisible, sampleStaleAfterMs: 180_000 },
      }, 600_001);
      expect(decision).toMatchObject({ ok: false, reason: "queue_state_unknown" });
    }
  });

  it("accepts actual zero as empty but positive visibility as pending work", async () => {
    for (const raw of ["0", "42"]) {
      const status = createIngestWorkerStatus(1);
      await sampleQueueAgeOnce({ fetchAttributes: async () => ({ ApproximateNumberOfMessages: raw }) }, status, 900, () => {}, 600_000);
      expect(status.queueVisible).toBe(Number(raw));
      expect(status.oldestMessageAgeSeconds).toBeNull();
      expect(status.queueSampleFailures).toBe(0);
      expect(evaluateIngestLiveness({
        staleMs: 60_000, lastProgressAt: () => 1,
        queueState: { lastSampleAt: () => status.lastQueueSampleMs, visible: () => status.queueVisible, sampleStaleAfterMs: 180_000 },
      }, 600_001)).toMatchObject({ ok: raw === "0", reason: raw === "0" ? "stale_idle" : "stale_with_work" });
    }
  });

  it("serves503 for fresh-but-unknown visibility after progress stops", async () => {
    const server = startIngestProgressHealthServer({
      port: 0, staleMs: 60_000, lastProgressAt: () => Date.now() - 120_000,
      queueState: { lastSampleAt: () => Date.now(), visible: () => null, sampleStaleAfterMs: 180_000 },
    });
    try {
      expect((await fetch(`${server.url}/ready`)).status).toBe(503);
      expect(await (await fetch(`${server.url}/health`)).json()).toMatchObject({ ok: false, status: "queue_state_unknown", queue: { oldest_age_seconds: null, visible: null } });
    } finally { server.stop(); }
  });
});
