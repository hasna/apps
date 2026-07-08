import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { Deck as DeckModel } from "../deck.js";
import { renderSlidesFragment } from "../export-html.js";
import type { DeckData } from "../types.js";
import { REVEAL_VERSION } from "../version.js";

/**
 * The subset of the reveal.js instance API this viewer uses / exposes. Kept
 * minimal so the public surface does not couple to reveal.js internals.
 */
export interface RevealViewerApi {
  initialize: (opts?: Record<string, unknown>) => Promise<unknown>;
  destroy: () => void;
  sync: () => void;
  layout: () => void;
  on: (type: string, listener: (event: unknown) => void) => void;
  slide: (h: number, v?: number, f?: number) => void;
  getIndices: () => { h: number; v: number; f?: number };
}

export interface PresentationProps {
  /** The deck to render — a serializable {@link DeckData} or a `Deck`. */
  deck: DeckData | DeckModel;
  /** Override the deck's theme (reveal.js theme name). */
  theme?: string;
  className?: string;
  style?: CSSProperties;
  /**
   * Run reveal in embedded mode (keyboard/scroll only captured while the deck
   * is focused/hovered). Defaults to `true`, which is correct for an in-page
   * viewer. Set `false` for a full-screen presentation.
   */
  embedded?: boolean;
  /** Show navigation arrows. Defaults to the deck config (or `true`). */
  controls?: boolean;
  /** Show the progress bar. Defaults to the deck config (or `true`). */
  progress?: boolean;
  /** Show slide numbers. */
  slideNumber?: boolean | string;
  /**
   * Inject `<link>` tags for reveal core + theme CSS into the document head.
   * Defaults to `true`. Disable if your app bundles reveal.js styles itself.
   */
  injectStyles?: boolean;
  /** CDN base for injected styles. Defaults to a pinned jsDelivr URL. */
  cdnBase?: string;
  /** reveal.js version for the CDN pin. */
  revealVersion?: string;
  /** Which reveal.js plugins to load. All default to `true`. */
  plugins?: { markdown?: boolean; notes?: boolean; highlight?: boolean };
  /** Called once the reveal.js instance is initialized. */
  onReady?: (reveal: RevealViewerApi) => void;
  /** Called on every slide change. */
  onSlideChanged?: (indices: { h: number; v: number }) => void;
}

function toDeckData(deck: DeckData | DeckModel): DeckData {
  if (deck instanceof DeckModel) return deck.data;
  // `@hasna/slides` and `@hasna/slides/react` are bundled separately, so a
  // Deck instance from the core entry may not be `instanceof` this bundle's
  // class. Duck-type the wrapper as a fallback.
  const candidate = deck as { data?: DeckData };
  if (candidate.data && Array.isArray(candidate.data.slides)) {
    return candidate.data;
  }
  return deck as DeckData;
}

function ensureStyle(id: string, href: string): void {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(id) as HTMLLinkElement | null;
  if (existing) {
    if (existing.href !== href) existing.href = href;
    return;
  }
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

/** A change-signature so the effect re-initializes only on real content changes. */
function signature(data: DeckData, theme: string): string {
  return JSON.stringify({ s: data.slides, c: data.config, theme });
}

/**
 * A reveal.js-backed presentation viewer. Renders a deck into a scoped
 * reveal.js instance with arrow-key navigation, overview mode (press `o`),
 * fragments, and speaker notes (press `s`). Safe to render client-side only
 * (all reveal.js code is dynamically imported inside an effect).
 */
export function Presentation(props: PresentationProps): React.ReactElement {
  const {
    deck,
    theme: themeOverride,
    className,
    style,
    embedded = true,
    controls,
    progress,
    slideNumber,
    injectStyles = true,
    cdnBase,
    revealVersion = REVEAL_VERSION,
    plugins,
    onReady,
    onSlideChanged,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const data = toDeckData(deck);
  const theme = themeOverride ?? data.theme ?? "black";
  const sig = signature(data, theme);

  useEffect(() => {
    let cancelled = false;
    let instance: RevealViewerApi | null = null;
    const container = containerRef.current;
    if (!container) return;

    const base = cdnBase ?? `https://cdn.jsdelivr.net/npm/reveal.js@${revealVersion}`;
    if (injectStyles) {
      ensureStyle("hasna-slides-reveal-css", `${base}/dist/reveal.css`);
      ensureStyle("hasna-slides-reveal-theme", `${base}/dist/theme/${theme}.css`);
    }

    const slidesEl = container.querySelector<HTMLDivElement>(".slides");
    if (slidesEl) slidesEl.innerHTML = renderSlidesFragment(data.slides);

    const usePlugins = {
      markdown: plugins?.markdown ?? true,
      notes: plugins?.notes ?? true,
      highlight: plugins?.highlight ?? true,
    };

    (async () => {
      const imports: Promise<{ default: unknown }>[] = [import("reveal.js")];
      if (usePlugins.markdown) imports.push(import("reveal.js/plugin/markdown"));
      if (usePlugins.highlight) imports.push(import("reveal.js/plugin/highlight"));
      if (usePlugins.notes) imports.push(import("reveal.js/plugin/notes"));

      const loaded = await Promise.all(imports);
      if (cancelled) return;

      const RevealCtor = loaded[0]!.default as new (
        el: HTMLElement,
        opts?: Record<string, unknown>,
      ) => RevealViewerApi;
      const pluginFactories = loaded
        .slice(1)
        .map((m) => m.default as () => unknown)
        .map((factory) => factory());

      const config: Record<string, unknown> = {
        ...data.config,
        embedded,
        plugins: pluginFactories,
      };
      if (controls !== undefined) config.controls = controls;
      if (progress !== undefined) config.progress = progress;
      if (slideNumber !== undefined) config.slideNumber = slideNumber;

      instance = new RevealCtor(container, config);
      await instance.initialize();
      if (cancelled) {
        instance.destroy();
        instance = null;
        return;
      }
      if (onSlideChanged) {
        instance.on("slidechanged", () => {
          const idx = instance!.getIndices();
          onSlideChanged({ h: idx.h, v: idx.v });
        });
      }
      onReady?.(instance);
    })();

    return () => {
      cancelled = true;
      try {
        instance?.destroy();
      } catch {
        /* reveal throws if destroyed before init completes; ignore */
      }
      instance = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, embedded, controls, progress, slideNumber, injectStyles, cdnBase, revealVersion]);

  return (
    <div ref={containerRef} className={`reveal ${className ?? ""}`.trim()} style={style}>
      <div className="slides" />
    </div>
  );
}

/** Alias for {@link Presentation}, exposed as `<Deck>`. */
export const Deck = Presentation;
/** Alias for {@link Presentation}, exposed as `<DeckViewer>`. */
export const DeckViewer = Presentation;

export type { DeckData } from "../types.js";
