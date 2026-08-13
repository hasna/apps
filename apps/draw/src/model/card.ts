/**
 * Card factories and validation. A {@link Card} is either a text "note" or a
 * "drawing" backed by a {@link DrawScene}. Factories fill sensible defaults and
 * timestamps; {@link validateCard} coerces unknown JSON into a well formed card.
 */
import { nanoid } from "nanoid";
import type {
  AddDrawingInput,
  AddNoteInput,
  Card,
  CardColor,
  DrawElement,
  DrawScene,
} from "../types/index.js";
import { createScene } from "./scene.js";

/** The full Keep style color palette, as a readonly tuple. */
export const CARD_COLORS = [
  "default",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "gray",
] as const satisfies readonly CardColor[];

/** True when `value` is one of the known {@link CardColor} tokens. */
export function isCardColor(value: unknown): value is CardColor {
  return typeof value === "string" && (CARD_COLORS as readonly string[]).includes(value);
}

/** Build a note card from user input. */
export function note(input: AddNoteInput = {}): Card {
  const now = new Date().toISOString();
  const card: Card = {
    id: nanoid(),
    kind: "note",
    color: input.color && isCardColor(input.color) ? input.color : "default",
    labels: input.labels ? [...input.labels] : [],
    pinned: input.pinned ?? false,
    archived: false,
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
  if (input.title !== undefined) card.title = input.title;
  card.text = input.text ?? "";
  return card;
}

/** Build a drawing card from user input, defaulting to an empty scene. */
export function drawing(input: AddDrawingInput = {}): Card {
  const now = new Date().toISOString();
  const card: Card = {
    id: nanoid(),
    kind: "drawing",
    color: input.color && isCardColor(input.color) ? input.color : "default",
    labels: input.labels ? [...input.labels] : [],
    pinned: input.pinned ?? false,
    archived: false,
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
  if (input.title !== undefined) card.title = input.title;
  card.scene = input.scene ? cloneScene(input.scene) : createScene();
  return card;
}

/** A structural, throwing error used by {@link validateCard}. */
export class CardValidationError extends Error {
  constructor(message: string) {
    super(`Invalid card: ${message}`);
    this.name = "CardValidationError";
  }
}

function cloneScene(scene: DrawScene): DrawScene {
  return {
    ...scene,
    elements: scene.elements.map((el) => ({
      ...el,
      points: el.points ? el.points.map((p) => [p[0], p[1]] as [number, number]) : undefined,
      pressures: el.pressures ? [...el.pressures] : undefined,
    })),
  };
}

/** Deep copy a card so callers cannot mutate shared state. */
export function cloneCard(card: Card): Card {
  const copy: Card = {
    ...card,
    labels: [...card.labels],
  };
  if (card.scene) copy.scene = cloneScene(card.scene);
  return copy;
}

/**
 * Validate an unknown value as a {@link Card}, filling defaults for optional
 * fields and throwing on structurally invalid input.
 */
export function validateCard(value: unknown, index = 0): Card {
  if (typeof value !== "object" || value === null) {
    throw new CardValidationError(`card ${index} is not an object`);
  }
  const c = value as Record<string, unknown>;
  const kind: unknown = c.kind;
  if (kind !== "note" && kind !== "drawing") {
    throw new CardValidationError(`card ${index} has invalid kind`);
  }
  const now = new Date().toISOString();
  const card: Card = {
    id: typeof c.id === "string" && c.id.length > 0 ? c.id : nanoid(),
    kind,
    color: isCardColor(c.color) ? c.color : "default",
    labels: Array.isArray(c.labels) ? c.labels.filter((l): l is string => typeof l === "string") : [],
    pinned: c.pinned === true,
    archived: c.archived === true,
    order: typeof c.order === "number" && Number.isFinite(c.order) ? c.order : index,
    createdAt: typeof c.createdAt === "string" ? c.createdAt : now,
    updatedAt: typeof c.updatedAt === "string" ? c.updatedAt : now,
  };
  if (typeof c.title === "string") card.title = c.title;
  if (kind === "note") {
    card.text = typeof c.text === "string" ? c.text : "";
  } else {
    card.scene = validateScene(c.scene);
  }
  return card;
}

function validateScene(value: unknown): DrawScene {
  const scene = createScene();
  if (typeof value !== "object" || value === null) return scene;
  const s = value as Record<string, unknown>;
  if (typeof s.background === "string") scene.background = s.background;
  if (typeof s.width === "number") scene.width = s.width;
  if (typeof s.height === "number") scene.height = s.height;
  if (Array.isArray(s.elements)) {
    for (const raw of s.elements) {
      if (typeof raw !== "object" || raw === null) continue;
      const el = raw as Record<string, unknown>;
      if (typeof el.type !== "string") continue;
      scene.elements.push(validateElement(el));
    }
  }
  return scene;
}

/** Coerce one raw element into a full {@link DrawElement}, preserving every known field. */
function validateElement(el: Record<string, unknown>): DrawElement {
  const out: DrawElement = {
    id: typeof el.id === "string" && el.id.length > 0 ? el.id : nanoid(),
    type: el.type as DrawElement["type"],
    x: typeof el.x === "number" ? el.x : 0,
    y: typeof el.y === "number" ? el.y : 0,
    width: typeof el.width === "number" ? el.width : 0,
    height: typeof el.height === "number" ? el.height : 0,
  };
  if (typeof el.angle === "number") out.angle = el.angle;
  if (typeof el.strokeColor === "string") out.strokeColor = el.strokeColor;
  if (typeof el.backgroundColor === "string") out.backgroundColor = el.backgroundColor;
  if (typeof el.fillStyle === "string") out.fillStyle = el.fillStyle as DrawElement["fillStyle"];
  if (typeof el.strokeWidth === "number") out.strokeWidth = el.strokeWidth;
  if (typeof el.roughness === "number") out.roughness = el.roughness;
  if (typeof el.opacity === "number") out.opacity = el.opacity;
  if (typeof el.seed === "number") out.seed = el.seed;
  if (Array.isArray(el.points)) {
    out.points = (el.points as unknown[])
      .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2)
      .map((p) => [Number(p[0]) || 0, Number(p[1]) || 0] as [number, number]);
  }
  if (Array.isArray(el.pressures)) {
    out.pressures = el.pressures.filter((n): n is number => typeof n === "number");
  }
  if (typeof el.text === "string") out.text = el.text;
  if (typeof el.fontSize === "number") out.fontSize = el.fontSize;
  if (typeof el.fontFamily === "number") out.fontFamily = el.fontFamily;
  return out;
}
