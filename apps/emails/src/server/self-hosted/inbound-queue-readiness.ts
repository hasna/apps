import type { Provider } from "../../types/index.js";
import { resolveSesCredentials } from "../../providers/ses.js";

const values = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
/** Conservative configured-route evidence, not a promise of future delivery or worker liveness. */
export function queueAllowsTopic(
  policy: string | undefined,
  queueArn: string,
  topicArn: string,
): boolean {
  try {
    const parsed = JSON.parse(policy ?? "{}") as { Statement?: any[] };
    if (!Array.isArray(parsed.Statement)) return false;
    if (parsed.Statement.some((row) => row.Effect === "Deny")) return false;
    return parsed.Statement.some((row) => {
      if (
        row.Effect !== "Allow" ||
        !values(row.Principal?.Service).includes("sns.amazonaws.com") ||
        !values(row.Action).some(
          (action) => action.toLowerCase() === "sqs:sendmessage",
        ) ||
        !values(row.Resource).includes(queueArn)
      )
        return false;
      const conditions = Object.entries(row.Condition ?? {}).flatMap(
        ([operator, fields]) =>
          Object.entries(fields as object).map(([key, value]) => ({
            operator,
            key: key.toLowerCase(),
            value,
          })),
      );
      return (
        conditions.some(
          (c) =>
            ["ArnEquals", "ArnLike"].includes(c.operator) &&
            c.key === "aws:sourcearn" &&
            c.value === topicArn,
        ) &&
        conditions.every(
          (c) =>
            (["ArnEquals", "ArnLike"].includes(c.operator) &&
              c.key === "aws:sourcearn" &&
              c.value === topicArn) ||
            (c.operator === "StringEquals" &&
              c.key === "aws:sourceaccount" &&
              c.value === topicArn.split(":")[4]),
        )
      );
    });
  } catch {
    return false;
  }
}
export async function checkInboundQueue(
  provider: Provider,
  topicArn: string,
  queueUrl: string,
): Promise<{ ready: boolean; reason: string }> {
  const [
    { SQSClient, GetQueueAttributesCommand },
    {
      SNSClient,
      ListSubscriptionsByTopicCommand,
      GetSubscriptionAttributesCommand,
    },
  ] = await Promise.all([
    import("@aws-sdk/client-sqs"),
    import("@aws-sdk/client-sns"),
  ]);
  const credentials = resolveSesCredentials(provider).credentials;
  const config = {
    region: provider.region ?? undefined,
    ...(credentials ? { credentials } : {}),
  };
  const sqs = new SQSClient(config),
    sns = new SNSClient(config);
  try {
    const queue = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ["QueueArn", "Policy"],
      }),
    );
    const queueArn = queue.Attributes?.QueueArn;
    if (
      !queueArn ||
      !queueAllowsTopic(queue.Attributes?.Policy, queueArn, topicArn)
    )
      return {
        ready: false,
        reason:
          "The ingest queue policy does not explicitly allow notifications from this SES receipt topic.",
      };
    let token: string | undefined;
    for (let page = 0; page < 100; page++) {
      const result = await sns.send(
        new ListSubscriptionsByTopicCommand({
          TopicArn: topicArn,
          NextToken: token,
        }),
      );
      for (const subscription of result.Subscriptions ?? []) {
        if (
          subscription.Protocol !== "sqs" ||
          subscription.Endpoint !== queueArn ||
          !subscription.SubscriptionArn?.startsWith("arn:")
        )
          continue;
        const attributes = await sns.send(
          new GetSubscriptionAttributesCommand({
            SubscriptionArn: subscription.SubscriptionArn,
          }),
        );
        const filters = JSON.parse(attributes.Attributes?.FilterPolicy ?? "{}");
        if (
          filters &&
          typeof filters === "object" &&
          !Array.isArray(filters) &&
          Object.keys(filters).length === 0
        )
          return {
            ready: true,
            reason:
              "Confirmed unfiltered SNS subscription reaches the configured ingest queue.",
          };
      }
      token = result.NextToken;
      if (!token) break;
    }
    return {
      ready: false,
      reason:
        "No confirmed unfiltered SNS subscription connects the receipt topic to the configured ingest queue.",
    };
  } finally {
    sqs.destroy();
    sns.destroy();
  }
}
