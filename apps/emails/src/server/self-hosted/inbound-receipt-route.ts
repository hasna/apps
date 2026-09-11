import type { ReceiptRule } from "@aws-sdk/client-ses";

export function evaluateInboundReceiptRoute(
  rules: readonly ReceiptRule[],
  domain: string,
  bucket: string,
  mailbox?: string,
) {
  const targetDomain = domain.toLowerCase();
  const targetMailbox = mailbox?.toLowerCase();
  if (targetMailbox && targetMailbox.split("@")[1] !== targetDomain)
    return {
      ready: false,
      reason: "The mailbox does not belong to the checked domain.",
    };
  // SES exact-address conditions also match labels when the condition itself
  // has no label. A leading-dot domain condition matches subdomains only.
  // https://docs.aws.amazon.com/ses/latest/dg/receiving-email-receipt-rules-console-walkthrough.html
  const match = (raw: string): "all" | "some" | "none" => {
    const condition = raw.toLowerCase();
    if (!condition.includes("@"))
      return condition === targetDomain ||
        (condition.startsWith(".") && targetDomain.endsWith(condition))
        ? "all"
        : "none";
    const [local, host] = condition.split("@");
    if (host !== targetDomain) return "none";
    if (!targetMailbox) return "some";
    const targetLocal = targetMailbox.split("@")[0]!;
    return targetLocal === local ||
      (!local!.includes("+") && targetLocal.startsWith(`${local}+`))
      ? "all"
      : "none";
  };
  for (const rule of rules) {
    if (!rule.Enabled) continue;
    const recipients = rule.Recipients ?? [];
    const matches = recipients.map(match);
    const wholeTarget = recipients.length === 0 || matches.includes("all");
    if (!wholeTarget && !matches.includes("some")) continue;
    for (const action of rule.Actions ?? []) {
      // A mailbox-specific S3 action is not evidence for an entire domain.
      if (wholeTarget && action.S3Action?.BucketName === bucket)
        return {
          ready: true,
          reason:
            "Active SES receipt rule delivers this recipient to the configured ingest bucket.",
          objectKeyPrefix: action.S3Action.ObjectKeyPrefix ?? "",
          topicArn: action.S3Action.TopicArn,
        };
      if (action.StopAction || action.BounceAction)
        return {
          ready: false,
          reason:
            "An earlier SES receipt action stops mail before the ingest bucket.",
        };
      if (action.LambdaAction?.InvocationType === "RequestResponse")
        return {
          ready: false,
          reason:
            "An earlier synchronous receipt Lambda can stop routing; its outcome cannot be verified from configuration.",
        };
    }
  }
  return {
    ready: false,
    reason:
      "No active SES receipt rule routes this recipient to the configured ingest bucket.",
  };
}
