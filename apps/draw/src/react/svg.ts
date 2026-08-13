/**
 * Pure, framework free helpers that project a renderer free {@link DrawScene}
 * onto SVG geometry. Shared by {@link DrawSurface} (both its editable surface
 * and its read only preview) and {@link Card}. Kept React free so it can be unit
 * tested without a DOM.
 */
import type { DrawElement, DrawScene, ScenePoint } from "../types/index.js";
import { sceneBounds } from "../model/scene.js";

/** Default stroke color; inherits the surrounding text color unless overridden. */
export const DEFAULT_STROKE = "currentColor";

/** Join truthy class name parts with a single space. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join(" ");
}

/** Round to 2 decimals to keep generated path strings compact. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Build an SVG path `d` string from points, offset by an element origin. */
export function pointsToPath(points: ScenePoint[], originX = 0, originY = 0): string {
  const first = points[0];
  if (!first) return "";
  let d = `M ${round(first[0] + originX)} ${round(first[1] + originY)}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    d += ` L ${round(p[0] + originX)} ${round(p[1] + originY)}`;
  }
  return d;
}

/**
 * A padded SVG `viewBox` string that fits every element in the scene. Empty
 * scenes fall back to the scene's declared width/height (or a 100x100 box).
 */
export function sceneViewBox(scene: DrawScene, padding = 8): string {
  const b = sceneBounds(scene);
  if (b.width === 0 && b.height === 0) {
    const w = scene.width ?? 100;
    const h = scene.height ?? 100;
    return `0 0 ${round(w)} ${round(h)}`;
  }
  const x = b.x - padding;
  const y = b.y - padding;
  const w = Math.max(b.width + padding * 2, 1);
  const h = Math.max(b.height + padding * 2, 1);
  return `${round(x)} ${round(y)} ${round(w)} ${round(h)}`;
}

/** The stroke color to render an element with, falling back when unset. */
export function strokeOf(el: DrawElement, fallback = DEFAULT_STROKE): string {
  return el.strokeColor ?? fallback;
}

/** The stroke width to render an element with, falling back when unset. */
export function strokeWidthOf(el: DrawElement, fallback = 2): number {
  return el.strokeWidth ?? fallback;
}

/** Element opacity as a 0..1 fraction (scene opacity is stored 0..100). */
export function opacityOf(el: DrawElement): number {
  if (el.opacity === undefined) return 1;
  return el.opacity > 1 ? el.opacity / 100 : el.opacity;
}

/** A serializable description of how to draw a single element as an SVG shape. */
export type SvgShape =
  | { kind: "path"; d: string }
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "polygon"; points: string }
  | { kind: "text"; x: number; y: number; text: string; fontSize: number };

/** Map a {@link DrawElement} to the SVG primitive that renders it. */
export function elementToShape(el: DrawElement): SvgShape {
  switch (el.type) {
    case "freedraw":
    case "line":
    case "arrow":
      return { kind: "path", d: pointsToPath(el.points ?? [], el.x, el.y) };
    case "ellipse":
      return {
        kind: "ellipse",
        cx: el.x + el.width / 2,
        cy: el.y + el.height / 2,
        rx: Math.max(el.width / 2, 0),
        ry: Math.max(el.height / 2, 0),
      };
    case "diamond": {
      const midX = el.x + el.width / 2;
      const midY = el.y + el.height / 2;
      const points = [
        `${midX},${el.y}`,
        `${el.x + el.width},${midY}`,
        `${midX},${el.y + el.height}`,
        `${el.x},${midY}`,
      ].join(" ");
      return { kind: "polygon", points };
    }
    case "text": {
      const fontSize = el.fontSize ?? 16;
      return { kind: "text", x: el.x, y: el.y + fontSize, text: el.text ?? "", fontSize };
    }
    case "rectangle":
    default:
      return { kind: "rect", x: el.x, y: el.y, width: el.width, height: el.height };
  }
}
