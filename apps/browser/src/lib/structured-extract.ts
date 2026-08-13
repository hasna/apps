/**
 * Structured data extraction from web pages.
 * Detects tables, lists, JSON-LD, Schema.org, repeated elements.
 */

import type { Page } from "playwright";

export interface StructuredData {
  tables: Array<{ headers: string[]; rows: string[][]; selector: string }>;
  lists: Array<{ items: string[]; selector: string }>;
  jsonLd: any[];
  openGraph: Record<string, string>;
  metaTags: Record<string, string>;
  repeatedElements: Array<{ selector: string; count: number; sample: string[] }>;
}

export async function extractStructuredData(page: Page): Promise<StructuredData> {
  return page.evaluate(() => {
    const result: any = { tables: [], lists: [], jsonLd: [], openGraph: {}, metaTags: {}, repeatedElements: [] };

    // Tables
    document.querySelectorAll("table").forEach((table, idx) => {
      const headers: string[] = [];
      table.querySelectorAll("thead th, thead td, tr:first-child th").forEach(th => {
        headers.push((th as HTMLElement).textContent?.trim() ?? "");
      });
      const rows: string[][] = [];
      table.querySelectorAll("tbody tr, tr:not(:first-child)").forEach(tr => {
        const row: string[] = [];
        tr.querySelectorAll("td, th").forEach(td => {
          row.push((td as HTMLElement).textContent?.trim() ?? "");
        });
        if (row.length > 0 && row.some(c => c !== "")) rows.push(row);
      });
      if (rows.length > 0) {
        result.tables.push({ headers, rows, selector: `table:nth-of-type(${idx + 1})` });
      }
    });

    // Lists (ul/ol with 3+ items)
    document.querySelectorAll("ul, ol").forEach((list, idx) => {
      const items: string[] = [];
      list.querySelectorAll(":scope > li").forEach(li => {
        const text = (li as HTMLElement).textContent?.trim() ?? "";
        if (text) items.push(text);
      });
      if (items.length >= 3) {
        const tag = list.tagName.toLowerCase();
        result.lists.push({ items, selector: `${tag}:nth-of-type(${idx + 1})` });
      }
    });

    // JSON-LD
    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try { result.jsonLd.push(JSON.parse(script.textContent ?? "")); } catch {}
    });

    // Open Graph
    document.querySelectorAll('meta[property^="og:"]').forEach(meta => {
      const prop = meta.getAttribute("property")?.replace("og:", "") ?? "";
      result.openGraph[prop] = meta.getAttribute("content") ?? "";
    });

    // Meta tags
    document.querySelectorAll("meta[name]").forEach(meta => {
      const name = meta.getAttribute("name") ?? "";
      if (name) result.metaTags[name] = meta.getAttribute("content") ?? "";
    });

    // Repeated elements (cards, items — elements with same class that appear 3+ times)
    const classCounts = new Map<string, Element[]>();
    document.querySelectorAll("[class]").forEach(el => {
      const cls = el.className.toString().trim();
      if (cls && cls.length > 5 && cls.length < 100) {
        if (!classCounts.has(cls)) classCounts.set(cls, []);
        classCounts.get(cls)!.push(el);
      }
    });
    for (const [cls, elements] of classCounts) {
      if (elements.length >= 3 && elements.length <= 200) {
        const sample = elements.slice(0, 3).map(el => (el as HTMLElement).textContent?.trim().slice(0, 100) ?? "");
        if (sample.some(s => s.length > 10)) {
          result.repeatedElements.push({
            selector: `.${cls.split(" ")[0]}`,
            count: elements.length,
            sample,
          });
        }
      }
    }
    // Limit repeated elements to top 10 by count
    result.repeatedElements.sort((a: any, b: any) => b.count - a.count);
    result.repeatedElements = result.repeatedElements.slice(0, 10);

    return result;
  });
}
