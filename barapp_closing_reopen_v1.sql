-- BarApp Closing approval cancellation / reopen V1
-- Keeps operational rows intact. Only the closing state and module confirmation
-- snapshots are reopened. Previous approval + module snapshots are preserved in audit_log.
-- Apply to a verified staging database first; do not run against production until tested.

create or replace function public.barapp_closing_reopen(
  p_division_id uuid,
  p_closing_date date,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_period public.barapp_closing_periods%rowtype;
  v_old jsonb;
  v_new jsonb;
  v_module_snapshots jsonb;
  v_module_count integer := 0;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.barapp_closing_assert_access();

  if p_division_id is null
     or not coalesce(public.barapp_closing_can_access_division(p_division_id), false) then
    raise exception 'CLOSING_DIVISION_FORBIDDEN' using errcode = '42501';
  end if;

  if p_closing_date is null
     or p_closing_date > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'CLOSING_INVALID_DATE';
  end if;

  if v_reason is null then
    raise exception 'CLOSING_REASON_REQUIRED';
  end if;

  if char_length(v_reason) > 500 then
    raise exception 'CLOSING_REASON_TOO_LONG';
  end if;

  select *
    into v_period
    from public.barapp_closing_periods
   where division_id = p_division_id
     and closing_date = p_closing_date
   for update;

  if not found then
    raise exception 'CLOSING_NOT_STARTED';
  end if;

  if v_period.status <> 'approved' then
    raise exception 'CLOSING_NOT_APPROVED';
  end if;

  select coalesce(jsonb_agg(to_jsonb(cm) order by cm.module_key), '[]'::jsonb),
         count(*)::integer
    into v_module_snapshots, v_module_count
    from public.barapp_closing_modules cm
   where cm.closing_id = v_period.id;

  -- Archive the exact pre-cancellation period and every module snapshot before
  -- resetting confirmation state. Actual transactions are not touched or deleted.
  v_old := jsonb_build_object(
    'period', to_jsonb(v_period),
    'module_snapshots', coalesce(v_module_snapshots, '[]'::jsonb)
  );

  update public.barapp_closing_periods
     set status = 'needs_reconciliation',
         approved_by = null,
         approved_at = null,
         summary = '{}'::jsonb
   where id = v_period.id
   returning * into v_period;

  -- Force fresh confirmations before re-approval, so changed transaction details
  -- cannot be silently re-approved from a stale snapshot.
  update public.barapp_closing_modules
     set status = 'pending',
         snapshot = '{}'::jsonb,
         confirmed_by = null,
         confirmed_at = null,
         note = null
   where closing_id = v_period.id;

  v_new := jsonb_build_object(
    'period', to_jsonb(v_period),
    'module_snapshots_reset', v_module_count,
    'status', 'needs_reconciliation'
  );

  insert into public.audit_log(
    at, actor, actor_email, action, table_name, record_id,
    old_data, new_data, reason
  ) values (
    now(), auth.uid(), auth.jwt() ->> 'email',
    'closing_approval_cancelled', 'barapp_closing_periods', v_period.id::text,
    v_old, v_new, v_reason
  );

  return jsonb_build_object(
    'closing_id', v_period.id,
    'division_id', p_division_id,
    'closing_date', p_closing_date,
    'status', 'needs_reconciliation',
    'module_snapshots_reset', v_module_count
  );
end
$function$;

revoke all on function public.barapp_closing_reopen(uuid, date, text) from public, anon;
grant execute on function public.barapp_closing_reopen(uuid, date, text) to authenticated;
