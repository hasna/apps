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
});
