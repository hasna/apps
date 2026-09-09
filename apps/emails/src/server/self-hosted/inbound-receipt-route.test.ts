import { expect, test } from "bun:test";
import type { ReceiptRule } from "@aws-sdk/client-ses";
import { evaluateInboundReceiptRoute } from "./inbound-receipt-route.js";
const delivery: ReceiptRule = {
  Name: "delivery",
  Enabled: true,
  Recipients: ["example.test"],
  Actions: [{ S3Action: { BucketName: "fixture", TopicArn: "fixture-topic" } }],
};
const check = (
  rules: ReceiptRule[],
  mailbox: string | undefined = "user@example.test",
  domain = "example.test",
) => evaluateInboundReceiptRoute(rules, domain, "fixture", mailbox);
test("mailbox-specific earlier bounce or stop shadows a later domain delivery rule", () => {
  for (const action of [
    { StopAction: { Scope: "RuleSet" as const } },
    {
      BounceAction: {
        SmtpReplyCode: "550",
        Message: "unavailable",
        Sender: "postmaster@example.test",
      },
    },
  ]) {
    const prior = {
      Name: "stop",
      Enabled: true,
      Recipients: ["user@example.test"],
      Actions: [action],
    };
    expect(check([prior, delivery]).ready).toBe(false);
    expect(check([prior, delivery], "other@example.test").ready).toBe(true);
    expect(
      evaluateInboundReceiptRoute([prior, delivery], "example.test", "fixture")
        .ready,
    ).toBe(false);
  }
});
test("an exact mailbox S3 rule proves only that mailbox, including SES label matching", () => {
  const rule = { ...delivery, Recipients: ["user@example.test"] };
  expect(check([rule]).ready).toBe(true);
  expect(check([rule], "user+tag@example.test").ready).toBe(true);
  expect(check([rule], "other@example.test").ready).toBe(false);
  expect(
    evaluateInboundReceiptRoute([rule], "example.test", "fixture").ready,
  ).toBe(false);
  expect(
    check(
      [{ ...rule, Recipients: ["user+tag@example.test"] }],
      "user+other@example.test",
    ).ready,
  ).toBe(false);
});
test("domain conditions distinguish exact domains, subdomains and catch-all", () => {
  expect(
    check([delivery], "user@sub.example.test", "sub.example.test").ready,
  ).toBe(false);
  expect(
    check(
      [{ ...delivery, Recipients: [".example.test"] }],
      "user@sub.example.test",
      "sub.example.test",
    ).ready,
  ).toBe(true);
  expect(check([{ ...delivery, Recipients: [".example.test"] }]).ready).toBe(
    false,
  );
  expect(
    check([{ ...delivery, Recipients: [] }], "user@other.test", "other.test")
      .ready,
  ).toBe(true);
  expect(check([delivery], "user@other.test").ready).toBe(false);
  expect(check([{ ...delivery, Enabled: false }]).ready).toBe(false);
});
test("only earlier matching actions can obstruct a checked S3 route", () => {
  const stop: ReceiptRule = {
    Name: "stop",
    Enabled: true,
    Recipients: ["user@example.test"],
    Actions: [{ StopAction: { Scope: "RuleSet" } }],
  };
  expect(check([delivery, stop]).ready).toBe(true);
  expect(check([{ ...stop, Enabled: false }, delivery]).ready).toBe(true);
  expect(
    check([
      {
        ...stop,
        Recipients: ["user@example.test"],
        Actions: [
          {
            LambdaAction: {
              FunctionArn: "fixture",
              InvocationType: "RequestResponse",
            },
          },
        ],
      },
      delivery,
    ]).ready,
  ).toBe(false);
  expect(
    check([
      {
        ...stop,
        Recipients: ["user@example.test"],
        Actions: [
          { LambdaAction: { FunctionArn: "fixture", InvocationType: "Event" } },
        ],
      },
      delivery,
    ]).ready,
  ).toBe(true);
});
