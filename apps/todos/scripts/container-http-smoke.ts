#!/usr/bin/env bun

const baseUrl = process.env.TODOS_V1_BASE_URL;
const token = process.env.TODOS_V1_TOKEN;
if (!baseUrl) throw new Error("TODOS_V1_BASE_URL is required");
if (!token) throw new Error("TODOS_V1_TOKEN is required");

const authHeaders = {
  "content-type": "application/json",
  "x-api-key": token,
};

async function expectStatus(path: string, status: number, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (response.status !== status) {
    const boundedBody = (await response.text()).slice(0, 512)
      .replace(/(postgres(?:ql)?:\/\/)[^@\s"]+@/gi, "$1[redacted]@")
      .replace(/("(?:token|password|secret|api_key)"\s*:\s*")[^"]*/gi, "$1[redacted]");
    throw new Error(
      `${init?.method ?? "GET"} ${path}: expected ${status}, got ${response.status}; body=${boundedBody}`,
    );
  }
  return response;
}

for (const path of ["/health", "/ready"]) {
  await expectStatus(path, 200);
}
const versionResponse = await expectStatus("/version", 200);
const versionPayload = (await versionResponse.json()) as { version?: string };
if (versionPayload.version !== "0.11.92") {
  throw new Error(`/version: expected 0.11.92, got ${versionPayload.version ?? "missing"}`);
}
await expectStatus("/v1/tasks", 401);

const taskResponse = await expectStatus("/v1/tasks", 201, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ title: `container-smoke-${Date.now()}`, priority: "high" }),
});
const task = (await taskResponse.json()) as { task?: { id?: string; version?: number } };
if (!task.task?.id) throw new Error("task create did not return an id");
await expectStatus(`/v1/tasks/${task.task.id}`, 200, { headers: authHeaders });
await expectStatus(`/v1/tasks/${task.task.id}`, 200, {
  method: "PATCH",
  headers: authHeaders,
  body: JSON.stringify({ status: "in_progress" }),
});
await expectStatus(`/v1/tasks/${task.task.id}`, 409, {
  method: "PATCH",
  headers: authHeaders,
  body: JSON.stringify({ status: "done", version: 1 }),
});
await expectStatus(`/v1/tasks/${task.task.id}`, 200, { method: "DELETE", headers: authHeaders });

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const projectName = `Container Smoke ${suffix}`;
const projectResponse = await expectStatus("/v1/projects", 201, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ name: projectName, path: `/tmp/${suffix}` }),
});
const project = (await projectResponse.json()) as { project?: { id?: string } };
if (!project.project?.id) throw new Error("project create did not return an id");
await expectStatus("/v1/projects", 200, { headers: authHeaders });
await expectStatus("/v1/projects", 409, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ name: projectName, path: `/tmp/${suffix}-duplicate` }),
});
await expectStatus(`/v1/projects/${project.project.id}/rename`, 200, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ new_slug: `container-smoke-renamed-${suffix}` }),
});
await expectStatus(`/v1/projects/${project.project.id}`, 200, {
  method: "DELETE",
  headers: authHeaders,
});

console.log("container HTTP/auth/CRUD/routing smoke: PASS");
