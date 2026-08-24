# @hasna/crawl

## 0.4.18

### Patch Changes

- 8b70821: crawl-mcp and crawl-serve answer --version/-V/--help before any bind (todos row 7e5f8f3d). Previously `crawl-mcp --version`/`--help` started the crawl HTTP server (:8857) and `crawl-serve --version`/`--help` bound :19700, both with no output.
