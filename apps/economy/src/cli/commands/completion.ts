const TOP_LEVEL = [
  'sync', 'today', 'week', 'month', 'all', 'sessions', 'top', 'watch',
  'budget', 'project', 'pricing', 'goal', 'billing', 'cloud', 'machines',
  'usage', 'savings', 'subscriptions', 'status', 'doctor', 'init', 'estimate',
  'fleet', 'todos', 'serve', 'mcp', 'completion', 'tui', 'waybar', 'bar',
] as const

const AGENTS = [
  'claude', 'takumi', 'codex', 'gemini', 'opencode', 'cursor', 'pi', 'hermes',
] as const

function bashCompletion(): string {
  return `# economy bash completion
_economy_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local cmds="${TOP_LEVEL.join(' ')}"
  local agents="${AGENTS.join(' ')}"

  if [[ "\${COMP_CWORD}" -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${cmds}" -- "\${cur}") )
    return
  fi

  case "\${COMP_WORDS[1]}" in
    sync|watch|usage|savings|sessions|top)
      if [[ "\${prev}" == "--agent" ]]; then
        COMPREPLY=( $(compgen -W "\${agents}" -- "\${cur}") )
      else
        COMPREPLY=( $(compgen -W "--agent --json --verbose" -- "\${cur}") )
      fi
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") )
      ;;
    cloud)
      COMPREPLY=( $(compgen -W "push pull sync schedule" -- "\${cur}") )
      ;;
    *)
      COMPREPLY=()
      ;;
  esac
}
complete -F _economy_completions economy
`
}

function zshCompletion(): string {
  return `#compdef economy

local -a commands agents
commands=(${TOP_LEVEL.map((c) => `'${c}'`).join(' ')})
agents=(${AGENTS.map((a) => `'${a}'`).join(' ')})

_arguments -C \\
  '1: :->cmd' \\
  '*::arg:->args'

case $state in
  cmd)
    _describe 'command' commands
    ;;
  args)
    case $words[1] in
      sync|watch|usage|savings|sessions|top)
        _arguments '--agent[agent]:agent:($agents)' '--json' '--verbose'
        ;;
      completion)
        _arguments '1: :(bash zsh fish)'
        ;;
      cloud)
        _arguments '1: :(push pull sync schedule)'
        ;;
    esac
    ;;
esac
`
}

function fishCompletion(): string {
  const lines = [
    'complete -c economy -f',
    ...TOP_LEVEL.map((c) => `complete -c economy -n '__fish_use_subcommand' -a '${c}'`),
    ...AGENTS.map((a) => `complete -c economy -n '__fish_seen_subcommand_from sync watch usage savings sessions top' -l agent -a '${a}'`),
    "complete -c economy -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'",
    "complete -c economy -n '__fish_seen_subcommand_from cloud' -a 'push pull sync schedule'",
  ]
  return lines.join('\n') + '\n'
}

export function printCompletion(shell: string): void {
  switch (shell) {
    case 'bash':
      process.stdout.write(bashCompletion())
      break
    case 'zsh':
      process.stdout.write(zshCompletion())
      break
    case 'fish':
      process.stdout.write(fishCompletion())
      break
    default:
      console.error('Shell must be bash, zsh, or fish')
      process.exit(1)
  }
}
