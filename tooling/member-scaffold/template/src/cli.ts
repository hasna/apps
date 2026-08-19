/** CLI entry — `<name>` bin. */
import { hello } from "./index.js";

const arg = process.argv[2] ?? "world";
if (process.argv.includes("--version")) {
  console.log("0.0.0");
  process.exit(0);
}
console.log(hello(arg));
