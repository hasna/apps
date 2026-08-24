# @hasna/treasury

## 0.1.3

### Patch Changes

- 8b70821: treasury-mcp answers --help/-h before any transport (todos row 7e5f8f3d). Previously `treasury-mcp --help` fell through the --version guard and printed nothing (silent-empty family on help); --version already worked.
