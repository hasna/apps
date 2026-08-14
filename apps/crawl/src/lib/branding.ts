import type { BrandingResult } from "../types/index.js";

export function extractBranding(html: string, baseUrl: string): BrandingResult {
  const base = (() => { try { return new URL(baseUrl); } catch { return null; } })();
  const resolve = (u: string) => { try { return new URL(u, baseUrl).toString(); } catch { return u; } };

  // Favicon / logo
  const favicon =
    html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i)?.[1] ??
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i)?.[1] ??
    null;

  const logo =
    html.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<img[^>]+(?:class|id)=["'][^"']*logo[^"']*["'][^>]+src=["']([^"']+)["']/i)?.[1] ??
    null;

  // Theme color
  const themeColor =
    html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i)?.[1] ??
    null;

  // Google Fonts
  const fonts: string[] = [];
  const fontMatches = html.matchAll(/fonts\.googleapis\.com\/css[^"']*family=([^"'&:]+)/gi);
  for (const m of fontMatches) {
    const name = decodeURIComponent(m[1] ?? "").replace(/\+/g, " ").split("|")[0]?.trim();
    if (name && !fonts.includes(name)) fonts.push(name);
  }
  // CSS font-family
  const fontFamilyMatches = html.matchAll(/font-family:\s*["']?([A-Za-z][A-Za-z0-9 -]+?)["']?\s*[;,}]/g);
  for (const m of fontFamilyMatches) {
    const name = m[1]?.trim();
    if (name && !["serif", "sans-serif", "monospace", "inherit", "initial"].includes(name) && !fonts.includes(name)) {
      fonts.push(name);
    }
  }

  // Colors from CSS
  const colors: string[] = [];
  const colorMatches = html.matchAll(/#([0-9a-fA-F]{3,6})\b/g);
  const colorSet = new Set<string>();
  for (const m of colorMatches) {
    const hex = "#" + m[1]?.toUpperCase();
    colorSet.add(hex);
  }
  colors.push(...[...colorSet].slice(0, 10));

  return {
    logo: logo ? resolve(logo) : null,
    favicon: favicon ? resolve(favicon) : (base ? `${base.origin}/favicon.ico` : null),
    themeColor: themeColor ?? null,
    fonts: fonts.slice(0, 5),
    colors,
  };
}
