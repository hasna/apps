import type {
  CoordinateSpace,
  CoordinateSpaceKind,
  DriverAction,
  Point,
  ScreenBounds,
  ScreenSize,
  Screenshot,
} from "../types/index.js";

export interface CoordinateMappingOptions {
  clamp?: boolean;
}

export type CoordinateSpaceInput = CoordinateSpace | ScreenSize | ScreenBounds;

const ZERO_ORIGIN: Point = { x: 0, y: 0 };

export function coordinateSpaceFromScreenshot(
  screenshot: Screenshot,
  kind: CoordinateSpaceKind = "screenshot",
): CoordinateSpace {
  return {
    ...(screenshot.coordinateSpace ?? {}),
    kind,
    size: screenshot.size,
    origin: screenshot.coordinateSpace?.origin ?? ZERO_ORIGIN,
  };
}

export function coordinateSpaceFromBounds(
  bounds: ScreenBounds,
  kind: CoordinateSpaceKind = "native_display",
): CoordinateSpace {
  return {
    kind,
    size: { width: bounds.width, height: bounds.height },
    origin: { x: bounds.x, y: bounds.y },
    displayNumber: bounds.displayNumber,
    scaleFactor: bounds.scaleFactor,
  };
}

export function normalizeCoordinateSpace(
  input: CoordinateSpaceInput,
  kind: CoordinateSpaceKind = "screenshot",
): CoordinateSpace {
  if ("kind" in input && "size" in input) {
    return {
      ...input,
      origin: input.origin ?? ZERO_ORIGIN,
    };
  }

  if ("x" in input && "y" in input) {
    return coordinateSpaceFromBounds(input, kind);
  }

  return {
    kind,
    size: input,
    origin: ZERO_ORIGIN,
  };
}

export function mapPointBetweenSpaces(
  point: Point,
  fromInput: CoordinateSpaceInput,
  toInput: CoordinateSpaceInput,
  options: CoordinateMappingOptions = {},
): Point {
  const from = normalizeCoordinateSpace(fromInput);
  const to = normalizeCoordinateSpace(toInput, "native_display");
  assertValidSpace(from, "source");
  assertValidSpace(to, "target");

  const targetOrigin = to.origin ?? ZERO_ORIGIN;
  const sourceLocal = {
    x: point.x,
    y: point.y,
  };
  const mapped = {
    x: Math.round(targetOrigin.x + (sourceLocal.x * to.size.width) / from.size.width),
    y: Math.round(targetOrigin.y + (sourceLocal.y * to.size.height) / from.size.height),
  };

  return options.clamp ? clampPointToSpace(mapped, to) : mapped;
}

export function mapActionBetweenSpaces(
  action: DriverAction,
  fromInput: CoordinateSpaceInput,
  toInput: CoordinateSpaceInput,
  options: CoordinateMappingOptions = {},
): DriverAction {
  switch (action.type) {
    case "click":
      return { ...action, point: mapPointBetweenSpaces(action.point, fromInput, toInput, options) };
    case "mouse_move":
      return { ...action, point: mapPointBetweenSpaces(action.point, fromInput, toInput, options) };
    case "scroll":
      return { ...action, point: mapPointBetweenSpaces(action.point, fromInput, toInput, options) };
    case "drag":
      return {
        ...action,
        from: mapPointBetweenSpaces(action.from, fromInput, toInput, options),
        to: mapPointBetweenSpaces(action.to, fromInput, toInput, options),
      };
    case "screenshot":
    case "type":
    case "key":
    case "wait":
    case "open_url":
    case "open_app":
      return { ...action };
  }
}

export function clampPointToSpace(point: Point, input: CoordinateSpaceInput): Point {
  const space = normalizeCoordinateSpace(input, "native_display");
  assertValidSpace(space, "target");
  const origin = space.origin ?? ZERO_ORIGIN;
  const maxX = origin.x + space.size.width - 1;
  const maxY = origin.y + space.size.height - 1;

  return {
    x: Math.min(Math.max(point.x, origin.x), maxX),
    y: Math.min(Math.max(point.y, origin.y), maxY),
  };
}

function assertValidSpace(space: CoordinateSpace, label: string): void {
  if (!Number.isFinite(space.size.width) || !Number.isFinite(space.size.height)) {
    throw new Error(`Invalid ${label} coordinate space size`);
  }
  if (space.size.width <= 0 || space.size.height <= 0) {
    throw new Error(`Invalid ${label} coordinate space dimensions: ${space.size.width}x${space.size.height}`);
  }
}
