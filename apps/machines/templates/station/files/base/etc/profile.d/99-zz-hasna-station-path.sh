# hasna-station: make stations scriptable, not only interactive.
# Measured on station17 build 3 (2026-07-30): `sudo -iu hasna bash -lc
# 'machines --version'` exited 127 — Ubuntu's stock ~/.bashrc early-returns
# for non-interactive shells BEFORE bun's PATH export line, so SSM-driven
# automation (login, non-interactive) could not find any bun-installed CLI,
# and `command -v aws` failed under a PATH lacking /usr/local/bin. A station
# automation cannot drive is not converged. /etc/profile.d runs for every
# login shell regardless of interactivity; pure non-login `sh -c` callers
# still need absolute paths or an explicit login shell.
# Managed by hasna.station_template.v1 (base layer) — do not edit in place.
case ":$PATH:" in
  *:/usr/local/bin:*) ;;
  *) PATH="/usr/local/bin:$PATH" ;;
esac
if [ -n "${HOME:-}" ] && [ -d "$HOME/.bun/bin" ]; then
  case ":$PATH:" in
    *:"$HOME/.bun/bin":*) ;;
    *) PATH="$HOME/.bun/bin:$PATH" ;;
  esac
fi
export PATH
