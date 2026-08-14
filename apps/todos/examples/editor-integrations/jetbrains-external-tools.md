# JetBrains External Tools

Create these entries in `Settings > Tools > External Tools`.

| Name | Program | Arguments | Working Directory |
| --- | --- | --- | --- |
| todos ready | `todos` | `ready --json` | `$ProjectFileDir$` |
| todos active | `todos` | `active --json` | `$ProjectFileDir$` |
| todos source index | `todos` | `extract $ProjectFileDir$ --dry-run --index --json` | `$ProjectFileDir$` |
| todos file blame | `todos` | `blame $FilePath$` | `$ProjectFileDir$` |
| todos context pack | `todos` | `context-pack $Prompt$ --format markdown` | `$ProjectFileDir$` |

Use `Tools > External Tools` or assign keymaps to these commands. All recipes
use local CLI output and do not require hosted authentication.
