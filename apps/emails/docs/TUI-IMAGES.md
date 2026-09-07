# Email image previews

The reader collects images from HTML (including linked images inside table cells), Markdown, embedded data URLs, CID references and image attachments. Expand an image disclosure to preview it inside the reader. Existing table cells retain their alt text; previews appear below the message body because native text-table cells cannot contain image renderables.

Embedded/CID attachment bytes come from the authenticated attachment API. External images require an explicit **Load external image** action and use a separate request with no application credentials, cookies or referrer. Redirects are refused. Preview requests accept PNG/JPEG/GIF/WebP only, with 5 MiB encoded and 4 megapixel dimension limits before native decoding. Hidden/one-pixel HTML images are omitted. The reader caps a message at 12 previews. SVG and other unsupported formats keep the image link or normal attachment actions available.

Core, Solid and Keymap are pinned together at OpenTUI 0.5.10. Protocol selection is automatic: Kitty or Sixel when supported, otherwise Unicode blocks. OpenTUI deliberately uses blocks through tmux. Ghostty supports Kitty graphics; `image-storage-limit=0` disables terminal images. Native terminal capabilities and transport determine the actual rendering protocol.

Official references checked September 7, 2026:

- [OpenTUI Image component](https://opentui.com/docs/components/image/)
- [OpenTUI native image API](https://opentui.com/docs/reference/native-image/)
- [OpenTUI 0.5.10 release](https://github.com/anomalyco/opentui/releases/tag/v0.5.10)
- [OpenTUI 0.5.10 package source](https://github.com/anomalyco/opentui/blob/v0.5.10/packages/core/package.json)
- [OpenTUI automatic protocol selection](https://github.com/anomalyco/opentui/blob/v0.5.10/packages/core/src/renderables/Image.ts)
- [Ghostty graphics support](https://ghostty.org/docs/features)
- [Ghostty image storage configuration](https://ghostty.org/docs/config/reference#image-storage-limit)

`bun scripts/demo-mail-images.tsx` opens a synthetic native demo. Supplying an output path instead creates text/span captures with `testRender`; no API or real email is accessed. The image tests exercise actual native decoding and block fallback, remote opt-in, and disclosure interactions.

Image controls join the reader keyboard focus order: Tab/Shift+Tab focuses a preview or its load action; Enter/Space expands, loads, or collapses it. The synthetic demo uses the same focus provider and verifies expansion, loading, and collapse when writing captures.
