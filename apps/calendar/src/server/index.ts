import { serve } from "./serve.js";

const port = parseInt(process.env["CALENDAR_PORT"] || "19428");

console.log(`Starting calendar server on port ${port}...`);
serve(port);
