-- Add the explicit immutable Conversations channel ID locator kind without
-- rewriting the already-landed project_resource_links migration checksum.

ALTER TABLE project_resource_links
  DROP CONSTRAINT IF EXISTS project_resource_links_locator_kind_check;

ALTER TABLE project_resource_links
  ADD CONSTRAINT project_resource_links_locator_kind_check
  CHECK(locator_kind IN ('external_uuid', 'canonical_uri', 'conversations_channel_id'));
