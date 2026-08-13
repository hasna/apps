/**
 * A lightweight, dependency free freehand draw surface. Pointer and touch input
 * is captured into "freedraw" strokes and emitted as a portable {@link DrawScene}
 * through `onChange`. Rendering is plain SVG, so there is no Excalidraw or heavy
 * canvas dependency; the same component doubles as a read only scene preview
 * (used by {@link Card}) when `readOnly` is set.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactElement } from "react";
import type { DrawElement, DrawScene, ScenePoint } from "../types/index.js";
import { addStroke, createScene } from "../model/scene.js";
import {
  cn,
  DEFAULT_STROKE,
  elementToShape,
  opacityOf,
  pointsToPath,
  sceneViewBox,
  strokeOf,
  strokeWidthOf,
} from "./svg.js";

export interface DrawSurfaceProps {
  /** The scene to render (source of truth). Defaults to an empty scene. */
  scene?: DrawScene;
  /** Called with a new scene after each completed stroke. */
  onChange?: (scene: DrawScene) => void;
  /** Stroke color for new strokes. Defaults to `currentColor`. */
  color?: string;
  /** Stroke width for new strokes. Defaults to 3. */
  strokeWidth?: number;
  /** Pixel height of the surface. Defaults to 220. */
  height?: number;
  /**
   * When true the surface is a static preview: input is ignored and the scene is
   * scaled to fit via a computed viewBox. When false the surface draws 1:1 in CSS
   * pixels so pointer coordinates map directly onto scene coordinates.
   */
  readOnly?: boolean;
  /** Optional background painted behind the drawing. */
  background?: string;
  className?: string;
}

function SceneElement({ el, fallbackStroke }: { el: DrawElement; fallbackStroke: string }): ReactElement {
  const shape = elementToShape(el);
  const stroke = strokeOf(el, fallbackStroke);
  const strokeWidth = strokeWidthOf(el);
  const opacity = opacityOf(el);
  const fill = el.backgroundColor ?? "none";
  switch (shape.kind) {
    case "path":
      return (
        <path
          d={shape.d}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "rect":
      return (
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    case "ellipse":
      return (
        <ellipse
          cx={shape.cx}
          cy={shape.cy}
          rx={shape.rx}
          ry={shape.ry}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    case "polygon":
      return (
        <polygon
          points={shape.points}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
          strokeLinejoin="round"
        />
      );
    case "text":
      return (
        <text x={shape.x} y={shape.y} fontSize={shape.fontSize} fill={stroke} opacity={opacity}>
          {shape.text}
        </text>
      );
  }
}

export function DrawSurface(props: DrawSurfaceProps): ReactElement {
  const {
    onChange,
    color = DEFAULT_STROKE,
    strokeWidth = 3,
    height = 220,
    readOnly = false,
    background,
    className,
  } = props;
  const scene = useMemo(() => props.scene ?? createScene(), [props.scene]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draft, setDraft] = useState<ScenePoint[] | null>(null);
  const interactive = !readOnly && Boolean(onChange);

  const pointFrom = useCallback((e: ReactPointerEvent<SVGSVGElement>): ScenePoint => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return [e.clientX, e.clientY];
    return [e.clientX - rect.left, e.clientY - rect.top];
  }, []);

  const handleDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (!interactive) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDraft([pointFrom(e)]);
    },
    [interactive, pointFrom],
  );

  const handleMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      setDraft((prev) => (prev ? [...prev, pointFrom(e)] : prev));
    },
    [pointFrom],
  );

  const finish = useCallback(() => {
    setDraft((prev) => {
      if (prev && prev.length > 1 && onChange) {
        onChange(addStroke(scene, prev, { strokeColor: color, strokeWidth }));
      }
      return null;
    });
  }, [scene, color, strokeWidth, onChange]);

  return (
    <svg
      ref={svgRef}
      className={cn("hasna-draw-surface", className)}
      data-readonly={readOnly || undefined}
      width="100%"
      height={height}
      viewBox={readOnly ? sceneViewBox(scene) : undefined}
      preserveAspectRatio={readOnly ? "xMidYMid meet" : undefined}
      role="img"
      style={{ touchAction: "none", background, display: "block" }}
      onPointerDown={interactive ? handleDown : undefined}
      onPointerMove={interactive && draft ? handleMove : undefined}
      onPointerUp={interactive ? finish : undefined}
      onPointerLeave={interactive && draft ? finish : undefined}
    >
      {scene.elements.map((el) => (
        <SceneElement key={el.id} el={el} fallbackStroke={color} />
      ))}
      {draft && draft.length > 1 ? (
        <path
          d={pointsToPath(draft)}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}
