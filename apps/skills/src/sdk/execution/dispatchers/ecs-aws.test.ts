import { expect, test } from "bun:test";
import { RunTaskCommand, ListTasksCommand, DescribeTasksCommand, StopTaskCommand } from "@aws-sdk/client-ecs";
import { createAwsEcsClient, type EcsCommandTransport, type EcsRunTaskInput } from "./ecs.js";
const input: EcsRunTaskInput = { cluster: "owned-cluster", taskDefinition: "owned-definition", containerName: "runner", clientToken: "owned-token", startedBy: "owned-start", launchType: "FARGATE", cpu: "256", memory: "512", subnets: ["owned-subnet"], securityGroups: ["owned-group"], environment: [] };
function owned(replies: unknown[]) {
  const commands: Parameters<EcsCommandTransport["send"]>[0][] = [];
  const transport: EcsCommandTransport = { async send(command) { commands.push(command); if (!replies.length) throw Error("No owned response"); const reply = replies.shift(); if (reply instanceof Error) throw reply; return reply; } };
  return { commands, transport };
}

test("actual AWS commands bind launch, every list page, describe and stop to one explicit cluster", async () => {
  const f = owned([{ tasks: [{ taskArn: "owned-task" }] }, { taskArns: ["owned-task"], nextToken: "page2" }, { taskArns: ["second-task"] }, { tasks: [{ taskArn: "owned-task", lastStatus: "RUNNING" }] }, { task: { taskArn: "owned-task", lastStatus: "STOPPING" } }]);
  const client = createAwsEcsClient("us-east-1", { cluster: input.cluster, transport: f.transport });
  expect(await client.runTask(input)).toEqual({ taskArn: "owned-task" });
  expect(await client.listTasksByStartedBy(input.startedBy)).toEqual(["owned-task", "second-task"]);
  expect((await client.describeTasks(["owned-task"]))[0]?.lastStatus).toBe("RUNNING");
  await client.stopTask("owned-task");
  expect(f.commands.map(c => c.input.cluster)).toEqual(Array(5).fill(input.cluster));
  expect(f.commands[0]).toBeInstanceOf(RunTaskCommand); expect(f.commands[1]).toBeInstanceOf(ListTasksCommand);
  expect(f.commands[2]).toBeInstanceOf(ListTasksCommand); expect((f.commands[2] as ListTasksCommand).input.nextToken).toBe("page2");
  expect(f.commands[3]).toBeInstanceOf(DescribeTasksCommand); expect(f.commands[4]).toBeInstanceOf(StopTaskCommand);
  expect((f.commands[4] as StopTaskCommand).input.task).toBe("owned-task");
});

test("legacy factory binds its first launch cluster and refuses later cluster changes", async () => {
  const f = owned([{ tasks: [{ taskArn: "owned-task" }] }, { taskArns: [] }]);
  const client = createAwsEcsClient("us-east-1", { transport: f.transport });
  await client.runTask(input); await client.listTasksByStartedBy(input.startedBy);
  expect(f.commands.map(c => c.input.cluster)).toEqual([input.cluster, input.cluster]);
  await expect(client.runTask({ ...input, cluster: "different-cluster" })).rejects.toThrow("binding changed");
  expect(f.commands).toHaveLength(2);
});

test("read-first legacy factory keeps explicit default cluster compatibility", async () => {
  const f = owned([{ taskArns: [] }]); const client = createAwsEcsClient("us-east-1", { transport: f.transport });
  await client.listTasksByStartedBy(input.startedBy); expect(f.commands[0]?.input.cluster).toBe("default");
});

for (const reply of [{}, { tasks: [] }, { tasks: [{ taskArn: "owned-task" }], failures: [{ reason: "owned" }] }, { tasks: [{ taskArn: "one" }, { taskArn: "two" }] }]) {
  test("partial or failed RunTask response is never a confirmed launch", async () => {
    const f = owned([reply]); const client = createAwsEcsClient("us-east-1", { cluster: input.cluster, transport: f.transport });
    await expect(client.runTask(input)).rejects.toThrow();
  });
}
for (const reply of [{}, { tasks: [] }, { tasks: [{ taskArn: "wrong-task", lastStatus: "STOPPED" }] }, { tasks: [{ taskArn: "owned-task", lastStatus: "STOPPED" }], failures: [{ arn: "owned-task", reason: "MISSING" }] }]) {
  test("partial, failed or unrelated DescribeTasks response is rejected", async () => {
    const f = owned([reply]); const client = createAwsEcsClient("us-east-1", { cluster: input.cluster, transport: f.transport });
    await expect(client.describeTasks(["owned-task"])).rejects.toThrow();
  });
}
for (const reply of [{}, { task: { taskArn: "wrong-task", lastStatus: "STOPPED" } }, { task: { taskArn: "owned-task" } }]) {
  test("StopTask requires the matching task response", async () => {
    const f = owned([reply]); const client = createAwsEcsClient("us-east-1", { cluster: input.cluster, transport: f.transport });
    await expect(client.stopTask("owned-task")).rejects.toThrow();
  });
}
for (const replies of [
  [{ taskArns: ["owned-task"], nextToken: "p2" }, new Error("owned page loss")],
  [{ taskArns: ["owned-task"], nextToken: "p2" }, { taskArns: [], nextToken: "p2" }],
  [{ taskArns: ["owned-task"], nextToken: "p2" }, { taskArns: ["owned-task"] }],
  [{ nextToken: "p2" }],
  Array.from({ length: 20 }, (_, i) => ({ taskArns: [], nextToken: `page-${i}` })),
]) {
  test("incomplete pagination never returns a convenient partial task list", async () => {
    const f = owned(replies); const client = createAwsEcsClient("us-east-1", { cluster: input.cluster, transport: f.transport });
    await expect(client.listTasksByStartedBy(input.startedBy)).rejects.toThrow();
    expect(f.commands.length).toBeLessThanOrEqual(20);
  });
}
