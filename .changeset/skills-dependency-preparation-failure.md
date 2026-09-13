---
"@hasna/skills": patch
---

Stop local skill execution when dependency preparation fails or times out. Drain installer output without exposing registry diagnostics, and use the selected execution environment for preparation. Programmatic callers can bound preparation with `preparationTimeoutMs`; the default is 60 seconds. Remember incomplete preparation so partially created dependencies cannot bypass a failed attempt on retry; document recovery for interrupted attempts. Forwarded skill arguments and explicit local routing are unchanged.
