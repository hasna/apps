/** Test-only environment window for sequential in-process client suites. */
export function activateClientEnvironment(env: Record<string,string>): () => void {
  const relevant = (key: string) => /^(HASNA_|CONVERSATIONS_|OPEN_CONVERSATIONS_|TELEGRAM_|XDG_)/.test(key) || ["HOME", "USERPROFILE", "PATH", "TMPDIR", "NO_COLOR", "FORCE_COLOR"].includes(key);
  const keys = new Set([...Object.keys(process.env).filter(relevant), ...Object.keys(env)]);
  const saved = new Map([...keys].map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, env);
  return () => {
    for (const key of new Set([...keys, ...Object.keys(process.env).filter(relevant)])) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  };
}
