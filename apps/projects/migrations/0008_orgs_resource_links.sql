-- Add typed @hasna/orgs organization and project links without rewriting the
-- original closed resource-link migration checksum.

ALTER TABLE project_resource_links
  DROP CONSTRAINT IF EXISTS project_resource_links_authority_check;
ALTER TABLE project_resource_links
  DROP CONSTRAINT IF EXISTS project_resource_links_source_package_check;
ALTER TABLE project_resource_links
  DROP CONSTRAINT IF EXISTS project_resource_links_target_kind_check;

ALTER TABLE project_resource_links
  ADD CONSTRAINT project_resource_links_authority_check
  CHECK(authority IN ('todos', 'conversations', 'knowledge', 'mementos', 'orgs'));
ALTER TABLE project_resource_links
  ADD CONSTRAINT project_resource_links_source_package_check
  CHECK(source_package IN ('@hasna/todos', '@hasna/conversations', '@hasna/knowledge', '@hasna/mementos', '@hasna/orgs'));
ALTER TABLE project_resource_links
  ADD CONSTRAINT project_resource_links_target_kind_check
  CHECK(target_kind IN ('org', 'project', 'task_list', 'plan', 'channel', 'collection', 'item'));
