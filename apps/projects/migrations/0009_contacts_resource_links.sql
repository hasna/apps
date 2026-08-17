-- Add typed @hasna/contacts contact links without rewriting the already
-- applied closed resource-link migration checksums.

ALTER TABLE project_resource_links
  DROP CONSTRAINT IF EXISTS project_resource_links_authority_check;
ALTER TABLE project_resource_links
  DROP CONSTRAINT IF EXISTS project_resource_links_source_package_check;
ALTER TABLE project_resource_links
  DROP CONSTRAINT IF EXISTS project_resource_links_target_kind_check;

ALTER TABLE project_resource_links
  ADD CONSTRAINT project_resource_links_authority_check
  CHECK(authority IN ('todos', 'conversations', 'knowledge', 'mementos', 'orgs', 'contacts'));
ALTER TABLE project_resource_links
  ADD CONSTRAINT project_resource_links_source_package_check
  CHECK(source_package IN ('@hasna/todos', '@hasna/conversations', '@hasna/knowledge', '@hasna/mementos', '@hasna/orgs', '@hasna/contacts'));
ALTER TABLE project_resource_links
  ADD CONSTRAINT project_resource_links_target_kind_check
  CHECK(target_kind IN ('contact', 'org', 'project', 'task_list', 'plan', 'channel', 'collection', 'item'));
