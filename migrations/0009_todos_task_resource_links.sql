-- Add exact @hasna/todos task links without rewriting prior migration checksums.
-- Authority-specific closed target kinds remain enforced by the typed contract.

ALTER TABLE project_resource_links
  DROP CONSTRAINT IF EXISTS project_resource_links_target_kind_check;

ALTER TABLE project_resource_links
  ADD CONSTRAINT project_resource_links_target_kind_check
  CHECK(target_kind IN ('org', 'project', 'task', 'task_list', 'plan', 'channel', 'collection', 'item'));
