# Security

`@hasna/slides` is a headless deck SDK plus a React viewer. It renders
user-authored slide content into HTML/reveal.js.

## Untrusted content

- Slide bodies with `format: "html"` are inserted verbatim into the exported
  document and into the React viewer's DOM. Treat HTML-format slide bodies as
  trusted input, or sanitize them upstream — the SDK does not sanitize raw HTML.
- Markdown-format slides are rendered by reveal.js' markdown plugin at view
  time; the SDK guards the embedded `</textarea>` sequence but otherwise passes
  markdown through unchanged.
- Document titles and attribute values produced by `exportDeckHtml` are
  HTML-escaped.

## Secrets

- Do not hardcode API tokens, keys, or credentials in slide content, sample
  decks, tests, or configuration.
- Do not commit `.env` files, `.secrets/`, or local databases.
- Rotate any credential that appears in a deck, screenshot, or export.

## Reporting vulnerabilities

Open a private security advisory or contact the maintainers through the Hasna
security channel. Do not file public issues containing exploit details or
credentials.
