import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RemoteSkillsAuthClient } from "./remote-auth.js";
import { InvitationEmailInputError, RemoteInvitationEmailError, RemoteInvitationEmailUnconfirmedError, type RequestInvitationEmailChallenge, type AcceptInvitationEmailChallenge } from "./remote-invitation-recovery.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
const token = "t".repeat(43), code = "918273";
const proof = () => ({ invitationId: randomUUID(), challengeId: randomUUID(), token, confirm: true as const });
type Call = { url: string; method: string; headers: Headers; body: Record<string, unknown> };
async function fixture(run: (client: RemoteSkillsAuthClient, calls: Call[], reply: (body: unknown, status?: number, raw?: boolean) => void) => Promise<void>) {
  const calls: Call[] = [];
  let response: { body: unknown; status: number; raw: boolean } | undefined;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as Record<string, unknown>;
    calls.push({ url: request.url, method: request.method, headers: request.headers, body });
    if (response) return response.raw ? new Response(String(response.body), { status: response.status }) : Response.json(response.body, { status: response.status });
    return new URL(request.url).pathname.endsWith("email-challenge")
      ? Response.json({ challengeId: body.challengeId, message: "Eligibility is unknown", expiresIn: 600, token, code }, { status: 202 })
      : Response.json({ organizationId: randomUUID(), membershipId: randomUUID(), accepted: true, changed: true, signInRequired: true, token, code });
  } });
  try { await run(new RemoteSkillsAuthClient(server.url.origin + "/prefix/api/v1"), calls, (body, status = 200, raw = false) => { response = { body, status, raw }; }); }
  finally { server.stop(true); }
}
function safe(value: unknown) { const text = JSON.stringify(value); expect(text).not.toContain(token); expect(text).not.toContain(code); }

test("anonymous recovery sends exactly one bound proof POST and projects no credentials", async () => fixture(async (client, calls) => {
  const input = proof(), first = await client.requestInvitationEmailChallenge(input);
  expect(first).toEqual({ challengeId: input.challengeId, message: "If this invitation is eligible, a verification code will arrive. Delivery is not confirmed.", expiresIn: 600 }); safe(first);
  const accepted = await client.acceptInvitationEmailChallenge({ ...input, code });
  expect(accepted).toEqual({ organizationId: expect.any(String), membershipId: expect.any(String), accepted: true, changed: true, signInRequired: true }); safe(accepted);
  expect(calls).toHaveLength(2);
  for (const [i, call] of calls.entries()) {
    expect(new URL(call.url).pathname).toBe(`/prefix/api/v1/account/invitations/email-${i ? "accept" : "challenge"}`);
    expect(new URL(call.url).search).toBe(""); expect(call.method).toBe("POST");
    for (const header of ["authorization", "cookie", "origin", "referer"]) expect(call.headers.has(header)).toBe(false);
    expect(call.body).toEqual({ invitationId: input.invitationId, challengeId: input.challengeId, token, ...(i ? { code } : {}) });
  }
}));

test("caller identity and proof are captured before asynchronous work; no challenge replacement", async () => fixture(async (client, calls) => {
  const input = { ...proof(), code }, original = { ...input };
  const pending = client.acceptInvitationEmailChallenge(input);
  input.invitationId = randomUUID(); input.challengeId = randomUUID(); input.token = "z".repeat(43); input.code = "000000";
  await pending;
  expect(calls).toHaveLength(1); expect(calls[0].body).toEqual({ invitationId: original.invitationId, challengeId: original.challengeId, token, code });
}));

test("invalid proof shapes refuse before any request", async () => fixture(async (client, calls) => {
  const input = proof();
  for (const patch of [{ confirm: false }, { confirm: undefined }, { invitationId: "BAD" }, { challengeId: [] }, { token: token + "x" }, { token: [token] }, { extra: true }]) {
    await expect(client.requestInvitationEmailChallenge({ ...input, ...patch } as RequestInvitationEmailChallenge)).rejects.toBeInstanceOf(InvitationEmailInputError);
    await expect(client.acceptInvitationEmailChallenge({ ...input, code, ...patch } as AcceptInvitationEmailChallenge)).rejects.toBeInstanceOf(InvitationEmailInputError);
  }
  for (const bad of ["12345", "1234567", " 123456", [code], 123456]) await expect(client.acceptInvitationEmailChallenge({ ...input, code: bad } as AcceptInvitationEmailChallenge)).rejects.toBeInstanceOf(InvitationEmailInputError);
  expect(calls).toHaveLength(0);
}));

test("fixed known refusals are bounded, sanitized, and never replayed", async () => fixture(async (client, calls, reply) => {
  const refusals = { INVALID_REQUEST: 400, ORIGIN_REQUIRED: 403, INVITATION_PROOF_UNAVAILABLE: 401, RATE_LIMITED: 429, INVITATION_BUSY: 503, INVITATION_DELIVERY_UNAVAILABLE: 503 } as const;
  for (const [name, status] of Object.entries(refusals)) for (const action of ["challenge", "accept"] as const) {
    const before = calls.length; reply({ code: name, error: token, detail: code }, status);
    try { if (action === "challenge") await client.requestInvitationEmailChallenge(proof()); else await client.acceptInvitationEmailChallenge({ ...proof(), code }); throw Error("expected refusal"); }
    catch (error) { expect(error).toBeInstanceOf(RemoteInvitationEmailError); expect((error as RemoteInvitationEmailError).code).toBe(name as RemoteInvitationEmailError["code"]); safe(error); expect((error as Error).message).not.toContain(token); }
    expect(calls.length - before).toBe(1);
  }
}));

test("malformed, oversized, mismatched and lost responses remain unconfirmed without retry", async () => fixture(async (client, calls, reply) => {
  const input = proof();
  const challenge = { challengeId: input.challengeId, message: "Conditional", expiresIn: 600 };
  for (const body of [null, [], { ...challenge, challengeId: randomUUID() }, { ...challenge, expiresIn: "600" }, { ...challenge, message: ["conditional"] }, { ...challenge, message: "x".repeat(257) }, { ...challenge, padding: "x".repeat(5000) }]) {
    const before = calls.length; reply(body, 202); await expect(client.requestInvitationEmailChallenge(input)).rejects.toBeInstanceOf(RemoteInvitationEmailUnconfirmedError); expect(calls.length - before).toBe(1);
  }
  const accepted = { organizationId: randomUUID(), membershipId: randomUUID(), accepted: true, changed: true, signInRequired: true };
  for (const body of [{ ...accepted, signInRequired: false }, { ...accepted, changed: false }, { ...accepted, accepted: [true] }, { ...accepted, membershipId: 1 }, { code: "INVITATION_PROOF_UNAVAILABLE", error: token }, { ...accepted, pad: "x".repeat(5000) }]) {
    const before = calls.length; reply(body); await expect(client.acceptInvitationEmailChallenge({ ...input, code })).rejects.toBeInstanceOf(RemoteInvitationEmailUnconfirmedError); expect(calls.length - before).toBe(1);
  }
  reply("{broken " + token, 200, true); await expect(client.acceptInvitationEmailChallenge({ ...input, code })).rejects.toBeInstanceOf(RemoteInvitationEmailUnconfirmedError);
}));

test("redirect and connection loss cannot disclose proof or trigger a second request", async () => {
  let redirects = 0, destination = 0;
  const sink = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { destination++; return Response.json({}); } });
  const origin = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { redirects++; return new Response(null, { status: 307, headers: { Location: sink.url.origin } }); } });
  try {
    const client = new RemoteSkillsAuthClient(origin.url.origin);
    await expect(client.requestInvitationEmailChallenge(proof())).rejects.toBeInstanceOf(RemoteInvitationEmailUnconfirmedError);
    expect(redirects).toBe(1); expect(destination).toBe(0);
    origin.stop(true);
    await expect(client.acceptInvitationEmailChallenge({ ...proof(), code })).rejects.toBeInstanceOf(RemoteInvitationEmailUnconfirmedError);
    expect(redirects).toBe(1); expect(destination).toBe(0);
  } finally { origin.stop(true); sink.stop(true); }
});
