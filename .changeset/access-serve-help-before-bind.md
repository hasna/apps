---
"@hasna/access": patch
---

fix(access): `access-serve --help`/`--version` answer before binding (the serve entry previously ignored both flags and bound the port unconditionally, hanging instead of answering help; binds-before-args class, BUG row 2920eed6). The plain serve path is unchanged.
