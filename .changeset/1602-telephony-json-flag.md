---
"@hasna/telephony": patch
---

Every data command (`sms send/list/search`, `whatsapp send/send-audio/list`, `call make/list`, `voicemail list`, `number search-available/provision/list/twilio-list`, `agent register/list/get/heartbeat`, `project create/list/get`, `schedule create/ai/list/run`, `stt`, `contact add/list/search`, `webhook create/list`, `conversation`, `config`) now accepts `--json` — output is already JSON, the flag just stops being rejected by commander's unknown-option handling (hasna/apps#1602).
