# Local Capacity Forecasts

Capacity forecasts combine local task estimates, actual minutes, due dates, and
agent capacity profiles. They help agents decide whether a plan is realistic
without sending planning data anywhere.

```bash
todos capacity set codex --minutes-per-day 240 --days 1,2,3,4,5 --json
todos capacity list --json
todos capacity forecast --plan <plan-id> --agent codex --start-date 2026-06-01 --json
todos capacity forecast --project <project-id> --format markdown
todos capacity remove codex --json
```

Forecast output includes:

- total and remaining estimated minutes
- actual and logged minutes
- daily capacity used for the calculation
- estimated work days and projected completion date
- missing estimate count
- overdue open task count
- risk flags such as `missing_estimates`, `no_capacity`, and
  `forecast_past_due`

MCP clients can use `set_capacity_profile`, `list_capacity_profiles`,
`remove_capacity_profile`, and `get_planning_forecast` for the same local data.
