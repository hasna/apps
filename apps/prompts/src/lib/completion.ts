
const SUBCOMMANDS = [
  "save", "use", "get", "list", "search", "render", "templates", "inspect",
  "update", "delete", "history", "restore", "collections", "move",
  "pin", "unpin", "copy", "recent", "stale", "unused", "lint", "stats",
  "export", "import", "import-slash-commands", "watch", "similar", "diff",
  "duplicate", "trending", "audit", "completion", "project",
]

const GLOBAL_OPTIONS = ["--json", "--project"]
const SOURCES = ["manual", "ai-session", "imported"]

export function generateZshCompletion(): string {
  return `#compdef prompts

_prompts() {
  local state line
  typeset -A opt_args

  _arguments \\
    '--json[Output as JSON]' \\
    '--project[Active project]:project:->projects' \\
    '1:command:->commands' \\
    '*::args:->args'

  case $state in
    commands)
      local commands=(${SUBCOMMANDS.map((c) => `'${c}'`).join(" ")})
      _describe 'command' commands
      ;;
    projects)
      local projects=($(prompts project list --json 2>/dev/null | command grep -o '"slug":"[^"]*"' | cut -d'"' -f4))
      _describe 'project' projects
      ;;
    args)
      case $line[1] in
        use|get|copy|pin|unpin|inspect|history|diff|duplicate|similar)
          local slugs=($(prompts list --json 2>/dev/null | command grep -o '"slug":"[^"]*"' | cut -d'"' -f4))
          _describe 'prompt' slugs
          ;;
        save|update)
          _arguments \\
            '-b[Body]:body:' \\
            '-f[File]:file:_files' \\
            '-s[Slug]:slug:' \\
            '-d[Description]:description:' \\
            '-c[Collection]:collection:($(prompts collections --json 2>/dev/null | command grep -o '"name":"[^"]*"' | cut -d'"' -f4))' \\
            '-t[Tags]:tags:' \\
            '--source[Source]:source:(${SOURCES.join(" ")})' \\
            '--pin[Pin immediately]' \\
            '--force[Force save]'
          ;;
        list|search)
          _arguments \\
            '-c[Collection]:collection:($(prompts collections --json 2>/dev/null | command grep -o '"name":"[^"]*"' | cut -d'"' -f4))' \\
            '-t[Tags]:tags:' \\
            '--templates[Templates only]' \\
            '--recent[Sort by recent]' \\
            '-n[Limit]:number:'
          ;;
        move)
          local slugs=($(prompts list --json 2>/dev/null | command grep -o '"slug":"[^"]*"' | cut -d'"' -f4))
          _describe 'prompt' slugs
          ;;
        restore)
          local slugs=($(prompts list --json 2>/dev/null | command grep -o '"slug":"[^"]*"' | cut -d'"' -f4))
          _describe 'prompt' slugs
          ;;
        completion)
          _arguments '1:shell:(zsh bash)'
          ;;
      esac
      ;;
  esac
}

_prompts
`
}

export function generateBashCompletion(): string {
  return `_prompts_completions() {
  local cur prev words
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  local subcommands="${SUBCOMMANDS.join(" ")}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=($(compgen -W "\${subcommands}" -- "\${cur}"))
    return 0
  fi

  case "\${prev}" in
    --project)
      local projects=$(prompts project list --json 2>/dev/null | grep -o '"slug":"[^"]*"' | cut -d'"' -f4)
      COMPREPLY=($(compgen -W "\${projects}" -- "\${cur}"))
      return 0
      ;;
    -c)
      local cols=$(prompts collections --json 2>/dev/null | grep -o '"name":"[^"]*"' | cut -d'"' -f4)
      COMPREPLY=($(compgen -W "\${cols}" -- "\${cur}"))
      return 0
      ;;
    --source)
      COMPREPLY=($(compgen -W "${SOURCES.join(" ")}" -- "\${cur}"))
      return 0
      ;;
  esac

  local cmd="\${COMP_WORDS[1]}"
  case "\${cmd}" in
    use|get|copy|pin|unpin|inspect|history|diff|duplicate|similar|render|restore|move|update|delete)
      local slugs=$(prompts list --json 2>/dev/null | grep -o '"slug":"[^"]*"' | cut -d'"' -f4)
      COMPREPLY=($(compgen -W "\${slugs}" -- "\${cur}"))
      ;;
    completion)
      COMPREPLY=($(compgen -W "zsh bash" -- "\${cur}"))
      ;;
    *)
      COMPREPLY=($(compgen -W "${GLOBAL_OPTIONS.join(" ")}" -- "\${cur}"))
      ;;
  esac
}

complete -F _prompts_completions prompts
`
}
