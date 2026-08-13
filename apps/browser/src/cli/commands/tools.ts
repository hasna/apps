// ─── Tool commands: record, agent, project, gallery, downloads, login, attach, daemon, install-browser, mcp, serve ───

import type { Command } from "commander";
import chalk from "chalk";
import { createSession, closeSession, getSessionPage } from "../../lib/session.js";
import { navigate } from "../../lib/actions.js";
import { getText } from "../../lib/extractor.js";
import { takeScreenshot } from "../../lib/screenshot.js";
import { registerAgent, heartbeat, listAgents } from "../../lib/agents.js";
import { ensureProject, listProjects } from "../../db/projects.js";
import { startRecording, stopRecording, replayRecording } from "../../lib/recorder.js";
import { startVideoRecording, stopVideoRecording, listVideos, deleteVideo } from "../../lib/video-recording.js";
import { resolveVideoRecordingPreset, VIDEO_PRESET_NAMES } from "../../lib/video-presets.js";
import { recordX11BrowserVideo } from "../../lib/x11-video.js";
import { listRecordings } from "../../db/recordings.js";
import { isLightpandaAvailable } from "../../engines/lightpanda.js";
import type { BrowserEngine, VideoRecordingCaptureMode, VideoRecordingCodec, VideoRecordingEncoding, VideoRecordingOptions, VideoRecordingPreset } from "../../types/index.js";
import { UseCase } from "../../types/index.js";
import { formatBytes, formatDate, limited, parseLimit, printHint, printListFooter, printPageFooter, shortId, truncate } from "../output.js";

export function register(program: Command) {

// ─── record ──────────────────────────────────────────────────────────────────

const recordCmd = program.command("record").description("Manage action recordings");

recordCmd
  .command("start <name>")
  .description("Start recording actions in a new session")
  .option("--url <url>", "Start URL")
  .option("--engine <engine>", "Browser engine", "auto")
  .option("--headed", "Run in headed (visible) mode")
  .action(async (name: string, opts: { url?: string; engine: string; headed?: boolean }) => {
    const { session } = await createSession({ engine: opts.engine as BrowserEngine, startUrl: opts.url, headless: !opts.headed });
    const recording = startRecording(session.id, name, opts.url);
    console.log(chalk.green(`✓ Recording started`));
    console.log(`  Recording ID: ${recording.id}`);
    console.log(`  Session ID: ${session.id}`);
  });

recordCmd
  .command("stop <recording_id>")
  .description("Stop an active recording")
  .action((id: string) => {
    const recording = stopRecording(id);
    console.log(chalk.green(`✓ Recording stopped: ${recording.name}`));
    console.log(`  Steps: ${recording.steps.length}`);
  });

recordCmd
  .command("replay <recording_id>")
  .description("Replay a recording in a new session")
  .option("--url <url>", "Override start URL")
  .option("--engine <engine>", "Browser engine", "auto")
  .option("--headed", "Run in headed (visible) mode")
  .action(async (id: string, opts: { url?: string; engine: string; headed?: boolean }) => {
    const { session, page } = await createSession({ engine: opts.engine as BrowserEngine, startUrl: opts.url, headless: !opts.headed });
    const result = await replayRecording(id, page);
    console.log(result.success ? chalk.green("✓ Replay complete") : chalk.red("✗ Replay had errors"));
    console.log(`  Steps: ${result.steps_executed} executed, ${result.steps_failed} failed`);
    if (result.errors.length > 0) result.errors.forEach((e) => console.log(chalk.red(`  - ${e}`)));
    await closeSession(session.id);
  });

recordCmd
  .command("list")
  .description("List all recordings")
  .option("--json", "Output as JSON")
  .option("--limit <n>", "Max rows to print in compact output", String(20))
  .option("--verbose", "Show full ids and longer URLs")
  .action((opts: { json?: boolean; limit?: string; verbose?: boolean }) => {
    const recordings = listRecordings();
    if (opts.json) {
      console.log(JSON.stringify({ recordings }, null, 2));
    } else if (recordings.length === 0) {
      console.log(chalk.gray("No recordings found"));
    } else {
      const { visible } = limited(recordings, parseLimit(opts.limit));
      visible.forEach((r) => {
        const id = opts.verbose ? r.id : shortId(r.id);
        const url = r.start_url ? ` ${chalk.gray(truncate(r.start_url, opts.verbose ? 100 : 48))}` : "";
        console.log(`${id} "${truncate(r.name, 40)}" ${r.steps.length} steps ${formatDate(r.created_at)}${url}`);
      });
      printListFooter(recordings.length, visible.length, "Use --limit N, --verbose, or --json for full recording records.");
    }
  });

// ─── video ───────────────────────────────────────────────────────────────────

const videoCmd = program.command("video").description("Record browser sessions as video");

videoCmd
  .command("record <target>")
  .description("Record a URL or, with --engine tui, a terminal command to a video for a fixed duration")
  .option("--name <name>", "Recording name")
  .option("--duration <seconds>", "Duration to record", "5")
  .option("--quality <quality>", "Quality: source|low|medium|high|ultra", "high")
  .option("--format <format>", "Output format: webm|mp4|mov", "webm")
  .option("--capture-mode <mode>", "Capture backend: native|cdp|x11")
  .option("--codec <codec>", "Transcoded codec: h264|prores")
  .option("--encoding <mode>", "Encoder fidelity: auto|balanced|crisp|lossless|prores", "auto")
  .option("--crf <value>", "H.264 CRF: 0 lossless, 10-12 near-lossless UI, 18 balanced")
  .option("--fps <fps>", "Output frame rate for CDP/X11 capture", "30")
  .option("--display-scale <factor>", "X11 capture browser scale, e.g. 2 for Retina-style 4K")
  .option("--xvfb-path <path>", "Path to Xvfb for --capture-mode x11")
  .option("--video-bitrate <rate>", "Optional H.264 target bitrate, e.g. 25M or 50000k")
  .option("--ffmpeg-preset <preset>", "x264 speed/quality preset, e.g. slow or veryslow")
  .option("--keep-raw-video", "Keep the native Playwright WebM next to the final export")
  .option("--preset <preset>", `Social preset: ${VIDEO_PRESET_NAMES.join("|")}`, "source")
  .option("--width <px>", "Explicit video width")
  .option("--height <px>", "Explicit video height")
  .option("--engine <engine>", "Browser engine", "playwright")
  .option("--tui-theme <theme>", "TUI theme for recorded terminal: light|dark|system")
  .option("--tui-font-size <px>", "TUI font size in the recorded terminal")
  .option("--tui-zoom <factor>", "Scale TUI font/chrome, e.g. 0.85 or 1.15", "1")
  .option("--tui-frame <mode>", "TUI terminal frame: auto|on|off", "auto")
  .option("--tui-frame-fit <mode>", "TUI frame sizing: preset|canvas", "preset")
  .option("--tui-padding <px>", "Padding around framed TUI recordings")
  .option("--tui-window-width <px>", "TUI terminal window width inside the video canvas")
  .option("--tui-window-height <px>", "TUI terminal window height inside the video canvas")
  .option("--tui-title <title>", "TUI terminal window title")
  .option("--background <css>", "Background color for framed TUI recordings")
  .option("--headed", "Run in headed (visible) mode")
  .option("--json", "Output JSON")
  .action(async (target: string, opts: {
    name?: string;
    duration: string;
    quality: string;
    format: string;
    captureMode?: string;
    codec?: string;
    encoding: string;
    crf?: string;
    fps: string;
    displayScale?: string;
    xvfbPath?: string;
    videoBitrate?: string;
    ffmpegPreset?: string;
    keepRawVideo?: boolean;
    preset: string;
    width?: string;
    height?: string;
    engine: string;
    tuiTheme?: "dark" | "light" | "system";
    tuiFontSize?: string;
    tuiZoom: string;
    tuiFrame: string;
    tuiFrameFit: string;
    tuiPadding?: string;
    tuiWindowWidth?: string;
    tuiWindowHeight?: string;
    tuiTitle?: string;
    background?: string;
    headed?: boolean;
    json?: boolean;
  }) => {
    const width = opts.width ? parseInt(opts.width, 10) : undefined;
    const height = opts.height ? parseInt(opts.height, 10) : undefined;
    const tuiFontSize = opts.tuiFontSize ? parseInt(opts.tuiFontSize, 10) : undefined;
    const tuiZoom = opts.tuiZoom ? parseFloat(opts.tuiZoom) : undefined;
    const tuiPadding = opts.tuiPadding ? parseInt(opts.tuiPadding, 10) : undefined;
    const tuiWindowWidth = opts.tuiWindowWidth ? parseInt(opts.tuiWindowWidth, 10) : undefined;
    const tuiWindowHeight = opts.tuiWindowHeight ? parseInt(opts.tuiWindowHeight, 10) : undefined;
    const crf = opts.crf ? parseInt(opts.crf, 10) : undefined;
    const fps = opts.fps ? parseInt(opts.fps, 10) : undefined;
    const displayScale = opts.displayScale ? parseFloat(opts.displayScale) : undefined;
    const durationMs = Math.max(1, parseFloat(opts.duration) || 5) * 1000;
    const engine = opts.engine as BrowserEngine;
    if (!["webm", "mp4", "mov"].includes(opts.format)) {
      throw new Error(`Unknown --format "${opts.format}". Expected webm, mp4, or mov.`);
    }
    if (opts.codec && !["h264", "prores"].includes(opts.codec)) {
      throw new Error(`Unknown --codec "${opts.codec}". Expected h264 or prores.`);
    }
    if (opts.captureMode && !["native", "cdp", "x11"].includes(opts.captureMode)) {
      throw new Error(`Unknown --capture-mode "${opts.captureMode}". Expected native, cdp, or x11.`);
    }
    if (!["auto", "balanced", "crisp", "lossless", "prores"].includes(opts.encoding)) {
      throw new Error(`Unknown --encoding "${opts.encoding}". Expected auto, balanced, crisp, lossless, or prores.`);
    }
    const presetName = VIDEO_PRESET_NAMES.includes(opts.preset as VideoRecordingPreset)
      ? opts.preset as VideoRecordingPreset
      : "source";
    if (presetName !== opts.preset) {
      throw new Error(`Unknown video preset "${opts.preset}". Expected one of: ${VIDEO_PRESET_NAMES.join(", ")}`);
    }
    const tuiFrameEnabled = opts.tuiFrame === "on"
      ? true
      : opts.tuiFrame === "off"
        ? false
        : undefined;
    if (!["auto", "on", "off"].includes(opts.tuiFrame)) {
      throw new Error(`Unknown --tui-frame mode "${opts.tuiFrame}". Expected auto, on, or off.`);
    }
    if (!["preset", "canvas"].includes(opts.tuiFrameFit)) {
      throw new Error(`Unknown --tui-frame-fit mode "${opts.tuiFrameFit}". Expected preset or canvas.`);
    }
    const videoOptions: VideoRecordingOptions = {
      name: opts.name,
      quality: opts.quality as "source" | "low" | "medium" | "high" | "ultra",
      format: opts.format as "webm" | "mp4" | "mov",
      captureMode: opts.captureMode as VideoRecordingCaptureMode | undefined,
      codec: opts.codec as VideoRecordingCodec | undefined,
      encoding: opts.encoding === "auto" ? undefined : opts.encoding as VideoRecordingEncoding,
      crf,
      fps,
      displayScale,
      xvfbPath: opts.xvfbPath,
      videoBitrate: opts.videoBitrate,
      ffmpegPreset: opts.ffmpegPreset,
      keepRawVideo: opts.keepRawVideo,
      preset: presetName,
      width,
      height,
      tuiTheme: opts.tuiTheme,
      tuiFontSize,
      tuiZoom,
      tuiFrame: {
        enabled: tuiFrameEnabled,
        fit: opts.tuiFrameFit as "preset" | "canvas",
        padding: tuiPadding,
        width: tuiWindowWidth,
        height: tuiWindowHeight,
        title: opts.tuiTitle,
        background: opts.background,
      },
    };

    if (videoOptions.captureMode === "x11") {
      if (engine === "tui") {
        throw new Error("--capture-mode x11 records browser pages. Use the normal TUI video path for --engine tui.");
      }
      const stopped = await recordX11BrowserVideo(target, {
        ...videoOptions,
        durationMs,
      });
      if (opts.json) {
        console.log(JSON.stringify(stopped, null, 2));
      } else {
        console.log(chalk.green(`✓ Video saved: ${stopped.path}`));
        console.log(chalk.gray(`  Size: ${((stopped.size_bytes ?? 0) / 1024 / 1024).toFixed(2)} MB`));
        console.log(chalk.gray(`  Duration: ${((stopped.duration_ms ?? 0) / 1000).toFixed(1)}s`));
      }
      return;
    }
    const resolvedPreset = resolveVideoRecordingPreset(videoOptions);
    const { session, page } = await createSession({
      engine,
      startUrl: target,
      headless: !opts.headed,
      viewport: resolvedPreset.width && resolvedPreset.height ? { width: resolvedPreset.width, height: resolvedPreset.height } : undefined,
      tuiTheme: opts.tuiTheme ?? resolvedPreset.tuiTheme,
      tuiFontSize: tuiFontSize ?? resolvedPreset.tuiFontSize,
    });

    try {
      if (engine !== "tui") {
        await navigate(page, target);
      }
      const recording = await startVideoRecording(session.id, videoOptions);
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      const stopped = await stopVideoRecording(recording.id);
      if (opts.json) {
        console.log(JSON.stringify(stopped, null, 2));
      } else {
        console.log(chalk.green(`✓ Video saved: ${stopped.path}`));
        console.log(chalk.gray(`  Size: ${((stopped.size_bytes ?? 0) / 1024 / 1024).toFixed(2)} MB`));
        console.log(chalk.gray(`  Duration: ${((stopped.duration_ms ?? 0) / 1000).toFixed(1)}s`));
      }
    } finally {
      await closeSession(session.id).catch(() => {});
    }
  });

videoCmd
  .command("list")
  .description("List saved video recordings")
  .option("--json", "Output JSON")
  .option("--limit <n>", "Max rows to print in compact output", String(20))
  .option("--verbose", "Show full ids and paths")
  .action((opts: { json?: boolean; limit?: string; verbose?: boolean }) => {
    const recordings = listVideos();
    if (opts.json) {
      console.log(JSON.stringify({ recordings }, null, 2));
    } else if (recordings.length === 0) {
      console.log(chalk.gray("No video recordings found"));
    } else {
      const { visible } = limited(recordings, parseLimit(opts.limit));
      visible.forEach((r) => {
        const id = opts.verbose ? r.id : shortId(r.id);
        const path = opts.verbose && r.path ? ` ${chalk.gray(truncate(r.path, 80))}` : "";
        console.log(`${id} "${truncate(r.name ?? "", 36)}" ${r.status} ${r.format} ${r.width}x${r.height} ${formatBytes(r.size_bytes)}${path}`);
      });
      printListFooter(recordings.length, visible.length, "Use --limit N, --verbose, or --json for full video records.");
    }
  });

videoCmd
  .command("delete <recording_id>")
  .description("Delete a saved video recording and file")
  .action((id: string) => {
    deleteVideo(id);
    console.log(chalk.green(`✓ Video deleted: ${id}`));
  });

// ─── agent ───────────────────────────────────────────────────────────────────

const agentCmd = program.command("agent").description("Manage registered agents");

agentCmd
  .command("register <name>")
  .description("Register an agent")
  .option("--description <desc>", "Agent description")
  .option("--project <id>", "Project ID")
  .option("--json", "Output full agent as JSON")
  .action((name: string, opts: { description?: string; project?: string; json?: boolean }) => {
    const agent = registerAgent(name, { description: opts.description, projectId: opts.project });
    if (opts.json) {
      console.log(JSON.stringify(agent, null, 2));
      return;
    }
    console.log(chalk.green(`✓ Agent registered: ${agent.name}`));
    console.log(chalk.gray(`  ID: ${agent.id}`));
    if (agent.project_id) console.log(chalk.gray(`  Project: ${agent.project_id}`));
    printHint("Use --json for the full agent record.");
  });

agentCmd
  .command("list")
  .description("List all registered agents")
  .option("--json", "Output as JSON")
  .option("--limit <n>", "Max rows to print in compact output", String(20))
  .option("--verbose", "Show descriptions and full ids")
  .action((opts: { json?: boolean; limit?: string; verbose?: boolean }) => {
    const agents = listAgents();
    if (opts.json) {
      console.log(JSON.stringify({ agents }, null, 2));
    } else if (agents.length === 0) {
      console.log(chalk.gray("No agents found"));
    } else {
      const { visible } = limited(agents, parseLimit(opts.limit));
      visible.forEach((a) => {
        const id = opts.verbose ? a.id : shortId(a.id);
        const description = opts.verbose && a.description ? ` ${chalk.gray(truncate(a.description, 80))}` : "";
        console.log(`${id} "${truncate(a.name, 36)}" last_seen=${formatDate(a.last_seen)}${description}`);
      });
      printListFooter(agents.length, visible.length, "Use --limit N, --verbose, or --json for full agent records.");
    }
  });

agentCmd
  .command("heartbeat <agent_id>")
  .description("Send a heartbeat for an agent")
  .action((id: string) => {
    heartbeat(id);
    console.log(chalk.green(`✓ Heartbeat sent: ${id}`));
  });

// ─── project ─────────────────────────────────────────────────────────────────

const projectCmd = program.command("project").description("Manage projects");

projectCmd
  .command("create <name> <path>")
  .description("Create a new project")
  .option("--description <desc>", "Description")
  .option("--json", "Output full project as JSON")
  .action((name: string, path: string, opts: { description?: string; json?: boolean }) => {
    const project = ensureProject(name, path, opts.description);
    if (opts.json) {
      console.log(JSON.stringify(project, null, 2));
      return;
    }
    console.log(chalk.green(`✓ Project: ${project.name}`));
    console.log(chalk.gray(`  ID: ${project.id}`));
    console.log(chalk.gray(`  Path: ${project.path}`));
    printHint("Use --json for the full project record.");
  });

projectCmd
  .command("list")
  .description("List all projects")
  .option("--json", "Output as JSON")
  .option("--limit <n>", "Max rows to print in compact output", String(20))
  .option("--verbose", "Show descriptions and full paths")
  .action((opts: { json?: boolean; limit?: string; verbose?: boolean }) => {
    const projects = listProjects();
    if (opts.json) {
      console.log(JSON.stringify({ projects }, null, 2));
    } else if (projects.length === 0) {
      console.log(chalk.gray("No projects found"));
    } else {
      const { visible } = limited(projects, parseLimit(opts.limit));
      visible.forEach((p) => {
        const path = opts.verbose ? p.path : truncate(p.path, 64);
        const description = opts.verbose && p.description ? ` ${chalk.gray(truncate(p.description, 80))}` : "";
        console.log(`${shortId(p.id)} "${truncate(p.name, 36)}" ${chalk.gray(path)}${description}`);
      });
      printListFooter(projects.length, visible.length, "Use --limit N, --verbose, or --json for full project records.");
    }
  });

// ─── attach (CDP connect) ─────────────────────────────────────────────────────

program
  .command("attach")
  .description("Attach to a running Chrome browser via CDP")
  .option("--port <port>", "Chrome debugging port", "9222")
  .option("--host <host>", "Chrome debugging host", "localhost")
  .option("--json", "Output as JSON")
  .action(async (opts: { port: string; host: string; json?: boolean }) => {
    const cdpUrl = `http://${opts.host}:${opts.port}`;
    const { session, page } = await createSession({ cdpUrl });
    const title = await page.title();
    const url = page.url();
    if (opts.json) {
      console.log(JSON.stringify({ session_id: session.id, url, title, cdp_url: cdpUrl }));
    } else {
      console.log(chalk.green(`✓ Attached to Chrome at ${cdpUrl}`));
      console.log(chalk.blue(`  Session: ${session.id}`));
      console.log(chalk.blue(`  Page: ${title} (${url})`));
    }
  });

// ─── login ──────────────────────────────────────────────────────────────────

program
  .command("login <url>")
  .description("Login to a site: detect form, fill credentials from secrets, save auth state")
  .option("--email <email>", "Email to login with")
  .option("--password <password>", "Password to login with")
  .option("--save-as <name>", "Name to save storage state as")
  .option("--engine <engine>", "Browser engine", "auto")
  .option("--headed", "Run in headed (visible) mode")
  .option("--json", "Output as JSON")
  .action(async (url: string, opts: { email?: string; password?: string; saveAs?: string; engine: string; headed?: boolean; json?: boolean }) => {
    const { session, page } = await createSession({ engine: opts.engine as BrowserEngine, useCase: UseCase.AUTH_FLOW, headless: !opts.headed });
    await navigate(page, url);

    // Settle delay for SPA hydration before form detection
    await new Promise(r => setTimeout(r, 2000));

    // Detect login form
    const formInfo = await page.evaluate(() => {
      const emailInput = document.querySelector('input[type="email"], input[name="email"], input[name="username"], input[autocomplete="email"], input[autocomplete="username"]') as HTMLInputElement | null;
      const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement | null;
      const submitBtn = document.querySelector('button[type="submit"], input[type="submit"], button:has(span)') as HTMLElement | null;
      return {
        hasEmailInput: !!emailInput,
        hasPasswordInput: !!passwordInput,
        hasSubmitButton: !!submitBtn,
        emailSelector: emailInput ? (emailInput.id ? `#${emailInput.id}` : emailInput.name ? `input[name="${emailInput.name}"]` : 'input[type="email"]') : null,
        passwordSelector: passwordInput ? (passwordInput.id ? `#${passwordInput.id}` : 'input[type="password"]') : null,
        submitSelector: submitBtn ? (submitBtn.id ? `#${submitBtn.id}` : 'button[type="submit"]') : null,
        pageTitle: document.title,
      };
    });

    if (!opts.json) {
      console.log(chalk.gray(`Page: ${formInfo.pageTitle}`));
      console.log(chalk.gray(`  Email input: ${formInfo.hasEmailInput ? '✓' : '✗'}`));
      console.log(chalk.gray(`  Password input: ${formInfo.hasPasswordInput ? '✓' : '✗'}`));
      console.log(chalk.gray(`  Submit button: ${formInfo.hasSubmitButton ? '✓' : '✗'}`));
    }

    // Resolve credentials from CLI flags or secrets vault
    let email = opts.email;
    let password = opts.password;

    if (!email || !password) {
      try {
        const { getCredentials } = await import("../../lib/auth.js");
        const hostname = new URL(url).hostname;
        const creds = await getCredentials(hostname);
        if (creds) {
          email = email ?? creds.email ?? creds.username;
          password = password ?? creds.password;
          if (!opts.json) console.log(chalk.blue(`  Credentials found for ${hostname}`));
        }
      } catch {}
    }

    // Fill email if we have it and there's an input
    if (email && formInfo.emailSelector) {
      await page.fill(formInfo.emailSelector, email);
      if (!opts.json) console.log(chalk.green(`  ✓ Filled email: ${email}`));
    }

    // Fill password if we have it
    if (password && formInfo.passwordSelector) {
      await page.fill(formInfo.passwordSelector, password);
      if (!opts.json) console.log(chalk.green(`  ✓ Filled password`));
    }

    // Submit if we have a button
    if (formInfo.hasSubmitButton && formInfo.submitSelector) {
      await page.click(formInfo.submitSelector);
      if (!opts.json) console.log(chalk.green(`  ✓ Submitted form`));

      // Wait for navigation
      try {
        await page.waitForNavigation({ timeout: 10000 });
      } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }

    const finalUrl = page.url();
    const loggedIn = finalUrl !== url;

    // Save storage state
    let savedAs: string | undefined;
    if (opts.saveAs || loggedIn) {
      const name = opts.saveAs ?? new URL(url).hostname.replace(/\./g, "-");
      try {
        const { saveStateFromPage } = await import("../../lib/storage-state.js");
        await saveStateFromPage(page, name);
        savedAs = name;
        if (!opts.json) console.log(chalk.green(`  ✓ State saved as: ${name}`));
      } catch {}
    }

    if (opts.json) {
      console.log(JSON.stringify({ session_id: session.id, url: finalUrl, logged_in: loggedIn, form_detected: formInfo.hasEmailInput, saved_as: savedAs }));
    } else {
      console.log(loggedIn ? chalk.green(`\n✓ Login successful → ${finalUrl}`) : chalk.yellow(`\n⚠ May need manual steps (magic link, 2FA, etc)`));
    }

    if (!opts.headed) await closeSession(session.id);
  });

// ─── gallery ─────────────────────────────────────────────────────────────────

const galleryCmd = program.command("gallery").description("Manage screenshot gallery");

galleryCmd
  .command("list")
  .description("List gallery entries")
  .option("--project <id>", "Filter by project ID")
  .option("--tag <tag>", "Filter by tag")
  .option("--favorite", "Show only favorites")
  .option("--limit <n>", "Max entries", "20")
  .option("--json", "Output as JSON")
  .option("--verbose", "Show titles and full URLs")
  .action(async (opts: { project?: string; tag?: string; favorite?: boolean; limit: string; json?: boolean; verbose?: boolean }) => {
    const { listEntries } = await import("../../db/gallery.js");
    const limit = parseLimit(opts.limit);
    const entries = listEntries({ projectId: opts.project, tag: opts.tag, isFavorite: opts.favorite, limit: limit + 1 });
    const visible = entries.slice(0, limit);
    if (opts.json) {
      console.log(JSON.stringify({ entries: visible, count: visible.length, limit, truncated: entries.length > limit }, null, 2));
      return;
    }
    if (entries.length === 0) { console.log(chalk.gray("No gallery entries found")); return; }
    visible.forEach((e) => {
      const fav = e.is_favorite ? chalk.yellow("★") : " ";
      const tags = e.tags.length ? chalk.blue(` [${e.tags.join(",")}]`) : "";
      const size = e.compressed_size_bytes ? chalk.gray(` ${formatBytes(e.compressed_size_bytes)}`) : "";
      const ratio = e.compression_ratio != null ? chalk.green(` ${(e.compression_ratio * 100).toFixed(0)}%`) : "";
      const title = opts.verbose && e.title ? ` "${truncate(e.title, 48)}"` : "";
      console.log(`${fav} ${shortId(e.id)} ${chalk.cyan(e.format ?? "?")}${size}${ratio}${tags}${title} ${chalk.gray(truncate(e.url, opts.verbose ? 120 : 60))}`);
    });
    printPageFooter(visible.length, entries.length > limit, "Use --limit N, --verbose, --json, or browser gallery get <id> for details.");
  });

galleryCmd
  .command("get <id>")
  .description("Show gallery entry details")
  .option("--json", "Output full entry as JSON")
  .action(async (id: string, opts: { json?: boolean }) => {
    const { getEntry } = await import("../../db/gallery.js");
    const entry = getEntry(id);
    if (!entry) { console.log(chalk.red(`Not found: ${id}`)); return; }
    if (opts.json) {
      console.log(JSON.stringify(entry, null, 2));
      return;
    }
    console.log(`${entry.id} ${chalk.cyan(entry.format ?? "?")} ${entry.width ?? "?"}x${entry.height ?? "?"}`);
    if (entry.title) console.log(chalk.gray(`  Title: ${truncate(entry.title, 120)}`));
    if (entry.url) console.log(chalk.gray(`  URL: ${entry.url}`));
    console.log(chalk.gray(`  Path: ${entry.path}`));
    if (entry.thumbnail_path) console.log(chalk.gray(`  Thumbnail: ${entry.thumbnail_path}`));
    if (entry.tags.length) console.log(chalk.gray(`  Tags: ${entry.tags.join(", ")}`));
    if (entry.notes) console.log(chalk.gray(`  Notes: ${truncate(entry.notes, 180)}`));
    printHint("Use --json for the full gallery record.");
  });

galleryCmd
  .command("tag <id> <tag>")
  .description("Add a tag to a gallery entry")
  .action(async (id: string, tag: string) => {
    const { tagEntry } = await import("../../db/gallery.js");
    const entry = tagEntry(id, tag);
    console.log(chalk.green(`✓ Tagged: ${entry?.tags.join(", ")}`));
  });

galleryCmd
  .command("search <query>")
  .description("Search gallery by URL, title, notes, or tags")
  .option("--limit <n>", "Max results", "10")
  .option("--json", "Output as JSON")
  .option("--verbose", "Show full URLs")
  .action(async (query: string, opts: { limit: string; json?: boolean; verbose?: boolean }) => {
    const { searchEntries } = await import("../../db/gallery.js");
    const limit = parseLimit(opts.limit, 10);
    const results = searchEntries(query, limit + 1);
    const visible = results.slice(0, limit);
    if (opts.json) {
      console.log(JSON.stringify({ entries: visible, count: visible.length, limit, truncated: results.length > limit }, null, 2));
      return;
    }
    if (results.length === 0) { console.log(chalk.gray("No results")); return; }
    visible.forEach((e) => console.log(`${shortId(e.id)} ${truncate(e.title, 48)} ${chalk.gray(truncate(e.url, opts.verbose ? 120 : 64))}`));
    printPageFooter(visible.length, results.length > limit, "Use --limit N, --verbose, --json, or browser gallery get <id> for details.");
  });

galleryCmd
  .command("diff <id1> <id2>")
  .description("Pixel-diff two gallery screenshots")
  .option("--output <path>", "Save diff image to path")
  .action(async (id1: string, id2: string, opts: { output?: string }) => {
    const { getEntry } = await import("../../db/gallery.js");
    const { diffImages } = await import("../../lib/gallery-diff.js");
    const e1 = getEntry(id1);
    const e2 = getEntry(id2);
    if (!e1 || !e2) { console.log(chalk.red("One or both entries not found")); return; }
    const result = await diffImages(e1.path, e2.path);
    if (opts.output) {
      const { copyFileSync } = await import("node:fs");
      copyFileSync(result.diff_path, opts.output);
      console.log(chalk.green(`✓ Diff saved: ${opts.output}`));
    }
    console.log(chalk.blue(`Changed pixels: ${result.changed_pixels} / ${result.total_pixels} (${result.changed_percent.toFixed(2)}%)`));
  });

galleryCmd
  .command("stats")
  .description("Show gallery statistics")
  .option("--project <id>", "Filter by project")
  .action(async (opts: { project?: string }) => {
    const { getGalleryStats } = await import("../../db/gallery.js");
    const stats = getGalleryStats(opts.project);
    console.log(chalk.bold("Gallery Stats:"));
    console.log(`  Total:     ${stats.total}`);
    console.log(`  Favorites: ${stats.favorites}`);
    console.log(`  Size:      ${(stats.total_size_bytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Formats:   ${JSON.stringify(stats.by_format)}`);
  });

galleryCmd
  .command("clean")
  .description("Delete gallery entries with missing files")
  .action(async () => {
    const { listEntries, deleteEntry } = await import("../../db/gallery.js");
    const { existsSync } = await import("node:fs");
    const entries = listEntries({ limit: 9999 });
    let removed = 0;
    for (const e of entries) {
      if (!existsSync(e.path)) { deleteEntry(e.id); removed++; }
    }
    console.log(chalk.green(`✓ Cleaned ${removed} orphaned entries`));
  });

// ─── downloads ────────────────────────────────────────────────────────────────

const downloadsCmd = program.command("downloads").description("Manage downloads folder");

downloadsCmd
  .command("list")
  .description("List downloaded files")
  .option("--json", "Output as JSON")
  .option("--limit <n>", "Max rows to print in compact output", String(20))
  .option("--verbose", "Show full paths")
  .action(async (opts: { json?: boolean; limit?: string; verbose?: boolean }) => {
    const { listDownloads } = await import("../../lib/downloads.js");
    const files = listDownloads();
    if (opts.json) {
      console.log(JSON.stringify({ downloads: files, count: files.length }, null, 2));
      return;
    }
    if (files.length === 0) { console.log(chalk.gray("No downloads")); return; }
    const { visible } = limited(files, parseLimit(opts.limit));
    visible.forEach((f) => {
      const path = opts.verbose ? ` ${chalk.gray(truncate(f.path, 90))}` : "";
      console.log(`${shortId(f.id)} ${chalk.cyan(f.type)} ${chalk.gray(formatBytes(f.size_bytes))} ${truncate(f.filename, 64)}${path}`);
    });
    printListFooter(files.length, visible.length, "Use --limit N, --verbose, --json, or browser downloads export <id> <target> for details.");
  });

downloadsCmd
  .command("clean")
  .description("Delete downloads older than N days")
  .option("--days <n>", "Age threshold in days", "7")
  .action(async (opts: { days: string }) => {
    const { cleanStaleDownloads } = await import("../../lib/downloads.js");
    const count = cleanStaleDownloads(parseInt(opts.days));
    console.log(chalk.green(`✓ Deleted ${count} stale download(s)`));
  });

downloadsCmd
  .command("export <id> <target>")
  .description("Copy a download to a target path")
  .action(async (id: string, target: string) => {
    const { exportToPath } = await import("../../lib/downloads.js");
    const path = exportToPath(id, target);
    console.log(chalk.green(`✓ Exported to: ${path}`));
  });

// ─── install-browser ──────────────────────────────────────────────────────────

program
  .command("install-browser")
  .description("Install a browser engine")
  .option("--engine <engine>", "Engine to install: lightpanda|chromium", "chromium")
  .action(async (opts: { engine: string }) => {
    if (opts.engine === "chromium") {
      const { execSync } = await import("node:child_process");
      console.log(chalk.gray("Installing Chromium via Playwright..."));
      execSync("bunx playwright install chromium", { stdio: "inherit" });
      console.log(chalk.green("✓ Chromium installed"));
    } else if (opts.engine === "lightpanda") {
      console.log(chalk.yellow("Lightpanda must be installed manually."));
      console.log("Visit: https://github.com/lightpanda-io/lightpanda/releases");
      console.log("Or set LIGHTPANDA_BINARY env var to point to the binary.");
      if (isLightpandaAvailable()) {
        console.log(chalk.green("✓ Lightpanda is already available"));
      }
    }
  });

// ─── daemon ─────────────────────────────────────────────────────────────────

const daemonCmd = program.command("daemon").description("Manage the browser daemon (persistent background sessions)");

daemonCmd
  .command("start")
  .description("Start the browser daemon in the background")
  .option("--port <port>", "Port to listen on", "7030")
  .action(async (opts: { port: string }) => {
    const { isDaemonRunning, getDaemonPidFile, getDaemonStatus } = await import("../../lib/daemon-client.js");
    if (isDaemonRunning()) {
      console.log(chalk.yellow("Daemon is already running."));
      const status = await getDaemonStatus();
      console.log(chalk.gray(`  PID: ${status.pid}, Port: ${status.port}, Sessions: ${status.sessions ?? "?"}`));
      return;
    }

    const { spawn } = await import("node:child_process");
    const { dirname } = await import("node:path");
    const { ensureOwnerOnlyDir, writeOwnerOnlyFile } = await import("../../lib/security.js");

    const pidFile = getDaemonPidFile();
    ensureOwnerOnlyDir(dirname(pidFile));

    // Spawn the REST server as a detached background process
    const child = spawn(process.execPath, [import.meta.dir + "/../../server/index.js"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, BROWSER_SERVER_PORT: opts.port },
    });
    child.unref();

    if (child.pid) {
      writeOwnerOnlyFile(pidFile, String(child.pid));
      // Wait a moment for server to start
      await new Promise(r => setTimeout(r, 1500));
      console.log(chalk.green(`✓ Daemon started`));
      console.log(chalk.gray(`  PID: ${child.pid}, Port: ${opts.port}`));
      console.log(chalk.gray(`  Sessions will persist across CLI invocations.`));
      console.log(chalk.gray(`  Stop with: browser daemon stop`));
    } else {
      console.log(chalk.red("Failed to start daemon"));
    }
  });

daemonCmd
  .command("stop")
  .description("Stop the browser daemon")
  .action(async () => {
    const { isDaemonRunning, getDaemonPid, getDaemonPidFile } = await import("../../lib/daemon-client.js");
    const { unlinkSync } = await import("node:fs");

    if (!isDaemonRunning()) {
      console.log(chalk.gray("Daemon is not running."));
      return;
    }

    const pid = getDaemonPid();
    if (pid) {
      try { process.kill(pid, "SIGTERM"); } catch {}
      try { unlinkSync(getDaemonPidFile()); } catch {}
      console.log(chalk.green(`✓ Daemon stopped (PID: ${pid})`));
    }
  });

daemonCmd
  .command("status")
  .description("Check daemon status")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const { getDaemonStatus } = await import("../../lib/daemon-client.js");
    const status = await getDaemonStatus();

    if (opts.json) {
      console.log(JSON.stringify(status, null, 2));
    } else if (status.running) {
      console.log(chalk.green("● Daemon running"));
      console.log(chalk.gray(`  PID: ${status.pid}`));
      console.log(chalk.gray(`  Port: ${status.port}`));
      if (status.sessions != null) console.log(chalk.gray(`  Active sessions: ${status.sessions}`));
      if (status.uptime_ms != null) console.log(chalk.gray(`  Uptime: ${Math.round(status.uptime_ms / 1000)}s`));
    } else {
      console.log(chalk.gray("○ Daemon not running"));
      console.log(chalk.gray(`  Start with: browser daemon start`));
    }
  });

// ─── mcp ─────────────────────────────────────────────────────────────────────

program
  .command("mcp")
  .description("Start the MCP server (stdio)")
  .action(async () => {
    await import("../../mcp/index.js");
  });

// ─── serve ────────────────────────────────────────────────────────────────────

program
  .command("serve")
  .description("Start the REST API server")
  .option("--port <port>", "Port to listen on", "7030")
  .action(async (opts: { port: string }) => {
    process.env["BROWSER_SERVER_PORT"] = opts.port;
    await import("../../server/index.js");
  });

// ─── feedback ─────────────────────────────────────────────────────────────────

const feedbackCmd = program.command("feedback").description("Send feedback about @hasna/browser");

feedbackCmd
  .command("send <message>")
  .description("Send feedback or report a bug")
  .option("--email <email>", "Your email (optional)")
  .action(async (message: string, opts: { email?: string }) => {
    const { getDatabase, saveFeedback } = await import("../../db/schema.js");
    const db = getDatabase();
    saveFeedback({ service: "browser", message, email: opts.email }, db);
    console.log(chalk.green("✓ Feedback saved. Thank you!"));
  });

feedbackCmd
  .command("list")
  .description("List saved feedback")
  .option("--json", "Output as JSON")
  .option("--limit <n>", "Max rows to print in compact output", "20")
  .option("--verbose", "Show longer messages")
  .action(async (opts: { json?: boolean; limit: string; verbose?: boolean }) => {
    const { getDatabase } = await import("../../db/schema.js");
    const db = getDatabase();
    try {
      const limit = parseLimit(opts.limit);
      const rows = db.prepare("SELECT id, message, email, created_at FROM feedback ORDER BY created_at DESC LIMIT ?").all(limit + 1) as Array<{ id: string; message: string; email?: string; created_at: string }>;
      if (opts.json) {
        console.log(JSON.stringify({ feedback: rows.slice(0, limit), count: Math.min(rows.length, limit), truncated: rows.length > limit }, null, 2));
        return;
      }
      if (rows.length === 0) { console.log(chalk.gray("No feedback entries")); return; }
      const visible = rows.slice(0, limit);
      visible.forEach((r) => {
        console.log(`${shortId(r.id)} ${truncate(r.message, opts.verbose ? 180 : 80)}${r.email ? chalk.gray(` <${truncate(r.email, 36)}>`): ""} ${chalk.gray(formatDate(r.created_at))}`);
      });
      printPageFooter(visible.length, rows.length > limit, "Use --limit N, --verbose, or --json for more feedback detail.");
    } catch {
      console.log(chalk.gray("No feedback entries"));
    }
  });

} // end register
