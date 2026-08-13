/**
 * Excalidraw interchange. This is the platform render bridge: the core never
 * imports Excalidraw itself, it just maps the normalized {@link DrawScene} to and
 * from the portable `.excalidraw` file shape so a real Excalidraw canvas can be
 * fed the same data.
 */
import type {
  DrawElement,
  DrawElementType,
  DrawScene,
  ExcalidrawElement,
  ExcalidrawFile,
  ScenePoint,
} from "../types/index.js";
import { createScene } from "../model/scene.js";

export const EXCALIDRAW_SOURCE = "@hasna/draw";

const KNOWN_TYPES: ReadonlySet<string> = new Set<DrawElementType>([
  "freedraw",
  "line",
  "arrow",
  "rectangle",
  "ellipse",
  "diamond",
  "text",
]);

/** Convert a normalized scene to an Excalidraw file envelope. */
export function toExcalidraw(scene: DrawScene): ExcalidrawFile {
  const elements: ExcalidrawElement[] = scene.elements.map((el) => {
    const out: ExcalidrawElement = {
      id: el.id,
      type: el.type,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
    };
    if (el.angle !== undefined) out.angle = el.angle;
    if (el.strokeColor !== undefined) out.strokeColor = el.strokeColor;
    if (el.backgroundColor !== undefined) out.backgroundColor = el.backgroundColor;
    if (el.fillStyle !== undefined) out.fillStyle = el.fillStyle;
    if (el.strokeWidth !== undefined) out.strokeWidth = el.strokeWidth;
    if (el.roughness !== undefined) out.roughness = el.roughness;
    if (el.opacity !== undefined) out.opacity = el.opacity;
    if (el.seed !== undefined) out.seed = el.seed;
    if (el.points !== undefined) out.points = el.points.map(([x, y]) => [x, y]);
    if (el.pressures !== undefined) out.pressures = [...el.pressures];
    if (el.text !== undefined) out.text = el.text;
    if (el.fontSize !== undefined) out.fontSize = el.fontSize;
    if (el.fontFamily !== undefined) out.fontFamily = el.fontFamily;
    return out;
  });
  return {
    type: "excalidraw",
    version: 2,
    source: EXCALIDRAW_SOURCE,
    elements,
    appState: { viewBackgroundColor: scene.background ?? "#ffffff" },
    files: {},
  };
}

function toPoints(raw: unknown): ScenePoint[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const points: ScenePoint[] = [];
  for (const p of raw) {
    if (Array.isArray(p) && p.length >= 2) {
      points.push([Number(p[0]) || 0, Number(p[1]) || 0]);
    }
  }
  return points;
}

function mapElement(raw: ExcalidrawElement, index: number): DrawElement | null {
  if (typeof raw.type !== "string" || !KNOWN_TYPES.has(raw.type)) return null;
  const el: DrawElement = {
    id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : `el-${index}`,
    type: raw.type as DrawElementType,
    x: typeof raw.x === "number" ? raw.x : 0,
    y: typeof raw.y === "number" ? raw.y : 0,
    width: typeof raw.width === "number" ? raw.width : 0,
    height: typeof raw.height === "number" ? raw.height : 0,
  };
  if (typeof raw.angle === "number") el.angle = raw.angle;
  if (typeof raw.strokeColor === "string") el.strokeColor = raw.strokeColor;
  if (typeof raw.backgroundColor === "string") el.backgroundColor = raw.backgroundColor;
  if (typeof raw.fillStyle === "string") el.fillStyle = raw.fillStyle as DrawElement["fillStyle"];
  if (typeof raw.strokeWidth === "number") el.strokeWidth = raw.strokeWidth;
  if (typeof raw.roughness === "number") el.roughness = raw.roughness;
  if (typeof raw.opacity === "number") el.opacity = raw.opacity;
  if (typeof raw.seed === "number") el.seed = raw.seed;
  const points = toPoints(raw.points);
  if (points) el.points = points;
  if (Array.isArray(raw.pressures)) {
    el.pressures = raw.pressures.filter((n): n is number => typeof n === "number");
  }
  if (typeof raw.text === "string") el.text = raw.text;
  if (typeof raw.fontSize === "number") el.fontSize = raw.fontSize;
  if (typeof raw.fontFamily === "number") el.fontFamily = raw.fontFamily;
  return el;
}

/**
 * Convert an Excalidraw file (or a bare elements array) into a normalized
 * scene, dropping unknown element types and fields.
 */
export function fromExcalidraw(input: string | ExcalidrawFile | unknown): DrawScene {
  let raw: unknown = input;
  if (typeof input === "string") {
    raw = JSON.parse(input);
  }
  const scene = createScene();
  if (typeof raw !== "object" || raw === null) return scene;
  const obj = raw as Record<string, unknown>;
  const rawElements = Array.isArray(obj.elements)
    ? obj.elements
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];
  rawElements.forEach((el, i) => {
    if (typeof el === "object" && el !== null) {
      const mapped = mapElement(el as ExcalidrawElement, i);
      if (mapped) scene.elements.push(mapped);
    }
  });
  const appState = obj.appState;
  if (appState && typeof appState === "object") {
    const bg = (appState as Record<string, unknown>).viewBackgroundColor;
    if (typeof bg === "string") scene.background = bg;
  }
  return scene;
}
