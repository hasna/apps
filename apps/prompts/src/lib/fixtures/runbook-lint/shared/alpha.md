# Deploy loop
Prepare the deployment safely.

## Standard operating procedure
Always inspect the working tree before acting.
Never overwrite unrelated changes.
Report the verification result before finishing.

## Command inventory
```sh
git status --short
bun test
```

## Output schema
```json
{
  "status": "ok",
  "summary": "string"
}
```
