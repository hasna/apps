// Copy into a fresh packed consumer with React/ReactDOM 19.2.8, then run with its runtime.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDeck, loadDeck, serializeDeck, parseMarkdownDeck, exportDeckHtml } from "@hasna/slides";
import { Presentation, Deck, DeckViewer } from "@hasna/slides/react";

const deck = createDeck({ title: "Packed", theme: "moon" });
const slide = deck.addSlide({ body: "# First", notes: "Speaker", fragments: ["Fragment"] });
deck.addChild(slide.id, { body: "## Child" });
const loaded = loadDeck(serializeDeck(deck.toJSON()));
assert.equal(loaded.toJSON().slides[0].children.length, 1);
assert.equal(parseMarkdownDeck("# One\n\n---\n\n# Two").length, 2);
assert.ok(loaded.toHtml().includes("https://cdn.jsdelivr.net/npm/reveal.js@6.0.1"));
assert.ok(loaded.toHtml().includes("Speaker"));
assert.ok(loaded.toHtml().includes("Fragment"));
const inline = exportDeckHtml(loaded.toJSON(), { assets: {
  revealCss: ".reveal{}", themeCss: ".moon{}", revealJs: "var Reveal={};",
  markdownJs: "var RevealMarkdown={};", notesJs: "var RevealNotes={};",
} });
assert.ok(inline.includes(".reveal{}"));
assert.ok(!inline.includes("cdn.jsdelivr.net"));
assert.equal(Presentation, Deck);
assert.equal(Deck, DeckViewer);
assert.ok(renderToStaticMarkup(createElement(Presentation, { deck: loaded, injectStyles: false })).includes('class="slides"'));
console.log("PASS: packed Slides model, vertical stacks, notes, fragments, Markdown, CDN/inline export and React SSR");
