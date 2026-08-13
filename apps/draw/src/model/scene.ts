/**
 * Freehand scene helpers. A {@link DrawScene} is plain, renderer free data, so
 * these functions are pure: each returns a new scene rather than mutating its
 * argument. Element ids are generated with nanoid when omitted.
 */
import { nanoid } from "nanoid";
import type { DrawElement, DrawScene, SceneBounds, ScenePoint } from "../types/index.js";

export const SCENE_SCHEMA = "hasna.draw.scene";
export const SCENE_VERSION = 1 as const;

/** Create a new, empty scene. */
export function createScene(init: Partial<Pick<DrawScene, "background" | "width" | "height">> = {}): DrawScene {
  const scene: DrawScene = {
    schema: SCENE_SCHEMA,
    version: SCENE_VERSION,
    elements: [],
  };
  if (init.background !== undefined) scene.background = init.background;
  if (init.width !== undefined) scene.width = init.width;
  if (init.height !== undefined) scene.height = init.height;
  return scene;
}

/** Options accepted when adding a freehand stroke. */
export interface StrokeOptions {
  id?: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
  pressures?: number[];
}

/**
 * Append a freehand stroke (a "freedraw" element) built from absolute points.
 * The element origin is the top left of the point cloud and stored points are
 * made relative to that origin, matching the Excalidraw convention.
 */
export function addStroke(
  scene: DrawScene,
  points: ScenePoint[],
  options: StrokeOptions = {},
): DrawScene {
  if (points.length === 0) return { ...scene, elements: [...scene.elements] };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  const relative: ScenePoint[] = points.map(([px, py]) => [px - minX, py - minY]);
  const element: DrawElement = {
    id: options.id ?? nanoid(),
    type: "freedraw",
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: relative,
  };
  if (options.strokeColor !== undefined) element.strokeColor = options.strokeColor;
  if (options.strokeWidth !== undefined) element.strokeWidth = options.strokeWidth;
  if (options.opacity !== undefined) element.opacity = options.opacity;
  if (options.pressures !== undefined) element.pressures = options.pressures;
  return { ...scene, elements: [...scene.elements, element] };
}

/** Append an arbitrary element. A missing id is generated. */
export function addElement(
  scene: DrawScene,
  element: Omit<DrawElement, "id"> & { id?: string },
): DrawScene {
  const withId: DrawElement = { ...element, id: element.id ?? nanoid() };
  return { ...scene, elements: [...scene.elements, withId] };
}

/** Remove an element by id. Unknown ids are a no op. */
export function removeElement(scene: DrawScene, id: string): DrawScene {
  return { ...scene, elements: scene.elements.filter((el) => el.id !== id) };
}

/** Return a scene with no elements, preserving background and size. */
export function clearScene(scene: DrawScene): DrawScene {
  return { ...scene, elements: [] };
}

/**
 * Axis aligned bounding box of every element in the scene. Empty scenes return
 * a zero box at the origin.
 */
export function sceneBounds(scene: DrawScene): SceneBounds {
  if (scene.elements.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of scene.elements) {
    const x2 = el.x + (el.width ?? 0);
    const y2 = el.y + (el.height ?? 0);
    if (el.x < minX) minX = el.x;
    if (el.y < minY) minY = el.y;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
