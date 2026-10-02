import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export async function loadTestDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create table auth.sessions(id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;
    create schema storage; grant usage on schema storage to authenticated;
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text not null,name text not null);
    alter table storage.objects enable row level security;
    grant select,insert,delete on storage.objects to authenticated;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array(regexp_replace($1,'/[^/]+$',''),'/') $$;
    grant execute on function storage.foldername(text) to authenticated;
  `);
  for (const file of readdirSync("supabase/migrations").filter(f => f.endsWith(".sql") && !f.includes("history_cron")).sort()) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  return db;
}
