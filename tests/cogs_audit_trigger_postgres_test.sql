\set ON_ERROR_STOP on

-- Isolated PostgreSQL fixture for GitHub Actions only. Never run this fixture against Supabase.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;

CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE
AS $$ SELECT jsonb_build_object('email', nullif(current_setting('request.jwt.claim.email', true), '')) $$;

CREATE TABLE public.audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor uuid,
  actor_email text,
  action text NOT NULL,
  table_name text,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  reason text
);

CREATE TABLE public.cogs_wip (
  id uuid PRIMARY KEY,
  division_id uuid NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.cogs_wip_recipe_lines (
  id uuid PRIMARY KEY,
  wip_id uuid NOT NULL REFERENCES public.cogs_wip(id) ON DELETE CASCADE,
  component_type text NOT NULL
);
CREATE TABLE public.cogs_menus (
  id uuid PRIMARY KEY,
  division_id uuid NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.cogs_menu_recipe_lines (
  id uuid PRIMARY KEY,
  menu_id uuid NOT NULL REFERENCES public.cogs_menus(id) ON DELETE CASCADE,
  component_type text NOT NULL
);
CREATE TABLE public.cogs_production_batches (
  id uuid PRIMARY KEY,
  division_id uuid NOT NULL,
  wip_id uuid NOT NULL,
  status text NOT NULL,
  notes text
);
CREATE TABLE public.cogs_production_inputs (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES public.cogs_production_batches(id) ON DELETE CASCADE
);
CREATE TABLE public.cogs_menu_sales (
  id uuid PRIMARY KEY,
  division_id uuid NOT NULL,
  status text NOT NULL,
  notes text
);
CREATE TABLE public.cogs_menu_sales_lines (
  id uuid PRIMARY KEY,
  sale_id uuid NOT NULL REFERENCES public.cogs_menu_sales(id) ON DELETE CASCADE
);
CREATE TABLE public.cogs_daily_so (
  id uuid PRIMARY KEY,
  division_id uuid NOT NULL,
  status text NOT NULL,
  notes text
);
CREATE TABLE public.cogs_daily_so_lines (
  id uuid PRIMARY KEY,
  so_id uuid NOT NULL REFERENCES public.cogs_daily_so(id) ON DELETE CASCADE
);

\ir ../barapp_cogs_audit_triggers_v1.sql

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select set_config('request.jwt.claim.email', 'cogs-audit-ci@example.invalid', false);

-- Insert/update, recipe line insert/delete, production cancellation, sale cancellation,
-- and Daily SO void must all be retained as separate immutable audit events.
insert into public.cogs_wip(id, division_id, name, active)
values ('22222222-2222-4222-8222-222222222222',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Test WIP', true);
update public.cogs_wip set name='Updated Test WIP'
where id='22222222-2222-4222-8222-222222222222';

insert into public.cogs_wip_recipe_lines(id, wip_id, component_type)
values ('33333333-3333-4333-8333-333333333333',
        '22222222-2222-4222-8222-222222222222', 'material');
delete from public.cogs_wip_recipe_lines
where id='33333333-3333-4333-8333-333333333333';

insert into public.cogs_menus(id, division_id, name, active)
values ('44444444-4444-4444-8444-444444444444',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Test Menu', true);
insert into public.cogs_menu_recipe_lines(id, menu_id, component_type)
values ('55555555-5555-4555-8555-555555555555',
        '44444444-4444-4444-8444-444444444444', 'material');

insert into public.cogs_production_batches(id, division_id, wip_id, status, notes)
values ('66666666-6666-4666-8666-666666666666',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '22222222-2222-4222-8222-222222222222', 'posted', 'production note');
insert into public.cogs_production_inputs(id, batch_id)
values ('77777777-7777-4777-8777-777777777777',
        '66666666-6666-4666-8666-666666666666');
update public.cogs_production_batches
set status='cancelled', notes='operator cancellation reason'
where id='66666666-6666-4666-8666-666666666666';

insert into public.cogs_menu_sales(id, division_id, status, notes)
values ('88888888-8888-4888-8888-888888888888',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'posted', 'sale note');
insert into public.cogs_menu_sales_lines(id, sale_id)
values ('99999999-9999-4999-8999-999999999999',
        '88888888-8888-4888-8888-888888888888');
update public.cogs_menu_sales
set status='cancelled', notes='sale cancellation reason'
where id='88888888-8888-4888-8888-888888888888';

insert into public.cogs_daily_so(id, division_id, status, notes)
values ('abababab-abab-4bab-8bab-abababababab',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'submitted', 'SO note');
insert into public.cogs_daily_so_lines(id, so_id)
values ('bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc',
        'abababab-abab-4bab-8bab-abababababab');
update public.cogs_daily_so set status='void', notes='SO cancellation reason'
where id='abababab-abab-4bab-8bab-abababababab';

DO $assertions$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.audit_log
  where actor='11111111-1111-4111-8111-111111111111'
    and actor_email='cogs-audit-ci@example.invalid';
  if v_count < 15 then
    raise exception 'TEST_FAILURE: expected at least 15 audit events with actor/email, got %', v_count;
  end if;

  if not exists (
    select 1 from public.audit_log
    where table_name='cogs_wip' and action='cogs_record_created'
      and record_id='22222222-2222-4222-8222-222222222222'
      and new_data->>'name'='Test WIP'
  ) then
    raise exception 'TEST_FAILURE: WIP creation snapshot missing';
  end if;

  if not exists (
    select 1 from public.audit_log
    where table_name='cogs_wip' and action='cogs_record_updated'
      and record_id='22222222-2222-4222-8222-222222222222'
      and old_data->>'name'='Test WIP'
      and new_data->>'name'='Updated Test WIP'
  ) then
    raise exception 'TEST_FAILURE: WIP old/new update snapshots missing';
  end if;

  if not exists (
    select 1 from public.audit_log
    where table_name='cogs_wip_recipe_lines' and action='cogs_record_deleted'
      and record_id='33333333-3333-4333-8333-333333333333'
      and old_data->>'wip_id'='22222222-2222-4222-8222-222222222222'
  ) then
    raise exception 'TEST_FAILURE: deleted recipe line snapshot missing';
  end if;

  if not exists (
    select 1 from public.audit_log
    where table_name='cogs_production_batches' and action='cogs_record_cancelled'
      and record_id='66666666-6666-4666-8666-666666666666'
      and old_data->>'status'='posted'
      and new_data->>'status'='cancelled'
      and reason='operator cancellation reason'
  ) then
    raise exception 'TEST_FAILURE: production cancellation + reason not recorded';
  end if;

  if not exists (
    select 1 from public.audit_log
    where table_name='cogs_menu_sales' and action='cogs_record_cancelled'
      and new_data->>'status'='cancelled'
      and reason='sale cancellation reason'
  ) then
    raise exception 'TEST_FAILURE: menu sale cancellation not recorded';
  end if;

  if not exists (
    select 1 from public.audit_log
    where table_name='cogs_daily_so' and action='cogs_record_cancelled'
      and new_data->>'status'='void'
      and reason='SO cancellation reason'
  ) then
    raise exception 'TEST_FAILURE: Daily SO void not recorded';
  end if;

  if exists (
    select 1 from public.audit_log
    where actor_email='cogs-audit-ci@example.invalid'
      and action in ('cogs_record_created','cogs_record_updated','cogs_record_cancelled','cogs_record_deleted')
      and (record_id is null or table_name is null)
  ) then
    raise exception 'TEST_FAILURE: an audit event is missing its table or record identity';
  end if;
end;
$assertions$;

select 'PASS: COGS create/update/cancel/delete events include actor, table, record ID and row snapshots.' as result;
