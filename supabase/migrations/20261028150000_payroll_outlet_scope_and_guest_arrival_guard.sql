-- Harden payroll outlet scope and Guest Arrival outlet resolution.
-- Existing global payroll runs (outlet_id IS NULL) are intentionally not rewritten here.
CREATE OR REPLACE FUNCTION public.payroll_assert_outlet_scope(p_outlet uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_role text;
BEGIN
 IF auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Tidak berwenang' USING ERRCODE='42501';
 END IF;
 IF p_outlet IS NULL THEN
  RAISE EXCEPTION 'PAYROLL_OUTLET_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.outlets o WHERE o.id=p_outlet AND o.active) THEN
  RAISE EXCEPTION 'PAYROLL_OUTLET_NOT_ACTIVE' USING ERRCODE='42501';
 END IF;
 v_role := public.app_role();
 IF v_role='dev' THEN
  RETURN;
 END IF;
 IF v_role<>'hr'
    OR NOT public.has_perm('payroll.view')
    OR NOT public.can_access_outlet(p_outlet) THEN
  RAISE EXCEPTION 'Tidak berwenang pada outlet payroll ini' USING ERRCODE='42501';
 END IF;
END
$function$;

-- Internal helper only: the public RPCs invoke it inside SECURITY DEFINER context.
REVOKE ALL ON FUNCTION public.payroll_assert_outlet_scope(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.payroll_calculate(p_outlet uuid, p_start date, p_end date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 st public.payroll_settings; r public.payroll_runs; v_run uuid; e record; v_item uuid; ca record;
 c_m int; c_l int; c_ph int; c_s int; c_i int; c_unk int; c_days int;
 v_sal numeric; v_meal numeric; v_daily numeric; v_izin numeric; v_mdays int; v_mtot numeric;
 v_allow numeric; v_kas numeric; v_net numeric; v_det jsonb; v_issues text[]; v_amt numeric;
 v_prof boolean; v_appr boolean; v_blank int; v_total numeric:=0; v_n int:=0;
 v_paid int; v_nd int; v_full boolean; v_earned numeric;
 v_zero uuid:='00000000-0000-0000-0000-000000000000';
begin
 perform public.gaji_assert_hr();
 if not public.has_perm('payroll.run') then raise exception 'Tidak berwenang menjalankan payroll' using errcode='42501'; end if;
 perform public.payroll_assert_outlet_scope(p_outlet);
 if exists (select 1 from public.payroll_runs legacy where legacy.outlet_id is null and legacy.period_start=p_start and legacy.period_end=p_end and legacy.status<>'void') then
  raise exception 'PAYROLL_LEGACY_GLOBAL_RUN_REQUIRES_REVIEW' using errcode='55000';
 end if;
 if p_end is null or p_start is null or p_end<p_start then raise exception 'Periode tidak valid' using errcode='22023'; end if;
 select * into st from public.payroll_settings where id;
 v_nd:=(p_end-p_start)+1;
 v_full:=false;
 begin
  select true into v_full from public.payroll_period_for(p_start) pp
   where pp.period_start=p_start and pp.period_end=p_end;
 exception when others then v_full:=false;
 end;
 v_full:=coalesce(v_full,false);
 select * into r from public.payroll_runs
  where coalesce(outlet_id,v_zero)=coalesce(p_outlet,v_zero) and period_start=p_start and period_end=p_end and status<>'void' for update;
 if found then
  if r.status='finalized' then raise exception 'Payroll periode ini sudah final'; end if;
  v_run:=r.id; delete from public.payroll_items where run_id=v_run;
 else
  insert into public.payroll_runs(outlet_id,period_start,period_end) values(p_outlet,p_start,p_end) returning id into v_run;
 end if;
 for e in select id,name,outlet_id,division_id from public.employees
          where coalesce(active,true) and (p_outlet is null or outlet_id=p_outlet) order by name loop
  select count(*) filter (where upper(btrim(status))='M'), count(*) filter (where upper(btrim(status))='L'),
         count(*) filter (where upper(btrim(status))='PH'), count(*) filter (where upper(btrim(status))='S'),
         count(*) filter (where upper(btrim(status))='I'),
         count(*) filter (where status is null or upper(btrim(status)) not in ('M','L','PH','S','I')),
         count(distinct attendance_date)
   into c_m,c_l,c_ph,c_s,c_i,c_unk,c_days
   from public.attendance where employee_id=e.id and attendance_date between p_start and p_end;
  v_blank:=v_nd-c_days;
  select monthly_salary,meal_rate into v_sal,v_meal from public.employee_pay_profiles where employee_id=e.id;
  v_prof:=found;
  if not v_prof then v_sal:=0; v_meal:=0; end if;
  select exists(select 1 from public.attendance_periods p
   where p.outlet_id is not distinct from e.outlet_id and p.division_id is not distinct from e.division_id
     and p.period_start=p_start and p.period_end=p_end and p.status in ('approved','locked')) into v_appr;
  v_issues:='{}';
  if not v_prof then v_issues:=array_append(v_issues,'no_salary'); end if;
  if not v_appr then v_issues:=array_append(v_issues,'recap_not_approved'); end if;
  if v_blank>0 then v_issues:=array_append(v_issues,'blank_days'); end if;
  if c_unk>0 then v_issues:=array_append(v_issues,'unknown_status'); end if;
  v_paid:=c_m+c_l+c_ph+c_s;
  v_daily:=round(v_sal/st.salary_divisor,2);
  if v_full then
   v_earned:=v_sal-round(greatest(v_nd-v_paid,0)*v_sal/st.salary_divisor,2);
  else
   v_earned:=round(v_paid*v_sal/st.salary_divisor,2);
  end if;
  v_izin:=v_sal-v_earned;
  v_mdays:=(case when 'M'=any(st.meal_codes) then c_m else 0 end)+(case when 'L'=any(st.meal_codes) then c_l else 0 end)
          +(case when 'PH'=any(st.meal_codes) then c_ph else 0 end)+(case when 'S'=any(st.meal_codes) then c_s else 0 end)
          +(case when 'I'=any(st.meal_codes) then c_i else 0 end);
  v_mtot:=v_mdays*v_meal;
  insert into public.payroll_items(run_id,employee_id,employee_name,outlet_id,division_id,monthly_salary,daily_rate,
   cnt_m,cnt_l,cnt_ph,cnt_s,cnt_i,cnt_unknown,blank_days,izin_deduction,meal_days,meal_rate,meal_total,issues,
   paid_days,unpaid_days,salary_mode)
  values(v_run,e.id,e.name,e.outlet_id,e.division_id,v_sal,v_daily,c_m,c_l,c_ph,c_s,c_i,c_unk,v_blank,v_izin,v_mdays,v_meal,v_mtot,v_issues,
   v_paid,greatest(v_nd-v_paid,0),case when v_full then 'full' else 'prorata' end)
  returning id into v_item;
  insert into public.payroll_item_allowances(item_id,allowance_id,name,kind,amount)
  select v_item,ea.id,ea.name,ea.kind,ea.amount from public.employee_allowances ea
  where ea.employee_id=e.id and ea.active and ea.valid_from<=p_end and (ea.valid_to is null or ea.valid_to>=p_start)
    and not (ea.kind='period_special' and exists(select 1 from public.payroll_item_allowances pia
      join public.payroll_items pi2 on pi2.id=pia.item_id join public.payroll_runs pr on pr.id=pi2.run_id
      where pia.allowance_id=ea.id and pr.status='finalized' and pr.id<>v_run));
  select coalesce(sum(amount),0) into v_allow from public.payroll_item_allowances where item_id=v_item;
  v_det:='[]'::jsonb; v_kas:=0;
  for ca in select c.id,c.installment from public.cashadvances c
            where c.employee_id=e.id and c.status='open' and c.issued_on<=p_end and c.installment>0 order by c.issued_on loop
   v_amt:=least(ca.installment,public.cashadvance_balance(ca.id));
   if v_amt>0 then
    v_det:=v_det||jsonb_build_array(jsonb_build_object('cashadvance_id',ca.id,'amount',v_amt));
    v_kas:=v_kas+v_amt;
   end if;
  end loop;
  v_net:=v_earned+v_mtot+v_allow-v_kas;
  update public.payroll_items set allowance_total=v_allow,kasbon_deduction=v_kas,kasbon_detail=v_det,
   net_pay=v_net,cash_payable=greatest(v_net,0),liability=greatest(-v_net,0) where id=v_item;
  v_total:=v_total+v_net; v_n:=v_n+1;
 end loop;
 update public.payroll_runs set status='calculated',settings_snapshot=to_jsonb(st),employee_count=v_n,total_net=v_total,
  calculated_by=auth.uid(),calculated_at=now() where id=v_run;
 return v_run;
end $function$
;
CREATE OR REPLACE FUNCTION public.payroll_apply_overtime(p_run uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.payroll_runs; x record; v_oth numeric; v_ot numeric; v_net numeric;
begin
 perform public.gaji_assert_hr();
 if not public.has_perm('payroll.run') then raise exception 'Tidak berwenang'; end if;
 select * into r from public.payroll_runs where id=p_run for update;
 if not found then raise exception 'Run tidak ditemukan' using errcode='P0002'; end if;
 perform public.payroll_assert_outlet_scope(r.outlet_id);
 if exists (select 1 from public.payroll_items pi where pi.run_id=p_run and pi.outlet_id is distinct from r.outlet_id) then
  raise exception 'PAYROLL_RUN_ITEM_OUTLET_MISMATCH' using errcode='42501';
 end if;
 if r.status<>'calculated' then raise exception 'Payroll harus berstatus calculated' using errcode='55000'; end if;
 for x in select i.id,i.employee_id,i.monthly_salary,i.net_pay,i.overtime_total as oldot
          from public.payroll_items i where i.run_id=p_run loop
  select coalesce(sum(o.hours),0) into v_oth from public.overtime_entries o
   where o.employee_id=x.employee_id and o.work_date between r.period_start and r.period_end;
  v_ot:=round(v_oth*(x.monthly_salary/31)/8*1.5,2);
  v_net:=x.net_pay-x.oldot+v_ot;
  update public.payroll_items set overtime_hours=v_oth,overtime_total=v_ot,net_pay=v_net,
   cash_payable=greatest(v_net,0),liability=greatest(-v_net,0) where id=x.id;
 end loop;
 update public.payroll_runs set total_net=(select coalesce(sum(net_pay),0) from public.payroll_items where run_id=p_run)
  where id=p_run;
end $function$
;
CREATE OR REPLACE FUNCTION public.payroll_finalize(p_run uuid, p_key text, p_ack_issues boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.payroll_runs; x record; v_amt numeric; v_ca uuid;
begin
 perform public.gaji_assert_hr();
 if not public.has_perm('payroll.finalize') then raise exception 'Tidak berwenang memfinalisasi'; end if;
 if coalesce(btrim(p_key),'')='' then raise exception 'idempotency key wajib'; end if;
 select * into r from public.payroll_runs where id=p_run for update;
 if not found then raise exception 'Run tidak ditemukan' using errcode='P0002'; end if;
 perform public.payroll_assert_outlet_scope(r.outlet_id);
 if exists (select 1 from public.payroll_items pi where pi.run_id=p_run and pi.outlet_id is distinct from r.outlet_id) then
  raise exception 'PAYROLL_RUN_ITEM_OUTLET_MISMATCH' using errcode='42501';
 end if;
 if r.status='finalized' then
  if r.idempotency_key=p_key then return; end if;
  raise exception 'Payroll sudah final';
 end if;
 if r.status<>'calculated' then raise exception 'Hitung payroll dulu (status: %)',r.status; end if;
 if exists(select 1 from public.payroll_items where run_id=p_run and cardinality(issues)>0) and not p_ack_issues then
  raise exception 'Ada item bermasalah. Tinjau, atau finalisasi dengan p_ack_issues=true.'; end if;
 for x in select i.id,d.value as d from public.payroll_items i, jsonb_array_elements(i.kasbon_detail) d where i.run_id=p_run loop
  v_amt:=(x.d->>'amount')::numeric; v_ca:=(x.d->>'cashadvance_id')::uuid;
  if v_amt>public.cashadvance_balance(v_ca) then raise exception 'Saldo kasbon berubah sejak perhitungan. Hitung ulang payroll.'; end if;
  insert into public.cashadvance_transactions(cashadvance_id,kind,amount,tx_date,payroll_run_id,notes,created_by)
  values(v_ca,'deduction',v_amt,r.period_end,p_run,'Potongan payroll',auth.uid());
 end loop;
 update public.payroll_runs set status='finalized',finalized_by=auth.uid(),finalized_at=now(),idempotency_key=p_key where id=p_run;
 insert into public.payroll_archive(run_id,snapshot,checksum,created_by)
 select p_run,s.j,encode(sha256(convert_to(s.j::text,'UTF8')),'hex'),auth.uid()
 from (select jsonb_build_object(
   'run',(select to_jsonb(pr) from public.payroll_runs pr where pr.id=p_run),
   'items',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('allowances',
      (select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from public.payroll_item_allowances a where a.item_id=i.id)))
    from public.payroll_items i where i.run_id=p_run),'[]'::jsonb)) as j) s;
 update public.attendance_periods set status='locked',locked_at=now()
  where status='approved' and period_start>=r.period_start and period_end<=r.period_end
    and outlet_id=r.outlet_id;
end $function$
;
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
 if not found then raise exception 'Run tidak ditemukan' using errcode='P0002'; end if;
 if r.outlet_id is null then
  if public.app_role()<>'dev' then raise exception 'PAYROLL_LEGACY_GLOBAL_RUN_REQUIRES_DEVELOPER_REVIEW' using errcode='42501'; end if;
 else
  perform public.payroll_assert_outlet_scope(r.outlet_id);
  if exists (select 1 from public.payroll_items pi where pi.run_id=p_run and pi.outlet_id is distinct from r.outlet_id) then
   raise exception 'PAYROLL_RUN_ITEM_OUTLET_MISMATCH' using errcode='42501';
  end if;
 end if;
 if r.status<>'finalized' then raise exception 'Hanya payroll final yang dapat di-void'; end if;
 perform set_config('app.void_ok','1',true);
 insert into public.cashadvance_transactions(cashadvance_id,kind,amount,tx_date,payroll_run_id,notes,created_by)
 select cashadvance_id,'adjustment',amount,current_date,payroll_run_id,'Reversal void payroll: '||p_reason,auth.uid()
 from public.cashadvance_transactions where payroll_run_id=p_run and kind='deduction';
 update public.payroll_runs set status='void',void_reason=p_reason,voided_by=auth.uid(),voided_at=now() where id=p_run;
 insert into public.audit_log(actor,actor_email,action,table_name,record_id,reason)
 values(auth.uid(),nullif(auth.jwt()->>'email',''),'PAYROLL_VOID','payroll_runs',p_run::text,p_reason);
end $function$
;
CREATE OR REPLACE FUNCTION public.payroll_save_employee_pay(p_employee uuid, p_monthly_salary numeric, p_meal_rate numeric, p_rows jsonb, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r jsonb;
  v_why text;
  v_outlet uuid;
begin
  perform gaji_assert_hr();
 if not public.has_perm('salary.manage') then raise exception 'PAYROLL_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
  select e.outlet_id into v_outlet from public.employees e where e.id=p_employee for update;
  if not found then raise exception 'EMPLOYEE_NOT_FOUND' using errcode='P0002'; end if;
  perform public.payroll_assert_outlet_scope(v_outlet);
  if p_monthly_salary is null or p_meal_rate is null or p_monthly_salary < 0 or p_meal_rate < 0 then raise exception 'Nominal tidak boleh negatif' using errcode='22023'; end if;
  v_why := coalesce(nullif(trim(p_reason),''), 'Hapus tunjangan') || ' [' || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS') || ']';

  insert into employee_pay_profiles (employee_id, monthly_salary, meal_rate, updated_at)
  values (p_employee, p_monthly_salary, p_meal_rate, now())
  on conflict (employee_id) do update
    set monthly_salary = excluded.monthly_salary,
        meal_rate      = excluded.meal_rate,
        updated_at     = excluded.updated_at;

  for r in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    if r->>'action' = 'add' then
      insert into employee_allowances (employee_id, name, kind, amount, valid_from, valid_to, active, change_reason)
      values (p_employee, r->>'name', r->>'kind', (r->>'amount')::numeric,
              (r->>'valid_from')::date, nullif(r->>'valid_to','')::date,
              coalesce((r->>'active')::boolean, true), v_why);
    elsif r->>'action' = 'update' then
      update employee_allowances
         set name = r->>'name', kind = r->>'kind', amount = (r->>'amount')::numeric,
             valid_from = (r->>'valid_from')::date, valid_to = nullif(r->>'valid_to','')::date,
             active = (r->>'active')::boolean, change_reason = v_why
       where id = (r->>'id')::uuid and employee_id = p_employee;
    elsif r->>'action' = 'delete' then
      update employee_allowances
         set active = false, change_reason = 'Dihapus: ' || v_why
       where id = (r->>'id')::uuid and employee_id = p_employee;
    end if;
  end loop;
end $function$
;
CREATE OR REPLACE FUNCTION public.payroll_clear_employee_pay(p_employee uuid, p_reason text DEFAULT 'Hapus gaji'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_why text; v_outlet uuid;
begin
  perform gaji_assert_hr();
 if not public.has_perm('salary.manage') then raise exception 'PAYROLL_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
  select e.outlet_id into v_outlet from public.employees e where e.id=p_employee for update;
  if not found then raise exception 'EMPLOYEE_NOT_FOUND' using errcode='P0002'; end if;
  perform public.payroll_assert_outlet_scope(v_outlet);
  v_why := coalesce(nullif(trim(p_reason),''), 'Hapus gaji') || ' [' || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS') || ']';

  update employee_pay_profiles
     set monthly_salary = 0, meal_rate = 0, updated_at = now()
   where employee_id = p_employee;

  update employee_allowances
     set active = false, change_reason = 'Gaji dihapus: ' || v_why
   where employee_id = p_employee and active;
end $function$
;
CREATE OR REPLACE FUNCTION public.guest_arrival_current_outlet()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE v_outlet uuid; v_scope_count bigint;
BEGIN
 IF public.app_role()='dev' THEN RETURN NULL; END IF;
 IF auth.uid() IS NULL OR NOT public.guest_arrival_can_access() THEN
  RAISE EXCEPTION 'Akses Guest Arrival ditolak.' USING ERRCODE='42501';
 END IF;
 SELECT COUNT(DISTINCT s.outlet_id), MIN(s.outlet_id::text)::uuid
 INTO v_scope_count, v_outlet
 FROM public.user_scopes s
 JOIN public.outlets o ON o.id=s.outlet_id AND o.active
 WHERE s.user_id=auth.uid();
 IF v_scope_count IS DISTINCT FROM 1 OR v_outlet IS NULL THEN
  RAISE EXCEPTION 'GUEST_ARRIVAL_OUTLET_SCOPE_INVALID: akun harus memiliki tepat satu outlet aktif.' USING ERRCODE='42501';
 END IF;
 RETURN v_outlet;
END
$function$
;
