-- A legacy payroll run without an outlet must never void or unlock attendance
-- periods across outlets, including when the caller is Developer.
CREATE OR REPLACE FUNCTION public.payroll_void(p_run uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.payroll_runs;
begin
 perform public.gaji_assert_hr();
 if not public.has_perm('payroll.correct') then raise exception 'Tidak berwenang'; end if;
 if coalesce(btrim(p_reason),'')='' then raise exception 'Alasan wajib'; end if;

 select * into r from public.payroll_runs where id=p_run for update;
 if not found then
  raise exception 'Run tidak ditemukan' using errcode='P0002';
 end if;
 if r.status<>'finalized' then
  raise exception 'Hanya payroll final yang dapat di-void';
 end if;
 if r.outlet_id is null then
  raise exception 'PAYROLL_LEGACY_GLOBAL_RUN_REQUIRES_MANUAL_SCOPE_REVIEW'
   using errcode='42501';
 end if;

 perform public.payroll_assert_outlet_scope(r.outlet_id);
 if exists (
   select 1 from public.payroll_items pi
   where pi.run_id=p_run and pi.outlet_id is distinct from r.outlet_id
 ) then
  raise exception 'PAYROLL_RUN_ITEM_OUTLET_MISMATCH' using errcode='42501';
 end if;

 perform set_config('app.void_ok','1',true);
 insert into public.cashadvance_transactions(cashadvance_id,kind,amount,tx_date,payroll_run_id,notes,created_by)
 select cashadvance_id,'adjustment',amount,current_date,payroll_run_id,
        'Reversal void payroll: '||p_reason,auth.uid()
 from public.cashadvance_transactions
 where payroll_run_id=p_run and kind='deduction';

 update public.payroll_runs
 set status='void',void_reason=p_reason,voided_by=auth.uid(),voided_at=now()
 where id=p_run;

 insert into public.audit_log(actor,actor_email,action,table_name,record_id,reason)
 values(auth.uid(),nullif(auth.jwt()->>'email',''),'PAYROLL_VOID','payroll_runs',p_run::text,p_reason);
end
$function$;
