# Device UI preferences

Emails saves appearance, read-message dimming, default mailbox/address/sender,
automatic refresh, and code/quote expansion in `config/tui-preferences.json`
under the existing Emails device data root. Attachment selection keeps its
existing `config/tui-attachments.json` file. These files contain only validated
preference fields; mailbox/domain records remain in the account API.

The preference reader does not open the legacy mail database or `config.json`.
There is no SQLite creation, registry snapshot, credential selector, or automatic
legacy-config import. Writes use private temporary files and atomic replacement,
using the same mechanism as attachment preferences. Preferences apply to this
computer; they are not synchronized to other devices.

A failed save does not undo the current UI action. Settings and the sidebar show
a warning to check the config directory's permissions. Failed choices remain
unsaved until that choice is saved successfully; the warning survives mailbox
refreshes. Invalid or unreadable preference files load defaults, and only known
validated fields are written back.
