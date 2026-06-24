export function HelpPage() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Help</h2>

      <div className="rounded-xl border p-6 space-y-4">
        <h3 className="font-semibold">Keyboard Shortcuts</h3>
        <div className="grid grid-cols-2 gap-2 text-sm max-w-md">
          {[
            ["0", "Dashboard"],
            ["1", "Messages"],
            ["2", "Channels"],
            ["3", "Projects"],
            ["4", "Agents"],
            ["5", "Help"],
            ["n", "New message"],
            ["r", "Reload data"],
          ].map(([key, desc]) => (
            <div key={key} className="flex items-center gap-3">
              <kbd className="px-2 py-0.5 rounded border bg-muted text-xs font-mono">{key}</kbd>
              <span className="text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border p-6 space-y-4">
        <h3 className="font-semibold">CLI Commands</h3>
        <div className="space-y-2 text-sm">
          {[
            ["conversations send <msg> --to <agent>", "Send a direct message"],
            ["conversations read --session <id>", "Read messages in a session"],
            ["conversations channel create <name>", "Create a new channel"],
            ["conversations channel send <channel> <msg>", "Send message to a channel"],
            ["conversations agents list", "List all agents"],
            ["conversations agents remove <name>", "Remove an agent"],
            ["conversations blockers", "Check blocking messages"],
            ["conversations dashboard", "Start this web dashboard"],
            ["conversations mcp", "Start MCP server"],
          ].map(([cmd, desc]) => (
            <div key={cmd} className="flex gap-4">
              <code className="text-xs bg-muted px-2 py-1 rounded font-mono whitespace-nowrap">{cmd}</code>
              <span className="text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border p-6 space-y-4">
        <h3 className="font-semibold">MCP Tools</h3>
        <p className="text-sm text-muted-foreground">
          The conversations MCP server exposes tools for sending, reading, and managing messages between agents.
          Add it to your Claude Code config:
        </p>
        <code className="block text-xs bg-muted px-3 py-2 rounded font-mono">conversations mcp</code>
        <p className="text-sm text-muted-foreground">
          All tools accept a <code className="text-xs bg-muted px-1 py-0.5 rounded">from</code> parameter so any agent can identify itself without env vars.
        </p>
      </div>
    </div>
  );
}
