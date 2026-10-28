-- Ephemeral PostgreSQL fixture for the Guest Arrival public queue migration.
-- This file is used ONLY by GitHub Actions' disposable postgres service, never production.

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END
$roles$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE
AS $function$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$function$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text LANGUAGE sql STABLE
AS $function$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '');
$function$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb LANGUAGE sql STABLE
AS $function$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$function$;

CREATE TABLE public.outlets (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_scopes (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, outlet_id)
);

CREATE OR REPLACE FUNCTION public.app_role()
RETURNS text LANGUAGE sql STABLE
AS $function$
  SELECT NULLIF(current_setting('test.app_role', true), '');
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_can_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','auth'
AS $function$
  SELECT COALESCE(
    public.app_role()='dev'
    OR EXISTS (
      SELECT 1 FROM public.user_scopes s
      JOIN public.outlets o ON o.id=s.outlet_id AND o.active
      WHERE s.user_id=auth.uid()
    ),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_current_outlet()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','auth'
AS $function$
  SELECT min(s.outlet_id::text)::uuid
  FROM public.user_scopes s
  JOIN public.outlets o ON o.id=s.outlet_id AND o.active
  WHERE s.user_id=auth.uid();
$function$;

CREATE TABLE public.guest_arrival_daily_counters (
  outlet_id uuid NOT NULL REFERENCES public.outlets(id) ON DELETE RESTRICT,
  operational_date date NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (outlet_id, operational_date)
);

CREATE TABLE public.guest_arrival_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_arrival_id uuid NOT NULL,
  actor_id uuid,
  actor_email text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  change_type text NOT NULL,
  reason text,
  old_data jsonb NOT NULL,
  new_data jsonb NOT NULL
);

CREATE TABLE public.guest_arrivals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operational_date date NOT NULL,
  queue_number integer NOT NULL CHECK (queue_number >= 1),
  guest_name text NOT NULL CHECK (length(btrim(guest_name)) > 0),
  packs integer NOT NULL CHECK (packs >= 1),
  whatsapp text,
  arrived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL CHECK (status IN ('Menunggu','Duduk','Selesai','Batalkan')),
  finished_at timestamptz,
  waiting_seconds integer,
  cancellation_reason text,
  request_id uuid NOT NULL UNIQUE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  outlet_id uuid NOT NULL REFERENCES public.outlets(id) ON DELETE RESTRICT,
  smoking_preference text NOT NULL DEFAULT 'Non Smoking'
    CHECK (smoking_preference IN ('Non Smoking','Smoking')),
  note text,
  table_name text,
  seated_at timestamptz,
  CONSTRAINT guest_arrivals_outlet_operational_queue_unique
    UNIQUE (outlet_id, operational_date, queue_number),
  CONSTRAINT guest_arrivals_wait_state_check CHECK (
    (status='Menunggu' AND seated_at IS NULL AND table_name IS NULL
      AND finished_at IS NULL AND waiting_seconds IS NULL)
    OR (status='Duduk' AND seated_at IS NOT NULL AND table_name IS NOT NULL
      AND length(btrim(table_name)) BETWEEN 1 AND 80
      AND finished_at IS NULL AND waiting_seconds IS NOT NULL AND waiting_seconds >= 0)
    OR (status='Selesai' AND finished_at IS NOT NULL AND waiting_seconds IS NOT NULL
      AND waiting_seconds >= 0
      AND ((seated_at IS NULL AND table_name IS NULL)
        OR (seated_at IS NOT NULL AND table_name IS NOT NULL
          AND length(btrim(table_name)) BETWEEN 1 AND 80)))
    OR (status='Batalkan' AND seated_at IS NULL AND table_name IS NULL
      AND finished_at IS NOT NULL AND waiting_seconds IS NOT NULL AND waiting_seconds >= 0)
  )
);

-- Match the current production privilege boundary for the serializer.
CREATE OR REPLACE FUNCTION public.guest_arrival_row_json(p_row public.guest_arrivals)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT '{}'::jsonb; $function$;
REVOKE ALL ON FUNCTION public.guest_arrival_row_json(public.guest_arrivals) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_row_json(public.guest_arrivals) TO service_role;

INSERT INTO auth.users(id,email) VALUES
  ('11111111-1111-4111-8111-111111111111','dev@example.test'),
  ('22222222-2222-4222-8222-222222222222','manager@example.test');

INSERT INTO public.outlets(id,code,name,active) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','LJN','Lazy Jennie',true),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','OUT2','Outlet Dua',true);

INSERT INTO public.user_scopes(user_id,outlet_id) VALUES
  ('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
