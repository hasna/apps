# Cleanup loop

## Procedure
Remove only generated temporary files.
Confirm the source tree remains unchanged.

## Commands
```sh
git clean -ndX
```

## Output schema
```json
{
  "removed": ["string"]
}
```
