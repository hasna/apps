import { OPENAPI } from "../src/api/openapi.js";
await Bun.write(new URL("../openapi.json", import.meta.url), `${JSON.stringify(OPENAPI, null, 2)}\n`);
