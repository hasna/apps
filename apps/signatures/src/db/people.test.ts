import { beforeEach, describe, expect, test } from "bun:test";

process.env["SIGNATURES_DB_PATH"] = ":memory:";

import { closeDatabase } from "./database.js";
import { createPerson, getPersonByEmail, listPeople } from "./people.js";

beforeEach(() => closeDatabase());

describe("people", () => {
  test("creates and finds a person by email", () => {
    const person = createPerson({ name: "Ada Lovelace", email: "ada@example.com", phone: "+1" });
    expect(person.id).toMatch(/^per-/);
    expect(getPersonByEmail("ada@example.com").name).toBe("Ada Lovelace");
  });

  test("lists people by query", () => {
    createPerson({ name: "Grace Hopper", email: "grace@example.com", company: "Navy" });
    createPerson({ name: "Katherine Johnson", email: "kj@example.com", company: "NASA" });
    expect(listPeople({ query: "NASA" }).map((p) => p.name)).toEqual(["Katherine Johnson"]);
  });

  test("creates and filters agent signers", () => {
    const agent = createPerson({
      name: "Sagan",
      signer_type: "agent",
      agent_id: "agent-sagan",
      agent_provider: "codewith",
      role: "Reviewer",
    });

    expect(agent.signer_type).toBe("agent");
    expect(agent.agent_id).toBe("agent-sagan");
    expect(listPeople({ signer_type: "agent" }).map((p) => p.agent_id)).toEqual(["agent-sagan"]);
  });
});
