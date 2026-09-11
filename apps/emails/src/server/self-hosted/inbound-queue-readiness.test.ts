import { expect, test } from "bun:test";
import { queueAllowsTopic } from "./inbound-queue-readiness.js";
const topic = [
    "arn",
    "aws",
    "sns",
    "fixture-region",
    "fixture-account",
    "topic",
  ].join(":"),
  queue = [
    "arn",
    "aws",
    "sqs",
    "fixture-region",
    "fixture-account",
    "queue",
  ].join(":");
const statement = () => ({
  Effect: "Allow",
  Principal: { Service: "sns.amazonaws.com" },
  Action: "SQS:SendMessage",
  Resource: queue,
  Condition: { ArnEquals: { "aws:SourceArn": topic } },
});
test("queue policy must explicitly allow the configured SES topic to publish to this exact queue", () => {
  expect(
    queueAllowsTopic(
      JSON.stringify({ Statement: [statement()] }),
      queue,
      topic,
    ),
  ).toBe(true);
  for (const patch of [
    { Resource: "different-queue" },
    { Principal: { Service: "other.amazonaws.com" } },
    { Condition: {} },
    { Condition: { ArnLike: { "aws:SourceArn": "*" } } },
    { Effect: "Deny" },
  ])
    expect(
      queueAllowsTopic(
        JSON.stringify({ Statement: [{ ...statement(), ...patch }] }),
        queue,
        topic,
      ),
    ).toBe(false);
});
test("malformed, denied, and unsupported conditional queue policies stay unverified", () => {
  expect(queueAllowsTopic("not-json", queue, topic)).toBe(false);
  expect(
    queueAllowsTopic(
      JSON.stringify({ Statement: [statement(), { Effect: "Deny" }] }),
      queue,
      topic,
    ),
  ).toBe(false);
  expect(
    queueAllowsTopic(
      JSON.stringify({
        Statement: [
          {
            ...statement(),
            Condition: {
              ...statement().Condition,
              IpAddress: { "aws:SourceIp": "127.0.0.1" },
            },
          },
        ],
      }),
      queue,
      topic,
    ),
  ).toBe(false);
});
