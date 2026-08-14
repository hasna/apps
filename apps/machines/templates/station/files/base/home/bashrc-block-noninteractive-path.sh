# >>> hasna station bashrc block >>>
# Non-interactive PATH — this block must sit ABOVE Ubuntu's early-return
# interactive guard in ~/.bashrc. ssh/mosh remote commands
# (`ssh stationN codewith`, `mosh stationN codewith`) start bash NON-LOGIN and
# NON-INTERACTIVE: profile.d never runs, and the sshd-spawned bash sources
# ~/.bashrc INSTEAD of $BASH_ENV (measured on station17 2026-07-30: with
# ~/.bashrc hidden and sshd SetEnv pointing BASH_ENV at the PATH profile,
# bun-installed CLIs still did not resolve). ~/.bashrc above the guard is the
# ONLY hook that reaches these shells.
# Managed by hasna.station_template.v1 — in-place edits are overwritten.
export BUN_INSTALL="$HOME/.bun"
case ":$PATH:" in *":$HOME/.bun/bin:"*) ;; *) export PATH="$HOME/.bun/bin:$PATH";; esac
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH";; esac
# <<< hasna station bashrc block <<<
