import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { addDependency, buildTaskBoardSnapshot, createTask, createTaskBoard, exportTaskBoardBundle, importTaskBoardBundle, moveBoardCard } from "./tasks.js";
import { createPlan } from "./plans.js";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("local task boards", () => {
  it("builds task lanes with WIP limits plus blocked and ready badges", () => {
    const db = getDatabase();
    const blocker = createTask({ title: "blocking task", status: "pending" }, db);
    const ready = createTask({ title: "ready task", status: "pending", priority: "high" }, db);
    const blocked = createTask({ title: "blocked task", status: "pending" }, db);
    const doingA = createTask({ title: "doing a", status: "in_progress" }, db);
    const doingB = createTask({ title: "doing b", status: "in_progress" }, db);
    addDependency(blocked.id, blocker.id, db);

    const board = createTaskBoard({
      name: "local-flow",
      lanes: [
        { id: "ready", name: "Ready", statuses: ["pending"], wip_limit: null, position: 0 },
        { id: "doing", name: "Doing", statuses: ["in_progress"], wip_limit: 1, position: 1 },
      ],
    }, db);

    const snapshot = buildTaskBoardSnapshot(board.id, db);
    expect(snapshot.totals.cards).toBe(5);
    expect(snapshot.totals.blocked).toBe(1);
    expect(snapshot.totals.ready).toBe(2);
    expect(snapshot.totals.wip_exceeded_lanes).toBe(1);
    expect(snapshot.lanes[0]!.cards.find((card) => card.id === ready.id)!.badges).toContain("ready");
    expect(snapshot.lanes[0]!.cards.find((card) => card.id === blocked.id)!.badges).toContain("blocked");
    expect(snapshot.lanes[1]!.cards.map((card) => card.id)).toEqual(expect.arrayContaining([doingA.id, doingB.id]));
  });

  it("moves task and plan cards through board lanes", () => {
    const db = getDatabase();
    const task = createTask({ title: "move me", status: "pending" }, db);
    const taskBoard = createTaskBoard({ name: "task-board" }, db);

    const movedTask = moveBoardCard({ board_id: taskBoard.id, card_id: task.id.slice(0, 8), lane_id: "doing" }, db);
    expect(movedTask.status).toBe("in_progress");

    const plan = createPlan({ name: "plan move", status: "active" }, db);
    const planBoard = createTaskBoard({ name: "plan-board", scope: "plans" }, db);
    const movedPlan = moveBoardCard({ board_id: planBoard.id, card_id: plan.id.slice(0, 8), lane_id: "completed" }, db);
    expect(movedPlan.status).toBe("completed");
  });

  it("exports and imports board definitions without hosted state", () => {
    const db = getDatabase();
    const board = createTaskBoard({
      name: "portable",
      filters: { tags: ["oss"], include_archived: true },
    }, db);

    const bundle = exportTaskBoardBundle(board.id, db);
    expect(bundle.kind).toBe("hasna.todos.task-board");
    expect(bundle.boards).toHaveLength(1);

    resetDatabase();
    const fresh = getDatabase();
    const result = importTaskBoardBundle(bundle, fresh);
    expect(result.inserted).toBe(1);
    expect(buildTaskBoardSnapshot("portable", fresh).board.filters.tags).toEqual(["oss"]);
  });
});
