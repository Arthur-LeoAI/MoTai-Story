-- Storage for the Postgres backend (src/postgres-store.js).
--
-- Everything lives in its own schema, not in "public": Supabase publishes
-- "public" through its REST API, and this application never uses that API.
-- Row level security is switched on with no policies as a second guard, so
-- the API roles see nothing even if the schema is published later. The
-- server connects as the database owner, which row level security does not
-- restrict.
--
-- Story data is stored as `json`, not `jsonb`: `json` keeps the text exactly,
-- including key order, so a story read back compares equal to the one that
-- was saved. The application compares stories as JSON text in several places.

create schema if not exists novel_studio;

create table if not exists novel_studio.schema_migrations (
  version integer primary key,
  applied_at timestamptz not null default now()
);

-- Single values: the data schema version, the store revision (moved by every
-- write; see postgres-store.js), and any other top-level value of the
-- database that has no table of its own.
create table if not exists novel_studio.store_meta (
  key text primary key,
  value json not null
);

insert into novel_studio.store_meta (key, value) values
  ('schemaVersion', '0'),
  ('storeRevision', '0')
on conflict (key) do nothing;

-- One row per story. `owner_id` and `row_version` repeat fields of `data`
-- so they can be looked up and checked without reading the story.
create table if not exists novel_studio.works (
  id text primary key,
  owner_id text not null,
  row_version integer not null,
  position bigint not null,
  data json not null,
  updated_at timestamptz not null default now()
);

create index if not exists works_owner_idx on novel_studio.works (owner_id);
create index if not exists works_position_idx on novel_studio.works (position);

-- Lists that are not part of a story: tasks, usage, import previews, receipts.
create table if not exists novel_studio.store_records (
  collection text not null,
  id text not null,
  seq bigint not null,
  data json not null,
  primary key (collection, id)
);

create index if not exists store_records_order_idx on novel_studio.store_records (collection, seq);

-- Keyed values that are not part of a story: user preferences, settings.
create table if not exists novel_studio.store_documents (
  collection text not null,
  key text not null,
  data json not null,
  primary key (collection, key)
);

alter table novel_studio.schema_migrations enable row level security;
alter table novel_studio.store_meta enable row level security;
alter table novel_studio.works enable row level security;
alter table novel_studio.store_records enable row level security;
alter table novel_studio.store_documents enable row level security;

-- Supabase's API roles get no access at all. Other Postgres servers do not
-- have these roles, so the statement only runs where they exist.
do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('revoke all on schema novel_studio from %I', api_role);
      execute format('revoke all on all tables in schema novel_studio from %I', api_role);
    end if;
  end loop;
end
$$;
