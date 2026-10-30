-- Payroll integrity safeguards.
-- Existing calculated payroll data is preserved; unsafe runs are blocked from finalization.

CREATE OR REPLACE FUNCTION public.payroll_calculate(
  p_outlet uuid,
  p_start date,
  p_end date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  st public.payroll_settings;
  r public.payroll_runs;
  v_run uuid;
  e record;
  v_item uuid;
  ca record;
  c_m int;
  c_l int;
  c_ph int;
  c_s int;
  c_i int;
  c_unk int;
  c_days int;
  v_sal numeric;
  v_meal numeric;
  v_daily numeric;
  v_izin numeric;
  v_mdays int;
  v_mtot numeric;
  v_allow numeric;
  v_kas numeric;
  v_net numeric;
  v_det jsonb;
  v_issues text[];
  v_amt numeric;
  v_prof boolean;
  v_appr boolean;
  v_blank int;
  v_n int := 0;
  v_paid int;
  v_nd int;
  v_full boolean := true;
  v_earned numeric;
  v_cfg_start date;
  v_cfg_end date;
  v_existing boolean := false;
  v_oth numeric;
  v_ot numeric;
  v_divisor numeric;
BEGIN
  PERFORM public.gaji_assert_hr();
  IF NOT public.has_perm('payroll.run') THEN
    RAISE EXCEPTION 'Tidak berwenang menjalankan payroll' USING ERRCODE='42501';
  END IF;

  PERFORM public.payroll_assert_outlet_scope(p_outlet);

  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RAISE EXCEPTION 'Periode tidak valid' USING ERRCODE='22023';
  END IF;

  SELECT * INTO st FROM public.payroll_settings WHERE id;
  SELECT pp.period_start, pp.period_end
    INTO v_cfg_start, v_cfg_end
  FROM public.payroll_period_for(p_start) pp;

  IF v_cfg_start IS NULL OR v_cfg_end IS NULL
     OR v_cfg_start IS DISTINCT FROM p_start
     OR v_cfg_end IS DISTINCT FROM p_end THEN
    RAISE EXCEPTION 'PAYROLL_PERIOD_NOT_CONFIGURED: gunakan periode resmi sesuai pengaturan payroll'
      USING ERRCODE='22023';
  END IF;

  -- Serialize calculate/finalize/void across outlets to prevent race conditions.
  PERFORM pg_advisory_xact_lock(20261030, 30103);

  IF EXISTS (
    SELECT 1
    FROM public.payroll_periods pp
    WHERE pp.outlet_id = p_outlet
      AND pp.start_date = p_start
      AND pp.end_date = p_end
      AND pp.locked
  ) THEN
    RAISE EXCEPTION 'PAYROLL_PERIOD_LOCKED: buka kunci periode sebelum menghitung ulang'
      USING ERRCODE='55000';
  END IF;

  SELECT * INTO r
  FROM public.payroll_runs
  WHERE outlet_id = p_outlet
    AND period_start = p_start
    AND period_end = p_end
    AND status <> 'void'
  FOR UPDATE;
  v_existing := FOUND;

  IF v_existing AND r.status = 'finalized' THEN
    RAISE EXCEPTION 'Payroll periode ini sudah final';
  END IF;

  -- A finalized overlapping run must never receive a second payroll deduction.
  IF EXISTS (
    SELECT 1
    FROM public.payroll_runs other_run
    WHERE other_run.status = 'finalized'
      AND other_run.period_start <= p_end
      AND other_run.period_end >= p_start
      AND (other_run.outlet_id = p_outlet OR other_run.outlet_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'PAYROLL_PERIOD_OVERLAPS_FINALIZED_RUN: periksa payroll yang sudah final'
      USING ERRCODE='55000';
  END IF;

  v_nd := (p_end - p_start) + 1;
  v_divisor := CASE
    WHEN coalesce(st.salary_divisor, 0) > 0 THEN st.salary_divisor
    ELSE 31
  END;

  IF v_existing THEN
    v_run := r.id;
    DELETE FROM public.payroll_items WHERE run_id = v_run;
  ELSE
    INSERT INTO public.payroll_runs(outlet_id, period_start, period_end)
    VALUES (p_outlet, p_start, p_end)
    RETURNING id INTO v_run;
  END IF;

  FOR e IN
    SELECT id, name, outlet_id, division_id
    FROM public.employees
    WHERE coalesce(active, true) AND outlet_id = p_outlet
    ORDER BY name
  LOOP
    SELECT
      count(*) FILTER (WHERE upper(btrim(status))='M'),
      count(*) FILTER (WHERE upper(btrim(status))='L'),
      count(*) FILTER (WHERE upper(btrim(status))='PH'),
      count(*) FILTER (WHERE upper(btrim(status))='S'),
      count(*) FILTER (WHERE upper(btrim(status))='I'),
      count(*) FILTER (WHERE status IS NULL OR upper(btrim(status)) NOT IN ('M','L','PH','S','I')),
      count(DISTINCT attendance_date)
    INTO c_m, c_l, c_ph, c_s, c_i, c_unk, c_days
    FROM public.attendance
    WHERE employee_id = e.id
      AND attendance_date BETWEEN p_start AND p_end;

    v_blank := v_nd - c_days;

    SELECT monthly_salary, meal_rate
      INTO v_sal, v_meal
    FROM public.employee_pay_profiles
    WHERE employee_id = e.id;
    v_prof := FOUND;

    IF NOT v_prof THEN
      v_sal := 0;
      v_meal := 0;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.attendance_periods ap
      WHERE ap.outlet_id = e.outlet_id
        AND ap.division_id = e.division_id
        AND ap.period_start = p_start
        AND ap.period_end = p_end
        AND ap.status IN ('approved','locked')
    ) INTO v_appr;

    v_issues := '{}';
    IF NOT v_prof THEN
      v_issues := array_append(v_issues, 'no_salary');
    END IF;
    IF NOT v_appr THEN
      v_issues := array_append(v_issues, 'recap_not_approved');
    END IF;
    IF v_blank > 0 THEN
      v_issues := array_append(v_issues, 'blank_days');
    END IF;
    IF c_unk > 0 THEN
      v_issues := array_append(v_issues, 'unknown_status');
    END IF;

    v_paid := c_m + c_l + c_ph + c_s;
    v_daily := round(v_sal / v_divisor, 2);

    IF v_full THEN
      v_earned := v_sal - round(greatest(v_nd - v_paid, 0) * v_sal / v_divisor, 2);
    ELSE
      v_earned := round(v_paid * v_sal / v_divisor, 2);
    END IF;

    v_izin := v_sal - v_earned;
    v_mdays :=
      (CASE WHEN 'M'=ANY(st.meal_codes) THEN c_m ELSE 0 END) +
      (CASE WHEN 'L'=ANY(st.meal_codes) THEN c_l ELSE 0 END) +
      (CASE WHEN 'PH'=ANY(st.meal_codes) THEN c_ph ELSE 0 END) +
      (CASE WHEN 'S'=ANY(st.meal_codes) THEN c_s ELSE 0 END) +
      (CASE WHEN 'I'=ANY(st.meal_codes) THEN c_i ELSE 0 END);
    v_mtot := v_mdays * v_meal;

    INSERT INTO public.payroll_items(
      run_id, employee_id, employee_name, outlet_id, division_id,
      monthly_salary, daily_rate, cnt_m, cnt_l, cnt_ph, cnt_s, cnt_i,
      cnt_unknown, blank_days, izin_deduction, meal_days, meal_rate,
      meal_total, issues, paid_days, unpaid_days, salary_mode
    )
    VALUES (
      v_run, e.id, e.name, e.outlet_id, e.division_id,
      v_sal, v_daily, c_m, c_l, c_ph, c_s, c_i,
      c_unk, v_blank, v_izin, v_mdays, v_meal,
      v_mtot, v_issues, v_paid, greatest(v_nd-v_paid,0), 'full'
    )
    RETURNING id INTO v_item;

    INSERT INTO public.payroll_item_allowances(item_id, allowance_id, name, kind, amount)
    SELECT v_item, ea.id, ea.name, ea.kind, ea.amount
    FROM public.employee_allowances ea
    WHERE ea.employee_id = e.id
      AND ea.active
      AND ea.valid_from <= p_end
      AND (ea.valid_to IS NULL OR ea.valid_to >= p_start)
      AND NOT (
        ea.kind = 'period_special'
        AND EXISTS (
          SELECT 1
          FROM public.payroll_item_allowances pia
          JOIN public.payroll_items pi2 ON pi2.id = pia.item_id
          JOIN public.payroll_runs pr ON pr.id = pi2.run_id
          WHERE pia.allowance_id = ea.id
            AND pr.status = 'finalized'
            AND pr.id <> v_run
        )
      );

    SELECT coalesce(sum(amount),0)
      INTO v_allow
    FROM public.payroll_item_allowances
    WHERE item_id = v_item;

    v_det := '[]'::jsonb;
    v_kas := 0;

    FOR ca IN
      SELECT c.id, c.installment
      FROM public.cashadvances c
      WHERE c.employee_id = e.id
        AND c.status = 'open'
        AND c.issued_on <= p_end
        AND c.installment > 0
      ORDER BY c.issued_on, c.id
    LOOP
      v_amt := least(ca.installment, public.cashadvance_balance(ca.id));
      IF v_amt > 0 THEN
        v_det := v_det || jsonb_build_array(
          jsonb_build_object('cashadvance_id', ca.id, 'amount', v_amt)
        );
        v_kas := v_kas + v_amt;
      END IF;
    END LOOP;

    v_net := v_earned + v_mtot + v_allow - v_kas;

    UPDATE public.payroll_items
    SET allowance_total = v_allow,
        kasbon_deduction = v_kas,
        kasbon_detail = v_det,
        net_pay = v_net,
        cash_payable = greatest(v_net, 0),
        liability = greatest(-v_net, 0)
    WHERE id = v_item;

    v_n := v_n + 1;
  END LOOP;

  -- Include overtime in the same transaction as calculation.
  FOR e IN
    SELECT i.id, i.employee_id, i.monthly_salary, i.net_pay, i.overtime_total
    FROM public.payroll_items i
    WHERE i.run_id = v_run
    ORDER BY i.employee_id
  LOOP
    SELECT coalesce(sum(o.hours),0)
      INTO v_oth
    FROM public.overtime_entries o
    WHERE o.employee_id = e.employee_id
      AND o.work_date BETWEEN p_start AND p_end;

    v_ot := round(v_oth * (e.monthly_salary / v_divisor) / 8 * 1.5, 2);
    v_net := e.net_pay - coalesce(e.overtime_total,0) + v_ot;

    UPDATE public.payroll_items
    SET overtime_hours = v_oth,
        overtime_total = v_ot,
        net_pay = v_net,
        cash_payable = greatest(v_net,0),
        liability = greatest(-v_net,0)
    WHERE id = e.id;
  END LOOP;

  UPDATE public.payroll_runs
  SET status = 'calculated',
      settings_snapshot = to_jsonb(st),
      employee_count = v_n,
      total_net = (
        SELECT coalesce(sum(pi.net_pay),0)
        FROM public.payroll_items pi
        WHERE pi.run_id = v_run
      ),
      calculated_by = auth.uid(),
      calculated_at = now()
  WHERE id = v_run;

  RETURN v_run;
END
$function$;


CREATE OR REPLACE FUNCTION public.payroll_apply_overtime(p_run uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.payroll_runs;
  x record;
  v_oth numeric;
  v_ot numeric;
  v_net numeric;
  v_divisor numeric;
BEGIN
  PERFORM public.gaji_assert_hr();
  IF NOT public.has_perm('payroll.run') THEN
    RAISE EXCEPTION 'Tidak berwenang';
  END IF;

  PERFORM pg_advisory_xact_lock(20261030, 30103);

  SELECT * INTO r
  FROM public.payroll_runs
  WHERE id = p_run
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  PERFORM public.payroll_assert_outlet_scope(r.outlet_id);

  IF EXISTS (
    SELECT 1
    FROM public.payroll_items pi
    WHERE pi.run_id = p_run
      AND pi.outlet_id IS DISTINCT FROM r.outlet_id
  ) THEN
    RAISE EXCEPTION 'PAYROLL_RUN_ITEM_OUTLET_MISMATCH' USING ERRCODE='42501';
  END IF;

  IF r.status <> 'calculated' THEN
    RAISE EXCEPTION 'Payroll harus berstatus calculated' USING ERRCODE='55000';
  END IF;

  v_divisor := coalesce(nullif((r.settings_snapshot->>'salary_divisor')::numeric,0),31);
  IF v_divisor <= 0 THEN
    v_divisor := 31;
  END IF;

  FOR x IN
    SELECT i.id, i.employee_id, i.monthly_salary, i.net_pay, i.overtime_total AS oldot
    FROM public.payroll_items i
    WHERE i.run_id = p_run
    ORDER BY i.employee_id
  LOOP
    SELECT coalesce(sum(o.hours),0)
      INTO v_oth
    FROM public.overtime_entries o
    WHERE o.employee_id = x.employee_id
      AND o.work_date BETWEEN r.period_start AND r.period_end;

    v_ot := round(v_oth * (x.monthly_salary / v_divisor) / 8 * 1.5, 2);
    v_net := x.net_pay - x.oldot + v_ot;

    UPDATE public.payroll_items
    SET overtime_hours = v_oth,
        overtime_total = v_ot,
        net_pay = v_net,
        cash_payable = greatest(v_net,0),
        liability = greatest(-v_net,0)
    WHERE id = x.id;
  END LOOP;

  UPDATE public.payroll_runs
  SET total_net = (
    SELECT coalesce(sum(net_pay),0)
    FROM public.payroll_items
    WHERE run_id = p_run
  )
  WHERE id = p_run;
END
$function$;


CREATE OR REPLACE FUNCTION public.payroll_finalize(
  p_run uuid,
  p_key text,
  p_ack_issues boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.payroll_runs;
  x record;
  v_amt numeric;
  v_ca uuid;
  v_item_count integer;
  v_unapproved boolean;
  v_cfg_start date;
  v_cfg_end date;
BEGIN
  PERFORM public.gaji_assert_hr();
  IF NOT public.has_perm('payroll.finalize') THEN
    RAISE EXCEPTION 'Tidak berwenang memfinalisasi';
  END IF;
  IF coalesce(btrim(p_key),'') = '' THEN
    RAISE EXCEPTION 'idempotency key wajib';
  END IF;

  PERFORM pg_advisory_xact_lock(20261030, 30103);

  SELECT * INTO r
  FROM public.payroll_runs
  WHERE id = p_run
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF r.outlet_id IS NULL THEN
    RAISE EXCEPTION 'PAYROLL_LEGACY_GLOBAL_RUN_REQUIRES_MANUAL_SCOPE_REVIEW'
      USING ERRCODE='42501';
  END IF;

  PERFORM public.payroll_assert_outlet_scope(r.outlet_id);

  IF EXISTS (
    SELECT 1
    FROM public.payroll_items pi
    WHERE pi.run_id = p_run
      AND pi.outlet_id IS DISTINCT FROM r.outlet_id
  ) THEN
    RAISE EXCEPTION 'PAYROLL_RUN_ITEM_OUTLET_MISMATCH' USING ERRCODE='42501';
  END IF;

  IF r.status = 'finalized' THEN
    IF r.idempotency_key = p_key THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Payroll sudah final';
  END IF;

  IF r.status <> 'calculated' THEN
    RAISE EXCEPTION 'Hitung payroll dulu (status: %)', r.status;
  END IF;

  SELECT pp.period_start, pp.period_end
    INTO v_cfg_start, v_cfg_end
  FROM public.payroll_period_for(r.period_start) pp;

  IF v_cfg_start IS NULL OR v_cfg_end IS NULL
     OR v_cfg_start IS DISTINCT FROM r.period_start
     OR v_cfg_end IS DISTINCT FROM r.period_end THEN
    RAISE EXCEPTION 'PAYROLL_PERIOD_NOT_CONFIGURED: periode harus sesuai pengaturan payroll'
      USING ERRCODE='22023';
  END IF;

  IF r.period_end > (now() AT TIME ZONE 'Asia/Jakarta')::date THEN
    RAISE EXCEPTION 'PAYROLL_PERIOD_NOT_ENDED: periode payroll belum berakhir'
      USING ERRCODE='55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payroll_runs other_run
    WHERE other_run.id <> p_run
      AND other_run.status = 'finalized'
      AND other_run.period_start <= r.period_end
      AND other_run.period_end >= r.period_start
      AND (other_run.outlet_id = r.outlet_id OR other_run.outlet_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'PAYROLL_PERIOD_OVERLAPS_FINALIZED_RUN: ada payroll final yang bertumpuk'
      USING ERRCODE='55000';
  END IF;

  SELECT count(*) INTO v_item_count
  FROM public.payroll_items
  WHERE run_id = p_run;

  IF v_item_count = 0 OR r.employee_count IS DISTINCT FROM v_item_count THEN
    RAISE EXCEPTION 'PAYROLL_ITEMS_INCOMPLETE: hitung ulang payroll sebelum finalisasi'
      USING ERRCODE='55000';
  END IF;

  -- These are objective data-integrity failures and cannot be bypassed by acknowledgement.
  IF EXISTS (
    SELECT 1
    FROM public.payroll_items pi
    WHERE pi.run_id = p_run
      AND (
        pi.blank_days > 0
        OR pi.cnt_unknown > 0
        OR 'no_salary' = ANY(pi.issues)
      )
  ) THEN
    RAISE EXCEPTION 'PAYROLL_DATA_INCOMPLETE: lengkapi absensi/status dan profil gaji, lalu hitung ulang'
      USING ERRCODE='55000';
  END IF;

  -- Approval is currently a separate manual workflow; keep an explicit acknowledgement gate.
  SELECT EXISTS (
    SELECT 1
    FROM public.payroll_items pi
    WHERE pi.run_id = p_run
      AND NOT EXISTS (
        SELECT 1
        FROM public.attendance_periods ap
        WHERE ap.outlet_id = pi.outlet_id
          AND ap.division_id = pi.division_id
          AND ap.period_start = r.period_start
          AND ap.period_end = r.period_end
          AND ap.status IN ('approved','locked')
      )
  ) INTO v_unapproved;

  IF v_unapproved AND NOT coalesce(p_ack_issues,false) THEN
    RAISE EXCEPTION 'PAYROLL_ATTENDANCE_NOT_APPROVED: tinjau rekap absensi dan beri pengakuan eksplisit bila tetap lanjut'
      USING ERRCODE='55000';
  END IF;

  IF NOT coalesce(p_ack_issues,false) AND EXISTS (
    SELECT 1
    FROM public.payroll_items pi
    WHERE pi.run_id = p_run
      AND EXISTS (
        SELECT 1
        FROM unnest(pi.issues) AS issue_code
        WHERE issue_code <> 'recap_not_approved'
      )
  ) THEN
    RAISE EXCEPTION 'Ada item bermasalah. Tinjau sebelum finalisasi.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cashadvance_transactions t
    WHERE t.payroll_run_id = p_run
      AND t.kind = 'deduction'
  ) THEN
    RAISE EXCEPTION 'PAYROLL_CASHADVANCE_DEDUCTION_ALREADY_POSTED'
      USING ERRCODE='55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payroll_items pi
    WHERE pi.run_id = p_run
      AND (
        jsonb_typeof(pi.kasbon_detail) IS DISTINCT FROM 'array'
        OR pi.kasbon_deduction IS DISTINCT FROM (
          SELECT coalesce(sum((d.value->>'amount')::numeric),0)
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(pi.kasbon_detail) = 'array'
                THEN pi.kasbon_detail
              ELSE '[]'::jsonb
            END
          ) AS d(value)
        )
      )
  ) THEN
    RAISE EXCEPTION 'PAYROLL_CASHADVANCE_DETAIL_MISMATCH'
      USING ERRCODE='55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payroll_items pi
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(pi.kasbon_detail) = 'array'
          THEN pi.kasbon_detail
        ELSE '[]'::jsonb
      END
    ) AS d(value)
    LEFT JOIN public.cashadvances ca
      ON ca.id = (d.value->>'cashadvance_id')::uuid
    WHERE pi.run_id = p_run
      AND (ca.id IS NULL OR ca.employee_id IS DISTINCT FROM pi.employee_id)
  ) THEN
    RAISE EXCEPTION 'PAYROLL_CASHADVANCE_EMPLOYEE_MISMATCH'
      USING ERRCODE='55000';
  END IF;

  FOR x IN
    SELECT i.employee_id, d.value AS d
    FROM public.payroll_items i
    CROSS JOIN LATERAL jsonb_array_elements(i.kasbon_detail) AS d(value)
    WHERE i.run_id = p_run
    ORDER BY i.employee_id, d.value->>'cashadvance_id'
  LOOP
    v_amt := (x.d->>'amount')::numeric;
    v_ca := (x.d->>'cashadvance_id')::uuid;

    IF v_amt > public.cashadvance_balance(v_ca) THEN
      RAISE EXCEPTION 'Saldo kasbon berubah sejak perhitungan. Hitung ulang payroll.';
    END IF;

    INSERT INTO public.cashadvance_transactions(
      cashadvance_id, kind, amount, tx_date, payroll_run_id, notes, created_by
    )
    VALUES (
      v_ca, 'deduction', v_amt, r.period_end, p_run, 'Potongan payroll', auth.uid()
    );
  END LOOP;

  UPDATE public.payroll_runs
  SET status = 'finalized',
      finalized_by = auth.uid(),
      finalized_at = now(),
      idempotency_key = p_key
  WHERE id = p_run;

  INSERT INTO public.payroll_archive(run_id, snapshot, checksum, created_by)
  SELECT
    p_run,
    s.j,
    encode(sha256(convert_to(s.j::text,'UTF8')),'hex'),
    auth.uid()
  FROM (
    SELECT jsonb_build_object(
      'run', (SELECT to_jsonb(pr) FROM public.payroll_runs pr WHERE pr.id = p_run),
      'items', coalesce((
        SELECT jsonb_agg(
          to_jsonb(i) || jsonb_build_object(
            'allowances',
            (
              SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb)
              FROM public.payroll_item_allowances a
              WHERE a.item_id = i.id
            )
          )
        )
        FROM public.payroll_items i
        WHERE i.run_id = p_run
      ), '[]'::jsonb)
    ) AS j
  ) s;

  UPDATE public.attendance_periods
  SET status = 'locked', locked_at = now()
  WHERE status = 'approved'
    AND period_start >= r.period_start
    AND period_end <= r.period_end
    AND outlet_id = r.outlet_id;
END
$function$;


CREATE OR REPLACE FUNCTION public.payroll_void(p_run uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.payroll_runs;
BEGIN
  PERFORM public.gaji_assert_hr();
  IF NOT public.has_perm('payroll.correct') THEN
    RAISE EXCEPTION 'Tidak berwenang';
  END IF;
  IF coalesce(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'Alasan wajib';
  END IF;

  PERFORM pg_advisory_xact_lock(20261030, 30103);

  SELECT * INTO r
  FROM public.payroll_runs
  WHERE id = p_run
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run tidak ditemukan' USING ERRCODE='P0002';
  END IF;
  IF r.status <> 'finalized' THEN
    RAISE EXCEPTION 'Hanya payroll final yang dapat di-void';
  END IF;
  IF r.outlet_id IS NULL THEN
    RAISE EXCEPTION 'PAYROLL_LEGACY_GLOBAL_RUN_REQUIRES_MANUAL_SCOPE_REVIEW'
      USING ERRCODE='42501';
  END IF;

  PERFORM public.payroll_assert_outlet_scope(r.outlet_id);

  IF EXISTS (
    SELECT 1
    FROM public.payroll_items pi
    WHERE pi.run_id = p_run
      AND pi.outlet_id IS DISTINCT FROM r.outlet_id
  ) THEN
    RAISE EXCEPTION 'PAYROLL_RUN_ITEM_OUTLET_MISMATCH' USING ERRCODE='42501';
  END IF;

  PERFORM set_config('app.void_ok','1',true);

  INSERT INTO public.cashadvance_transactions(
    cashadvance_id, kind, amount, tx_date, payroll_run_id, notes, created_by
  )
  SELECT
    cashadvance_id, 'adjustment', amount, current_date, payroll_run_id,
    'Reversal void payroll: ' || p_reason, auth.uid()
  FROM public.cashadvance_transactions
  WHERE payroll_run_id = p_run
    AND kind = 'deduction';

  UPDATE public.payroll_runs
  SET status = 'void',
      void_reason = p_reason,
      voided_by = auth.uid(),
      voided_at = now()
  WHERE id = p_run;

  INSERT INTO public.audit_log(actor, actor_email, action, table_name, record_id, reason)
  VALUES (
    auth.uid(),
    nullif(auth.jwt()->>'email',''),
    'PAYROLL_VOID',
    'payroll_runs',
    p_run::text,
    p_reason
  );
END
$function$;


DROP POLICY IF EXISTS p_pp_w ON public.payroll_periods;

CREATE POLICY p_pp_w
ON public.payroll_periods
FOR ALL
TO authenticated
USING (
  app_role() IN ('dev','hr','legacy_admin')
  AND has_perm('payroll.view')
  AND outlet_id IS NOT NULL
  AND (
    app_role() IN ('dev','legacy_admin')
    OR can_access_outlet(outlet_id)
  )
)
WITH CHECK (
  app_role() IN ('dev','hr','legacy_admin')
  AND has_perm('payroll.view')
  AND outlet_id IS NOT NULL
  AND (
    app_role() IN ('dev','legacy_admin')
    OR can_access_outlet(outlet_id)
  )
);


-- Overtime is now applied atomically inside payroll_calculate.
REVOKE EXECUTE ON FUNCTION public.payroll_apply_overtime(uuid) FROM PUBLIC, anon, authenticated;
