// Trusted parser only. Image source arrives as data and is never imported/eval'd.
const input = await Bun.stdin.text();
if (input.length > 40 * 1024 * 1024) throw new Error("INPUT_LIMIT");
const files = JSON.parse(input) as Record<string, string>;
const result: Record<string, ReturnType<Bun.Transpiler["scanImports"]>> = {};
for (const [path, source] of Object.entries(files)) {
  // scanImports omits computed dynamic imports. This deliberately conservative
  // lexical guard also refuses comments between `import` and its next token;
  // unsupported syntax is never treated as a proven closed import set.
  if (/\b(?:require|import)\s*(?:\(|\/)/u.test(source)) throw new Error("DYNAMIC_DEPENDENCY");
  const parser = new Bun.Transpiler({ loader: path.endsWith(".ts") ? "ts" : "js" });
  result[path] = parser.scanImports(source);
}
process.stdout.write(JSON.stringify(result));
