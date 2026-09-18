-- Additive ownership migration. Deliberately leaves all legacy tenant_id values
-- NULL. Operators provision canonical issuer tenant IDs and assign audited rows
-- separately; the API cannot provision tenants or adopt unassigned data.
-- One DO statement is atomic and repeatable, including constraint installation.
DO $calendar_tenant$
BEGIN
  CREATE TABLE IF NOT EXISTS calendar_tenants (
    id TEXT PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
    enabled BOOLEAN NOT NULL DEFAULT TRUE
  );
  ALTER TABLE orgs ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES calendar_tenants(id);
  CREATE UNIQUE INDEX IF NOT EXISTS orgs_tenant_id_id ON orgs (tenant_id, id);
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES calendar_tenants(id);
  CREATE UNIQUE INDEX IF NOT EXISTS agents_tenant_id_id ON agents (tenant_id, id);
  ALTER TABLE calendars ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES calendar_tenants(id);
  CREATE UNIQUE INDEX IF NOT EXISTS calendars_tenant_id_id ON calendars (tenant_id, id);
  ALTER TABLE events ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES calendar_tenants(id);
  CREATE UNIQUE INDEX IF NOT EXISTS events_tenant_id_id ON events (tenant_id, id);
  ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES calendar_tenants(id);
  CREATE UNIQUE INDEX IF NOT EXISTS event_attendees_tenant_id_id ON event_attendees (tenant_id, id);
  ALTER TABLE availability ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES calendar_tenants(id);
  CREATE UNIQUE INDEX IF NOT EXISTS availability_tenant_id_id ON availability (tenant_id, id);
  ALTER TABLE org_memberships ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES calendar_tenants(id);
  CREATE UNIQUE INDEX IF NOT EXISTS org_memberships_tenant_id_id ON org_memberships (tenant_id, id);
  CREATE UNIQUE INDEX IF NOT EXISTS orgs_tenant_slug ON orgs (tenant_id, slug);
  CREATE UNIQUE INDEX IF NOT EXISTS agents_tenant_name ON agents (tenant_id, name);
  CREATE UNIQUE INDEX IF NOT EXISTS calendars_tenant_id_org ON calendars (tenant_id, id, org_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'agents'::regclass AND conname = 'agents_tenant_active_org_id_fk') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_tenant_active_org_id_fk
      FOREIGN KEY (tenant_id, active_org_id) REFERENCES orgs (tenant_id, id) ON DELETE SET NULL (active_org_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'calendars'::regclass AND conname = 'calendars_tenant_org_id_fk') THEN
    ALTER TABLE calendars ADD CONSTRAINT calendars_tenant_org_id_fk
      FOREIGN KEY (tenant_id, org_id) REFERENCES orgs (tenant_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'calendars'::regclass AND conname = 'calendars_tenant_owner_id_fk') THEN
    ALTER TABLE calendars ADD CONSTRAINT calendars_tenant_owner_id_fk
      FOREIGN KEY (tenant_id, owner_id) REFERENCES agents (tenant_id, id) ON DELETE SET NULL (owner_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'events'::regclass AND conname = 'events_tenant_calendar_id_org_id_fk') THEN
    ALTER TABLE events ADD CONSTRAINT events_tenant_calendar_id_org_id_fk
      FOREIGN KEY (tenant_id, calendar_id, org_id) REFERENCES calendars (tenant_id, id, org_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'events'::regclass AND conname = 'events_tenant_org_id_fk') THEN
    ALTER TABLE events ADD CONSTRAINT events_tenant_org_id_fk
      FOREIGN KEY (tenant_id, org_id) REFERENCES orgs (tenant_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'events'::regclass AND conname = 'events_tenant_created_by_fk') THEN
    ALTER TABLE events ADD CONSTRAINT events_tenant_created_by_fk
      FOREIGN KEY (tenant_id, created_by) REFERENCES agents (tenant_id, id) ON DELETE SET NULL (created_by);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'event_attendees'::regclass AND conname = 'event_attendees_tenant_event_id_fk') THEN
    ALTER TABLE event_attendees ADD CONSTRAINT event_attendees_tenant_event_id_fk
      FOREIGN KEY (tenant_id, event_id) REFERENCES events (tenant_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'event_attendees'::regclass AND conname = 'event_attendees_tenant_agent_id_fk') THEN
    ALTER TABLE event_attendees ADD CONSTRAINT event_attendees_tenant_agent_id_fk
      FOREIGN KEY (tenant_id, agent_id) REFERENCES agents (tenant_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'availability'::regclass AND conname = 'availability_tenant_org_id_fk') THEN
    ALTER TABLE availability ADD CONSTRAINT availability_tenant_org_id_fk
      FOREIGN KEY (tenant_id, org_id) REFERENCES orgs (tenant_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'availability'::regclass AND conname = 'availability_tenant_agent_id_fk') THEN
    ALTER TABLE availability ADD CONSTRAINT availability_tenant_agent_id_fk
      FOREIGN KEY (tenant_id, agent_id) REFERENCES agents (tenant_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'org_memberships'::regclass AND conname = 'org_memberships_tenant_org_id_fk') THEN
    ALTER TABLE org_memberships ADD CONSTRAINT org_memberships_tenant_org_id_fk
      FOREIGN KEY (tenant_id, org_id) REFERENCES orgs (tenant_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'org_memberships'::regclass AND conname = 'org_memberships_tenant_agent_id_fk') THEN
    ALTER TABLE org_memberships ADD CONSTRAINT org_memberships_tenant_agent_id_fk
      FOREIGN KEY (tenant_id, agent_id) REFERENCES agents (tenant_id, id) ON DELETE CASCADE;
  END IF;
  -- Refuse direct or cascading deletes that would mutate unassigned legacy rows.
  CREATE OR REPLACE FUNCTION calendar_orgs_tenant_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
  BEGIN
    IF EXISTS (SELECT 1 FROM agents WHERE active_org_id=OLD.id AND tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      RAISE EXCEPTION 'referenced resource is not assigned to tenant' USING ERRCODE = '23503';
    END IF;
    IF EXISTS (SELECT 1 FROM calendars WHERE org_id=OLD.id AND tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      RAISE EXCEPTION 'referenced resource is not assigned to tenant' USING ERRCODE = '23503';
    END IF;
    IF EXISTS (SELECT 1 FROM events WHERE org_id=OLD.id AND tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      RAISE EXCEPTION 'referenced resource is not assigned to tenant' USING ERRCODE = '23503';
    END IF;
    IF EXISTS (SELECT 1 FROM availability WHERE org_id=OLD.id AND tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      RAISE EXCEPTION 'referenced resource is not assigned to tenant' USING ERRCODE = '23503';
    END IF;
    IF EXISTS (SELECT 1 FROM org_memberships WHERE org_id=OLD.id AND tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      RAISE EXCEPTION 'referenced resource is not assigned to tenant' USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
  END $guard$;
  DROP TRIGGER IF EXISTS calendar_orgs_tenant_delete_guard ON orgs;
  CREATE TRIGGER calendar_orgs_tenant_delete_guard BEFORE DELETE ON orgs
    FOR EACH ROW EXECUTE FUNCTION calendar_orgs_tenant_delete_guard();
  CREATE OR REPLACE FUNCTION calendar_agents_tenant_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
  BEGIN
    IF EXISTS (SELECT 1 FROM calendars WHERE owner_id=OLD.id AND tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      RAISE EXCEPTION 'referenced resource is not assigned to tenant' USING ERRCODE = '23503';
    END IF;
    IF EXISTS (SELECT 1 FROM events WHERE created_by=OLD.id AND tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      RAISE EXCEPTION 'referenced resource is not assigned to tenant' USING ERRCODE = '23503';
    END IF;
    IF EXISTS (SELECT 1 FROM event_attendees WHERE agent_id=OLD.id AND tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      RAISE EXCEPTION 'referenced resource is not assigned to tenant' USING ERRCODE = '23503';
    END IF;
    IF EXISTS (SELECT 1 FROM availability WHERE agent_id=OLD.id AND tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      RAISE EXCEPTION 'referenced resource is not assigned to tenant' USING ERRCODE = '23503';
    END IF;
    IF EXISTS (SELECT 1 FROM org_memberships WHERE agent_id=OLD.id AND tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      RAISE EXCEPTION 'referenced resource is not assigned to tenant' USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
  END $guard$;
  DROP TRIGGER IF EXISTS calendar_agents_tenant_delete_guard ON agents;
  CREATE TRIGGER calendar_agents_tenant_delete_guard BEFORE DELETE ON agents
    FOR EACH ROW EXECUTE FUNCTION calendar_agents_tenant_delete_guard();
  CREATE OR REPLACE FUNCTION calendar_calendars_tenant_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
  BEGIN
    IF EXISTS (SELECT 1 FROM events WHERE calendar_id=OLD.id AND tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      RAISE EXCEPTION 'referenced resource is not assigned to tenant' USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
  END $guard$;
  DROP TRIGGER IF EXISTS calendar_calendars_tenant_delete_guard ON calendars;
  CREATE TRIGGER calendar_calendars_tenant_delete_guard BEFORE DELETE ON calendars
    FOR EACH ROW EXECUTE FUNCTION calendar_calendars_tenant_delete_guard();
  CREATE OR REPLACE FUNCTION calendar_events_tenant_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
  BEGIN
    IF EXISTS (SELECT 1 FROM event_attendees WHERE event_id=OLD.id AND tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      RAISE EXCEPTION 'referenced resource is not assigned to tenant' USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
  END $guard$;
  DROP TRIGGER IF EXISTS calendar_events_tenant_delete_guard ON events;
  CREATE TRIGGER calendar_events_tenant_delete_guard BEFORE DELETE ON events
    FOR EACH ROW EXECUTE FUNCTION calendar_events_tenant_delete_guard();
  ALTER TABLE orgs DROP CONSTRAINT IF EXISTS orgs_slug_key;
  ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_name_key;
END $calendar_tenant$;
