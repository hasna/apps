import { describe, expect, test, beforeEach } from "bun:test"
import { closeDatabase, resetDatabase } from "./database.js"

process.env["PROMPTS_DB_PATH"] = ":memory:"

import { createProject, getProject, listProjects, deleteProject } from "./projects.js"
import { ProjectNotFoundError } from "../types/index.js"

beforeEach(() => {
  closeDatabase()
  resetDatabase()
})

describe("createProject", () => {
  test("creates project with auto-generated id and slug", () => {
    const p = createProject({ name: "My Project" })
    expect(p.id).toMatch(/^proj-[a-z0-9]{8}$/)
    expect(p.slug).toBe("my-project")
    expect(p.name).toBe("My Project")
    expect(p.prompt_count).toBe(0)
  })

  test("stores description and path", () => {
    const p = createProject({ name: "With Meta", description: "desc", path: "/home/user/project" })
    expect(p.description).toBe("desc")
    expect(p.path).toBe("/home/user/project")
  })
})

describe("getProject", () => {
  test("returns null for unknown project", () => {
    expect(getProject("unknown")).toBeNull()
  })

  test("finds by id", () => {
    const created = createProject({ name: "Lookup Test" })
    const found = getProject(created.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.id)
  })

  test("finds by slug", () => {
    createProject({ name: "Slug Test" })
    const found = getProject("slug-test")
    expect(found).not.toBeNull()
    expect(found!.slug).toBe("slug-test")
  })

  test("finds by partial id prefix", () => {
    const created = createProject({ name: "Prefix Test" })
    const found = getProject(created.id.substring(0, 8))
    expect(found).not.toBeNull()
  })
})

describe("listProjects", () => {
  test("returns empty list when none exist", () => {
    expect(listProjects()).toHaveLength(0)
  })

  test("returns all projects", () => {
    createProject({ name: "Alpha" })
    createProject({ name: "Beta" })
    expect(listProjects()).toHaveLength(2)
  })

  test("orders by name", () => {
    createProject({ name: "Zebra" })
    createProject({ name: "Apple" })
    const projects = listProjects()
    expect(projects[0]!.name).toBe("Apple")
  })
})

describe("deleteProject", () => {
  test("throws ProjectNotFoundError for unknown id", () => {
    expect(() => deleteProject("ghost")).toThrow(ProjectNotFoundError)
  })

  test("deletes existing project", () => {
    const p = createProject({ name: "To Delete" })
    deleteProject(p.id)
    expect(getProject(p.id)).toBeNull()
  })
})
