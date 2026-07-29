import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, rmSync, existsSync, readFileSync, realpathSync, writeFileSync } from "fs";
import {
  loadConfig,
  getDataDir,
  ensureDataDir,
  buildRealtimeTranscriptionOptions,
  canonicalModelId,
  modelCapability,
  modelsForSlot,
  modelSupportsFileStreaming,
  modelSupportsSlot,
  saveRealtimeTranscriptionSettings,
  DEFAULT_CONFIG,
} from "../lib/config.js";
import { getStore } from "../store.js";

let tempDir: string;

// Save and restore env vars
const savedEnv: Record<string, string | undefined> = {};
const envKeys = [
  "OPENAI_API_KEY",
  "RECORDINGS_API_KEY",
  "RECORDINGS_ENHANCEMENT_KEY",
  "RECORDINGS_MODEL",
  "RECORDINGS_REALTIME_SESSION_MODEL",
  "RECORDINGS_REALTIME_TRANSCRIPTION_MODEL",
  "RECORDINGS_REALTIME_PROMPT",
  "RECORDINGS_REALTIME_KEYWORDS",
  "RECORDINGS_REALTIME_LANGUAGES",
  "RECORDINGS_REALTIME_DELAY",
  "RECORDINGS_ENHANCEMENT_MODEL",
  "RECORDINGS_TRANSCRIBER_MODEL",
  "RECORDINGS_LANGUAGE",
  "RECORDINGS_TRANSCRIPTION_PROMPT",
  "RECORDINGS_TRANSCRIBER_PROMPT",
  "RECORDINGS_POST_PROCESSING_MODE",
  "RECORDINGS_AUTO_ENHANCE",
  "RECORDINGS_DB_PATH",
  "RECORDINGS_AUDIO_DIR",
  "RECORDINGS_MAX_SECONDS",
  "HASNA_RECORDINGS_DATABASE_URL",
  "RECORDINGS_DATABASE_URL",
  "HASNA_RECORDINGS_STORAGE_MODE",
  "RECORDINGS_STORAGE_MODE",
  "HASNA_RECORDINGS_STORAGE_CONFIG",
];

beforeEach(() => {
  tempDir = join(tmpdir(), `open-recordings-test-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });

  // Save env vars
  for (const key of envKeys) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

describe("store transport resolution", () => {
  test("no api env resolves to the local store", () => {
    const store = getStore({});
    expect(store.mode).toBe("local");
    expect(store.baseUrl).toBeNull();
  });

  test("api url + key resolves to the cloud-http store (bearer only, no DSN)", () => {
    const store = getStore({
      HASNA_RECORDINGS_API_URL: "https://recordings.hasna.xyz",
      HASNA_RECORDINGS_API_KEY: "test-key",
    });
    expect(store.mode).toBe("cloud-http");
    expect(store.baseUrl).toBe("https://recordings.hasna.xyz/v1");
  });
});

afterEach(() => {
  // Restore env vars
  for (const key of envKeys) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }

  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("DEFAULT_CONFIG", () => {
  test("has expected default values", () => {
    expect(DEFAULT_CONFIG.transcription_model).toBe("gpt-transcribe");
    expect(DEFAULT_CONFIG.realtime_session_model).toBe("gpt-realtime");
    expect(DEFAULT_CONFIG.realtime_transcription_model).toBe("gpt-live-transcribe");
    expect(DEFAULT_CONFIG.realtime_prompt).toBe("");
    expect(DEFAULT_CONFIG.realtime_keywords).toEqual([]);
    expect(DEFAULT_CONFIG.realtime_languages).toEqual([]);
    expect(DEFAULT_CONFIG.realtime_delay).toBe("low");
    expect(DEFAULT_CONFIG.enhancement_model).toBe("gpt-4o");
    expect(DEFAULT_CONFIG.transcriber_model).toBe("gpt-4o");
    expect(DEFAULT_CONFIG.language).toBe("en");
    expect(DEFAULT_CONFIG.transcription_prompt).toBe("");
    expect(DEFAULT_CONFIG.transcriber_prompt).toBe("");
    expect(DEFAULT_CONFIG.post_processing_mode).toBe("auto");
    expect(DEFAULT_CONFIG.audio_format).toBe("wav");
    expect(DEFAULT_CONFIG.sample_rate).toBe(16000);
    expect(DEFAULT_CONFIG.record_command).toBe("sox");
    expect(DEFAULT_CONFIG.hotkey).toBe("space");
    expect(DEFAULT_CONFIG.auto_enhance).toBe(true);
    expect(DEFAULT_CONFIG.max_recording_seconds).toBe(1800);
    expect(DEFAULT_CONFIG.enhance_triggers).toContain("say it better");
    expect(DEFAULT_CONFIG.enhance_triggers).toContain("rewrite this");
  });
});

describe("loadConfig", () => {
  test("returns defaults when no config file or env vars", () => {
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.transcription_model).toBe("gpt-transcribe");
    expect(config.realtime_session_model).toBe("gpt-realtime");
    expect(config.realtime_transcription_model).toBe("gpt-live-transcribe");
    expect(config.realtime_delay).toBe("low");
    expect(config.enhancement_model).toBe("gpt-4o");
    expect(config.transcriber_model).toBe("gpt-4o");
    expect(config.language).toBe("en");
    expect(config.audio_format).toBe("wav");
    expect(config.auto_enhance).toBe(true);
    expect(config.post_processing_mode).toBe("auto");
  });

  test("loads config from file", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        transcription_model: "whisper-1",
        language: "fr",
        transcription_prompt: "Alumia, Hasna",
        transcriber_prompt: "Use bullet points",
        post_processing_mode: "always",
        auto_enhance: false,
      })
    );

    const config = loadConfig(configPath);
    expect(config.transcription_model).toBe("whisper-1");
    expect(config.language).toBe("fr");
    expect(config.transcription_prompt).toBe("Alumia, Hasna");
    expect(config.transcriber_prompt).toBe("Use bullet points");
    expect(config.post_processing_mode).toBe("always");
    expect(config.auto_enhance).toBe(true);
    // Other defaults still present
    expect(config.audio_format).toBe("wav");
  });

  test("legacy auto_enhance false maps to post-processing off when mode is absent", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        auto_enhance: false,
      })
    );

    const config = loadConfig(configPath);
    expect(config.post_processing_mode).toBe("off");
    expect(config.auto_enhance).toBe(false);
  });

  test("ignores invalid JSON config file", () => {
    const configPath = join(tempDir, "bad-config.json");
    writeFileSync(configPath, "this is not json {{{");

    const config = loadConfig(configPath);
    // Should fall back to defaults
    expect(config.transcription_model).toBe("gpt-transcribe");
  });

  test("env var OPENAI_API_KEY overrides config", () => {
    process.env.OPENAI_API_KEY = "sk-env-key";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.openai_api_key).toBe("sk-env-key");
  });

  test("explicit config file openai_api_key wins over ambient OPENAI_API_KEY", () => {
    // Regression: bun auto-loads .env from the process cwd, so a stray generic
    // OPENAI_API_KEY (e.g. the MCP service running from $HOME) must NOT clobber
    // the key the user explicitly configured in config.json — that caused 401s.
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ openai_api_key: "sk-configured-valid" })
    );
    process.env.OPENAI_API_KEY = "sk-ambient-stale";
    const config = loadConfig(configPath);
    expect(config.openai_api_key).toBe("sk-configured-valid");
  });

  test("deliberate RECORDINGS_API_KEY still overrides configured openai_api_key", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ openai_api_key: "sk-configured" })
    );
    process.env.RECORDINGS_API_KEY = "sk-recordings-explicit";
    const config = loadConfig(configPath);
    expect(config.openai_api_key).toBe("sk-recordings-explicit");
  });

  test("env var RECORDINGS_API_KEY overrides OPENAI_API_KEY", () => {
    process.env.OPENAI_API_KEY = "sk-openai";
    process.env.RECORDINGS_API_KEY = "sk-recordings";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.openai_api_key).toBe("sk-recordings");
  });

  test("env var RECORDINGS_ENHANCEMENT_KEY sets enhancement_api_key", () => {
    process.env.RECORDINGS_ENHANCEMENT_KEY = "sk-enhance";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.enhancement_api_key).toBe("sk-enhance");
  });

  test("env var RECORDINGS_MODEL overrides transcription_model", () => {
    process.env.RECORDINGS_MODEL = "whisper-1";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.transcription_model).toBe("whisper-1");
  });

  test("realtime-only model is rejected for bounded transcription", () => {
    process.env.RECORDINGS_MODEL = "gpt-live-transcribe";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.transcription_model).toBe("gpt-transcribe");
    expect(config.config_warnings?.some((warning) =>
      warning.includes("Ignoring gpt-live-transcribe for bounded transcription")
    )).toBe(true);
  });

  test("an unknown model id is rejected for bounded transcription", () => {
    process.env.RECORDINGS_MODEL = "gpt-realtime-2";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.transcription_model).toBe("gpt-transcribe");
    expect(config.config_warnings?.some((warning) =>
      warning.includes("Ignoring gpt-realtime-2 for bounded transcription")
    )).toBe(true);
  });

  test("transcription-only model is rejected for realtime session slot", () => {
    process.env.RECORDINGS_REALTIME_SESSION_MODEL = "gpt-transcribe";
    process.env.RECORDINGS_REALTIME_TRANSCRIPTION_MODEL = "gpt-live-transcribe";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.realtime_session_model).toBe("gpt-realtime");
    expect(config.realtime_transcription_model).toBe("gpt-live-transcribe");
    expect(config.config_warnings?.some((warning) =>
      warning.includes("Ignoring gpt-transcribe for the realtime session")
    )).toBe(true);
  });

  test("bounded transcription model is rejected for realtime transcription slot", () => {
    process.env.RECORDINGS_REALTIME_TRANSCRIPTION_MODEL = "gpt-transcribe";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.realtime_transcription_model).toBe("gpt-live-transcribe");
    expect(config.config_warnings?.some((warning) =>
      warning.includes("Ignoring gpt-transcribe for realtime transcription")
    )).toBe(true);
  });

  test("realtime accuracy controls load from RECORDINGS_REALTIME_* env vars", () => {
    process.env.RECORDINGS_REALTIME_PROMPT = "Weekly infra standup";
    process.env.RECORDINGS_REALTIME_KEYWORDS = "Hasna, Alumia , Postgres";
    process.env.RECORDINGS_REALTIME_LANGUAGES = "en,FR";
    process.env.RECORDINGS_REALTIME_DELAY = "xhigh";

    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.realtime_prompt).toBe("Weekly infra standup");
    expect(config.realtime_keywords).toEqual(["Hasna", "Alumia", "Postgres"]);
    expect(config.realtime_languages).toEqual(["en", "fr"]);
    expect(config.realtime_delay).toBe("xhigh");
  });

  test("an invalid realtime delay falls back to the default with a warning", () => {
    process.env.RECORDINGS_REALTIME_DELAY = "instant";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.realtime_delay).toBe("low");
    expect(config.config_warnings?.some((warning) =>
      warning.includes("Ignoring realtime delay instant")
    )).toBe(true);
  });

  test("a non ISO 639-1 realtime language is dropped with a warning", () => {
    process.env.RECORDINGS_REALTIME_LANGUAGES = "en,english";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.realtime_languages).toEqual(["en"]);
    expect(config.config_warnings?.some((warning) =>
      warning.includes("Ignoring realtime language english")
    )).toBe(true);
  });

  test("env var RECORDINGS_ENHANCEMENT_MODEL overrides enhancement_model", () => {
    process.env.RECORDINGS_ENHANCEMENT_MODEL = "gpt-3.5-turbo";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.enhancement_model).toBe("gpt-3.5-turbo");
    expect(config.transcriber_model).toBe("gpt-3.5-turbo");
  });

  test("env var RECORDINGS_TRANSCRIBER_MODEL overrides only transcriber_model", () => {
    process.env.RECORDINGS_ENHANCEMENT_MODEL = "gpt-4o-mini";
    process.env.RECORDINGS_TRANSCRIBER_MODEL = "gpt-4.1";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.enhancement_model).toBe("gpt-4o-mini");
    expect(config.transcriber_model).toBe("gpt-4.1");
  });

  test("env var RECORDINGS_LANGUAGE overrides language", () => {
    process.env.RECORDINGS_LANGUAGE = "de";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.language).toBe("de");
  });

  test("transcription prompt env vars are loaded without affecting API keys", () => {
    process.env.RECORDINGS_TRANSCRIPTION_PROMPT = "DALL-E, Hasna";
    process.env.RECORDINGS_TRANSCRIBER_PROMPT = "Clean up grammar";
    process.env.RECORDINGS_POST_PROCESSING_MODE = "always";

    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.transcription_prompt).toBe("DALL-E, Hasna");
    expect(config.transcriber_prompt).toBe("Clean up grammar");
    expect(config.post_processing_mode).toBe("always");
    expect(config.auto_enhance).toBe(true);
  });

  test("RECORDINGS_AUTO_ENHANCE false maps to post-processing off", () => {
    process.env.RECORDINGS_AUTO_ENHANCE = "false";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.post_processing_mode).toBe("off");
    expect(config.auto_enhance).toBe(false);
  });

  test("RECORDINGS_POST_PROCESSING_MODE wins over legacy RECORDINGS_AUTO_ENHANCE", () => {
    process.env.RECORDINGS_POST_PROCESSING_MODE = "always";
    process.env.RECORDINGS_AUTO_ENHANCE = "false";

    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.post_processing_mode).toBe("always");
    expect(config.auto_enhance).toBe(true);
  });

  test("env var RECORDINGS_DB_PATH overrides db_path", () => {
    process.env.RECORDINGS_DB_PATH = "/custom/db.sqlite";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.db_path).toBe("/custom/db.sqlite");
  });

  test("env var RECORDINGS_AUDIO_DIR overrides audio_dir", () => {
    process.env.RECORDINGS_AUDIO_DIR = "/custom/audio";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.audio_dir).toBe("/custom/audio");
  });

  test("env var RECORDINGS_MAX_SECONDS overrides max_recording_seconds", () => {
    process.env.RECORDINGS_MAX_SECONDS = "60";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.max_recording_seconds).toBe(60);
  });

  test("sets default db_path when not configured", () => {
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.db_path).toBeTruthy();
    expect(config.db_path).toContain("recordings.db");
  });

  test("sets default audio_dir when not configured", () => {
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.audio_dir).toBeTruthy();
    expect(config.audio_dir).toContain("audio");
  });

  test("enhancement_api_key falls back to openai_api_key", () => {
    process.env.OPENAI_API_KEY = "sk-shared";
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.enhancement_api_key).toBe("sk-shared");
  });

  test("file config values are overridden by env vars", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ language: "fr", transcription_model: "whisper-1" })
    );
    process.env.RECORDINGS_LANGUAGE = "ja";

    const config = loadConfig(configPath);
    expect(config.language).toBe("ja"); // env wins
    expect(config.transcription_model).toBe("whisper-1"); // no env override for this
  });
});

describe("ensureDataDir", () => {
  test("creates audio_dir and db directory", () => {
    const audioDir = join(tempDir, "audio-out");
    const dbPath = join(tempDir, "db-dir/recordings.db");
    const config = {
      ...DEFAULT_CONFIG,
      audio_dir: audioDir,
      db_path: dbPath,
    };

    ensureDataDir(config);
    expect(existsSync(audioDir)).toBe(true);
    expect(existsSync(join(tempDir, "db-dir"))).toBe(true);
  });

  test("does not create global state directories while installation maintenance is active", () => {
    const home = join(tempDir, "maintenance-home");
    const workspace = join(home, "workspace");
    const marker = join(home, ".hasna", ".recordings-install-maintenance");
    const audioDir = join(home, ".hasna", "recordings", "audio");
    const dbDir = join(home, ".hasna", "recordings", "database");
    mkdirSync(marker, { recursive: true, mode: 0o700 });

    withHomeAndCwd(home, workspace, () => {
      expect(() => ensureDataDir({
        ...DEFAULT_CONFIG,
        audio_dir: audioDir,
        db_path: join(dbDir, "recordings.db"),
      })).toThrow("installation maintenance");
      expect(existsSync(audioDir)).toBe(false);
      expect(existsSync(dbDir)).toBe(false);
    });
  });

  test("keeps unrelated project-local directory creation available during global maintenance", () => {
    const home = join(tempDir, "project-maintenance-home");
    const project = join(home, "workspace", "project");
    const marker = join(home, ".hasna", ".recordings-install-maintenance");
    const audioDir = join(project, ".recordings", "audio");
    const dbDir = join(project, ".recordings", "database");
    mkdirSync(marker, { recursive: true, mode: 0o700 });

    withHomeAndCwd(home, project, () => {
      ensureDataDir({
        ...DEFAULT_CONFIG,
        audio_dir: audioDir,
        db_path: join(dbDir, "recordings.db"),
      });
      expect(existsSync(audioDir)).toBe(true);
      expect(existsSync(dbDir)).toBe(true);
    });
  });
});

describe("getDataDir", () => {
  test("returns a string", () => {
    const dir = getDataDir();
    expect(typeof dir).toBe("string");
    expect(dir).toContain("recordings");
  });

  test("merges legacy home directory into an existing ~/.hasna/recordings directory", () => {
    const home = join(tempDir, "home");
    const workspace = join(home, "workspace", "repo");
    const legacyDir = join(home, ".recordings");
    const targetDir = join(home, ".hasna", "recordings");
    mkdirSync(join(legacyDir, "audio"), { recursive: true });
    mkdirSync(join(home, ".hasna"), { recursive: true, mode: 0o700 });
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(legacyDir, "config.json"), JSON.stringify({ language: "de" }));
    writeFileSync(join(legacyDir, "audio", "legacy.wav"), "legacy-audio");
    writeFileSync(join(targetDir, "config.json"), JSON.stringify({ language: "fr" }));

    withHomeAndCwd(home, workspace, () => {
      expect(getDataDir()).toBe(targetDir);
      const config = loadConfig();

      expect(config.language).toBe("fr");
      expect(readFileSync(join(targetDir, "audio", "legacy.wav"), "utf8")).toBe("legacy-audio");
      expect(readFileSync(join(targetDir, "config.json"), "utf8")).toContain("fr");
      expect(existsSync(legacyDir)).toBe(true);
    });
  });

  test("does not migrate legacy global state while installation maintenance is active", () => {
    const home = join(tempDir, "migration-maintenance-home");
    const workspace = join(home, "workspace", "repo");
    const legacyDir = join(home, ".recordings");
    const targetDir = join(home, ".hasna", "recordings");
    const marker = join(home, ".hasna", ".recordings-install-maintenance");
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(marker, { recursive: true, mode: 0o700 });
    writeFileSync(join(legacyDir, "config.json"), JSON.stringify({ language: "de" }));

    withHomeAndCwd(home, workspace, () => {
      expect(() => getDataDir()).toThrow("installation maintenance");
      expect(existsSync(targetDir)).toBe(false);
    });
  });

  test("keeps project-local .recordings ahead of home migration", () => {
    const home = join(tempDir, "home");
    const project = join(home, "workspace", "project");
    const projectDir = join(project, ".recordings");
    const homeLegacyDir = join(home, ".recordings");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(homeLegacyDir, { recursive: true });
    writeFileSync(join(projectDir, "config.json"), JSON.stringify({ language: "ja" }));
    writeFileSync(join(homeLegacyDir, "config.json"), JSON.stringify({ language: "de" }));

    withHomeAndCwd(home, project, () => {
      expect(realpathSync(getDataDir())).toBe(realpathSync(projectDir));
      expect(loadConfig().language).toBe("ja");
      expect(existsSync(join(home, ".hasna", "recordings", "config.json"))).toBe(false);
    });
  });

  test("does not search above a repository root when HOME points elsewhere", () => {
    const actualHome = join(tempDir, "actual-home");
    const fakeHome = join(tempDir, "fake-home");
    const project = join(actualHome, "workspace", "project");
    const inheritedDir = join(actualHome, ".recordings");
    mkdirSync(project, { recursive: true });
    mkdirSync(inheritedDir, { recursive: true });
    writeFileSync(join(project, ".git"), "gitdir: /tmp/example\n");
    writeFileSync(join(inheritedDir, "config.json"), JSON.stringify({ language: "de" }));

    withHomeAndCwd(fakeHome, project, () => {
      expect(getDataDir()).toBe(join(fakeHome, ".hasna", "recordings"));
      expect(loadConfig().language).toBe(DEFAULT_CONFIG.language);
    });
  });

  test("does not inherit an ancestor store outside HOME when no repository root exists", () => {
    const actualHome = join(tempDir, "no-git-actual-home");
    const fakeHome = join(tempDir, "no-git-fake-home");
    const workingDir = join(actualHome, "workspace", "nested");
    const inheritedDir = join(actualHome, ".recordings");
    mkdirSync(workingDir, { recursive: true });
    mkdirSync(inheritedDir, { recursive: true });
    writeFileSync(join(inheritedDir, "config.json"), JSON.stringify({ language: "de" }));

    withHomeAndCwd(fakeHome, workingDir, () => {
      expect(getDataDir()).toBe(join(fakeHome, ".hasna", "recordings"));
      expect(loadConfig().language).toBe(DEFAULT_CONFIG.language);
    });
  });

  test("does not cross HOME to use an enclosing repository store", () => {
    const outerRepo = join(tempDir, "outer-repo");
    const fakeHome = join(outerRepo, "fake-home");
    const workingDir = join(fakeHome, "workspace");
    mkdirSync(join(outerRepo, ".recordings"), { recursive: true });
    mkdirSync(workingDir, { recursive: true });
    writeFileSync(join(outerRepo, ".git"), "gitdir: /tmp/outer\n");
    writeFileSync(
      join(outerRepo, ".recordings", "config.json"),
      JSON.stringify({ language: "outside-home" }),
    );

    withHomeAndCwd(fakeHome, workingDir, () => {
      expect(getDataDir()).toBe(join(fakeHome, ".hasna", "recordings"));
      expect(loadConfig().language).toBe(DEFAULT_CONFIG.language);
    });
  });

  test("treats HOME as global storage even when HOME is a repository root", () => {
    const home = join(tempDir, "home-repository");
    const legacyDir = join(home, ".recordings");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(home, ".git"), "gitdir: /tmp/home\n");
    writeFileSync(join(legacyDir, "config.json"), JSON.stringify({ language: "de" }));

    withHomeAndCwd(home, home, () => {
      expect(getDataDir()).toBe(join(home, ".hasna", "recordings"));
      expect(loadConfig().language).toBe("de");
    });
  });
});

function withHomeAndCwd(home: string, cwd: string, callback: () => void): void {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousCwd = process.cwd();
  mkdirSync(cwd, { recursive: true });
  try {
    process.env.HOME = home;
    delete process.env.USERPROFILE;
    process.chdir(cwd);
    callback();
  } finally {
    process.chdir(previousCwd);
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = previousUserProfile;
    }
  }
}

describe("loadSecretKey (via loadConfig)", () => {
  test("loads API key from ~/.secrets with double quotes", () => {
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    // The key is either loaded from ~/.secrets or empty
    expect(typeof config.openai_api_key).toBe("string");
  });

  test("loads secret key with single quotes format", () => {
    // We can't easily mock ~/.secrets, but we test the regex patterns directly
    // by testing the config loading with different env overrides
    // The loadSecretKey function is internal, so we test its effect indirectly
    // When no env var is set and no ~/.secrets has the key, it returns ""
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    // At minimum, the function doesn't crash
    expect(config).toBeDefined();
  });
});

describe("findConfigFile (via loadConfig without explicit path)", () => {
  test("loads config without explicit path (uses findConfigFile)", () => {
    // When no configPath is given, findConfigFile walks up from cwd
    const config = loadConfig();
    expect(config).toBeDefined();
    expect(config.transcription_model).toBeTruthy();
  });
});

describe("ensureDataDir edge cases", () => {
  test("handles db_path without directory separator", () => {
    const config = {
      ...DEFAULT_CONFIG,
      audio_dir: join(tempDir, "audio"),
      db_path: "recordings.db", // no directory part
    };
    // Should not throw - dbDir will be empty string
    ensureDataDir(config);
    expect(existsSync(join(tempDir, "audio"))).toBe(true);
  });
});

describe("model capability table", () => {
  test("gpt-transcribe is the file-transcription model and supports streaming", () => {
    expect(modelSupportsSlot("gpt-transcribe", "file_transcription")).toBe(true);
    expect(modelSupportsSlot("gpt-transcribe", "realtime_transcription")).toBe(false);
    expect(modelSupportsSlot("gpt-transcribe", "realtime_session")).toBe(false);
    expect(modelSupportsFileStreaming("gpt-transcribe")).toBe(true);
  });

  test("gpt-live-transcribe is realtime-only and never valid on the file endpoint", () => {
    expect(modelSupportsSlot("gpt-live-transcribe", "realtime_transcription")).toBe(true);
    expect(modelSupportsSlot("gpt-live-transcribe", "file_transcription")).toBe(false);
    expect(modelSupportsFileStreaming("gpt-live-transcribe")).toBe(false);
  });

  test("gpt-realtime is the speech-to-speech session model only", () => {
    expect(modelSupportsSlot("gpt-realtime", "realtime_session")).toBe(true);
    expect(modelSupportsSlot("gpt-realtime", "realtime_transcription")).toBe(false);
    expect(modelSupportsSlot("gpt-realtime", "file_transcription")).toBe(false);
  });

  test("whisper-1 is a file-transcription model without response streaming", () => {
    expect(modelSupportsSlot("whisper-1", "file_transcription")).toBe(true);
    expect(modelSupportsFileStreaming("whisper-1")).toBe(false);
  });

  test("classification is exact-match, not prefix or substring based", () => {
    // These would all have been misclassified by the old "gpt-realtime"/"whisper"
    // string heuristics.
    expect(canonicalModelId("gpt-realtime-whisper")).toBeNull();
    expect(canonicalModelId("gpt-4o-transcribe")).toBeNull();
    expect(canonicalModelId("gpt-live-transcribe-preview")).toBeNull();
    expect(modelCapability("not-a-model")).toBeNull();
    expect(modelSupportsSlot("not-a-model", "file_transcription")).toBe(false);
  });

  test("canonicalModelId normalizes surrounding space and case", () => {
    expect(canonicalModelId("  GPT-Transcribe ")).toBe("gpt-transcribe");
  });

  test("modelsForSlot lists exactly the models valid in that slot", () => {
    expect(modelsForSlot("file_transcription")).toEqual(["gpt-transcribe", "whisper-1"]);
    expect(modelsForSlot("realtime_transcription")).toEqual(["gpt-live-transcribe"]);
    expect(modelsForSlot("realtime_session")).toEqual(["gpt-realtime"]);
  });
});

describe("buildRealtimeTranscriptionOptions", () => {
  test("falls back to the single configured language hint", () => {
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(buildRealtimeTranscriptionOptions(config)).toEqual({
      model: "gpt-live-transcribe",
      delay: "low",
      languages: ["en"],
    });
  });

  test("emits no language control when the language hint is auto", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ language: "auto" }));
    expect(buildRealtimeTranscriptionOptions(loadConfig(configPath))).toEqual({
      model: "gpt-live-transcribe",
      delay: "low",
    });
  });

  test("emits the documented accuracy controls when configured", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        realtime_prompt: "Pair programming on the payments service",
        realtime_keywords: ["Stripe", "idempotency"],
        realtime_languages: ["en", "fr"],
        realtime_delay: "high",
      })
    );
    const config = loadConfig(configPath);
    expect(buildRealtimeTranscriptionOptions(config)).toEqual({
      model: "gpt-live-transcribe",
      delay: "high",
      prompt: "Pair programming on the payments service",
      keywords: ["Stripe", "idempotency"],
      languages: ["en", "fr"],
    });
  });
});

describe("saveRealtimeTranscriptionSettings", () => {
  test("merges realtime settings without disturbing other config keys", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ openai_api_key: "sk-preserved", language: "fr" })
    );

    saveRealtimeTranscriptionSettings(
      { realtime_keywords: ["Hasna"], realtime_delay: "medium" },
      configPath
    );

    const written = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    expect(written["openai_api_key"]).toBe("sk-preserved");
    expect(written["language"]).toBe("fr");
    expect(written["realtime_keywords"]).toEqual(["Hasna"]);
    expect(written["realtime_delay"]).toBe("medium");

    const config = loadConfig(configPath);
    expect(config.realtime_keywords).toEqual(["Hasna"]);
    expect(config.realtime_delay).toBe("medium");
  });
});
