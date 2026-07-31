# Release loop

Prepare and publish the release.

## SOP
Always inspect the working tree before acting.
Never overwrite unrelated changes.
Report the verification result before finishing.

### Commands
```sh
git status --short
bun test
```

### Output format
```json
{
  "status": "ok",
  "summary": "string"
}
```
