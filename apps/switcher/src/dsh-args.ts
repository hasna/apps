/** Only shipped DSH profiles with a composition-owned model route are supported. */
export function dshArguments(input: string[]) {
  const args = [...input];
  let profile = "web";
  if (args[0] === "--profile") { args.shift(); profile = args.shift() ?? ""; }
  else if (args[0]?.startsWith("--profile=")) profile = args.shift()!.slice(10);
  else if (args[0] === "web") args.shift();
  if (!["web", "headless", "acp"].includes(profile))
    throw new Error("DSH supports the web, headless and acp profiles. SDK and custom profiles cannot bind the Switcher launch route.");
  if (profile === "headless") {
    if (args.length !== 1 || !args[0].trim() || args[0].startsWith("-") || ["web","plugin"].includes(args[0]))
      throw new Error("DSH headless requires one task argument and has no native resume flag; use web or acp for persistent sessions.");
  } else if (profile === "acp") {
    if (args.length) throw new Error("DSH acp accepts no application arguments; its provider/model configuration is reserved by the launch profile.");
  } else {
    // Keep the native browser-trust boundary loopback-only. The UI prints the
    // allocated port; callers may suppress opening a browser without changing it.
    if (args.some(arg => arg !== "--no-open"))
      throw new Error("DSH web accepts only --no-open here. Listener and configuration arguments are reserved by the launch profile.");
    args.unshift("--host", "127.0.0.1", "--port", "0");
  }
  return {profile, args};
}
