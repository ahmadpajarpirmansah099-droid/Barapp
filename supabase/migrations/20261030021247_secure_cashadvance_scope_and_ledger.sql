-- Stage 2: scope cash advances to employee outlet/division and secure ledger writes.

ALTER TABLE public.cashadvance_transactions
  ADD COLUMN IF NOT EXISTS payment_request_key text;

-- Existing data was checked before this migration: all 16 amounts are positive,
-- and each of the 4 cash advances has exactly one initial issue transaction.
ALTER TABLE public.cashadvance_transactions
  DROP CONSTRAINT IF EXISTS cashadvance_transactions_check;

ALTER TABLE public.cashadvance_transactions
  ADD CONSTRAINT cashadvance_transactions_amount_positive
  CHECK (amount > 0);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cashadvance_issue_once
  ON public.cashadvance_transactions (cashadvance_id)
  WHERE kind = 'issue';

CREATE UNIQUE INDEX IF NOT EXISTS ux_cashadvance_payment_request_key
  ON public.cashadvance_transactions (payment_request_key)
  WHERE payment_request_key IS NOT NULL;

-- Serialize every ledger write on the owning cashadvance row.
-- Re-check the balance only after the parent row lock has been acquired.
CREATE OR REPLACE FUNCTION public.cashadvance_transaction_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_principal numeric;
  v_status text;
  v_balance numeric;
BEGIN
  SELECT c.principal, c.status
    INTO v_principal, v_status
  FROM public.cashadvances c
  WHERE c.id = NEW.cashadvance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CASHADVANCE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'CASHADVANCE_AMOUNT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.kind = 'issue' THEN
    IF v_status <> 'open'
       OR NEW.payroll_run_id IS NOT NULL
       OR NEW.payment_request_key IS NOT NULL
       OR NEW.amount <> v_principal THEN
      RAISE EXCEPTION 'CASHADVANCE_ISSUE_INVALID'
        USING ERRCODE = '22023';
    END IF;

  ELSIF NEW.kind IN ('payment', 'deduction') THEN
    IF v_status <> 'open' THEN
      RAISE EXCEPTION 'CASHADVANCE_NOT_OPEN'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.kind = 'payment' THEN
      IF NEW.payroll_run_id IS NOT NULL
         OR nullif(btrim(NEW.payment_request_key), '') IS NULL THEN
        RAISE EXCEPTION 'CASHADVANCE_PAYMENT_REQUEST_INVALID'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      IF NEW.payroll_run_id IS NULL
         OR NEW.payment_request_key IS NOT NULL THEN
        RAISE EXCEPTION 'CASHADVANCE_DEDUCTION_INVALID'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    SELECT coalesce(sum(
      CASE t.kind
        WHEN 'issue' THEN t.amount
        WHEN 'adjustment' THEN t.amount
        ELSE -t.amount
      END
    ), 0)
      INTO v_balance
    FROM public.cashadvance_transactions t
    WHERE t.cashadvance_id = NEW.cashadvance_id;

    IF NEW.amount > v_balance THEN
      RAISE EXCEPTION 'CASHADVANCE_INSUFFICIENT_BALANCE'
        USING ERRCODE = '22023';
    END IF;

  ELSIF NEW.kind = 'adjustment' THEN
    IF NEW.payroll_run_id IS NULL
       OR NEW.payment_request_key IS NOT NULL THEN
      RAISE EXCEPTION 'CASHADVANCE_ADJUSTMENT_INVALID'
        USING ERRCODE = '22023';
    END IF;

  ELSE
    RAISE EXCEPTION 'CASHADVANCE_TRANSACTION_KIND_INVALID'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL PRIVILEGES
ON FUNCTION public.cashadvance_transaction_guard()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cashadvance_transaction_guard
  ON public.cashadvance_transactions;

CREATE TRIGGER trg_cashadvance_transaction_guard
BEFORE INSERT ON public.cashadvance_transactions
FOR EACH ROW
EXECUTE FUNCTION public.cashadvance_transaction_guard();

-- Payment RPC: outlet-scoped, serialized, balance-checked and idempotent.
CREATE OR REPLACE FUNCTION public.cashadvance_register_payment(
  p_id uuid,
  p_amount numeric,
  p_tx_date date,
  p_notes text,
  p_request_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_cash public.cashadvances;
  v_existing public.cashadvance_transactions;
  v_balance numeric;
  v_tx_date date;
  v_notes text;
  v_request_key text;
  v_transaction_id uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Tidak berwenang'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.gaji_can()
     OR NOT public.has_perm('kasbon.manage') THEN
    RAISE EXCEPTION 'Tidak memiliki izin mengelola kasbon'
      USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> trunc(p_amount) THEN
    RAISE EXCEPTION 'Jumlah pembayaran harus berupa rupiah bulat lebih dari nol'
      USING ERRCODE = '22023';
  END IF;

  v_tx_date := coalesce(p_tx_date, v_today);
  IF v_tx_date > v_today THEN
    RAISE EXCEPTION 'Tanggal pembayaran tidak boleh di masa depan'
      USING ERRCODE = '22023';
  END IF;

  v_notes := coalesce(nullif(btrim(p_notes), ''), 'Pembayaran tunai');
  IF length(v_notes) > 300 THEN
    RAISE EXCEPTION 'Keterangan pembayaran maksimal 300 karakter'
      USING ERRCODE = '22023';
  END IF;

  v_request_key := nullif(btrim(p_request_key), '');
  IF v_request_key IS NULL OR length(v_request_key) > 120 THEN
    RAISE EXCEPTION 'Kunci permintaan pembayaran tidak valid'
      USING ERRCODE = '22023';
  END IF;

  SELECT c.*
    INTO v_cash
  FROM public.cashadvances c
  JOIN public.employees e ON e.id = c.employee_id
  WHERE c.id = p_id
    AND public.can_access_scope(e.outlet_id, e.division_id)
  FOR UPDATE OF c;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kasbon tidak ditemukan atau di luar scope akun'
      USING ERRCODE = '42501';
  END IF;

  -- A retried request with the same key returns its original transaction.
  SELECT t.*
    INTO v_existing
  FROM public.cashadvance_transactions t
  WHERE t.payment_request_key = v_request_key;

  IF FOUND THEN
    IF v_existing.cashadvance_id <> p_id
       OR v_existing.kind <> 'payment'
       OR v_existing.amount <> p_amount
       OR v_existing.tx_date <> v_tx_date
       OR coalesce(v_existing.notes, '') <> v_notes THEN
      RAISE EXCEPTION 'Kunci pembayaran sudah digunakan untuk data berbeda'
        USING ERRCODE = '22023';
    END IF;

    RETURN v_existing.id;
  END IF;

  IF v_cash.status <> 'open' THEN
    RAISE EXCEPTION 'Kasbon tidak berstatus terbuka'
      USING ERRCODE = '55000';
  END IF;

  SELECT coalesce(sum(
    CASE t.kind
      WHEN 'issue' THEN t.amount
      WHEN 'adjustment' THEN t.amount
      ELSE -t.amount
    END
  ), 0)
    INTO v_balance
  FROM public.cashadvance_transactions t
  WHERE t.cashadvance_id = p_id;

  IF v_balance <= 0 THEN
    RAISE EXCEPTION 'Saldo kasbon sudah lunas'
      USING ERRCODE = '55000';
  END IF;

  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'Pembayaran melebihi saldo kasbon'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.cashadvance_transactions (
    cashadvance_id, kind, amount, tx_date, notes, created_by, payment_request_key
  )
  VALUES (
    p_id, 'payment', p_amount, v_tx_date, v_notes, auth.uid(), v_request_key
  )
  RETURNING id INTO v_transaction_id;

  RETURN v_transaction_id;
END
$function$;

-- Void RPC: only void a kasbon that has no payment, payroll deduction or adjustment.
CREATE OR REPLACE FUNCTION public.cashadvance_void(
  p_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_cash public.cashadvances;
  v_reason text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Tidak berwenang'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.gaji_can()
     OR NOT public.has_perm('kasbon.manage') THEN
    RAISE EXCEPTION 'Tidak memiliki izin mengelola kasbon'
      USING ERRCODE = '42501';
  END IF;

  v_reason := nullif(btrim(p_reason), '');
  IF v_reason IS NULL OR length(v_reason) > 300 THEN
    RAISE EXCEPTION 'Alasan pembatalan wajib diisi, maksimal 300 karakter'
      USING ERRCODE = '22023';
  END IF;

  SELECT c.*
    INTO v_cash
  FROM public.cashadvances c
  JOIN public.employees e ON e.id = c.employee_id
  WHERE c.id = p_id
    AND public.can_access_scope(e.outlet_id, e.division_id)
  FOR UPDATE OF c;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kasbon tidak ditemukan atau di luar scope akun'
      USING ERRCODE = '42501';
  END IF;

  IF v_cash.status <> 'open' THEN
    RAISE EXCEPTION 'Hanya kasbon terbuka yang dapat dibatalkan'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cashadvance_transactions t
    WHERE t.cashadvance_id = p_id
      AND t.kind <> 'issue'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.cashadvance_transactions t
    WHERE t.cashadvance_id = p_id
      AND t.kind = 'issue'
      AND t.amount = v_cash.principal
  ) THEN
    RAISE EXCEPTION 'Kasbon sudah memiliki pembayaran, potongan, atau koreksi'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.cashadvances
  SET status = 'void',
      notes = CASE
        WHEN coalesce(nullif(btrim(notes), ''), '') = ''
          THEN 'Dibatalkan: ' || v_reason
        ELSE notes || E'\n' || 'Dibatalkan: ' || v_reason
      END,
      updated_at = now()
  WHERE id = p_id;
END
$function$;

REVOKE ALL PRIVILEGES
ON FUNCTION public.cashadvance_register_payment(uuid, numeric, date, text, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.cashadvance_register_payment(uuid, numeric, date, text, text)
TO authenticated;

REVOKE ALL PRIVILEGES
ON FUNCTION public.cashadvance_void(uuid, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.cashadvance_void(uuid, text)
TO authenticated;

-- Remove broad table/column writes. Kasbon creation is limited to business fields;
-- transaction ledger writes are performed only by guarded database routines.
REVOKE ALL PRIVILEGES
ON TABLE public.cashadvances
FROM PUBLIC, anon, authenticated;

REVOKE INSERT (
  id, employee_id, principal, installment, issued_on, status,
  notes, created_by, created_at, updated_at
)
ON TABLE public.cashadvances
FROM PUBLIC, anon, authenticated;

REVOKE UPDATE (
  id, employee_id, principal, installment, issued_on, status,
  notes, created_by, created_at, updated_at
)
ON TABLE public.cashadvances
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.cashadvances TO authenticated;

GRANT INSERT (
  employee_id, principal, installment, issued_on, notes
)
ON TABLE public.cashadvances
TO authenticated;

REVOKE ALL PRIVILEGES
ON TABLE public.cashadvance_transactions
FROM PUBLIC, anon, authenticated;

REVOKE INSERT (
  id, cashadvance_id, kind, amount, tx_date, payroll_run_id,
  notes, created_by, created_at, payment_request_key
)
ON TABLE public.cashadvance_transactions
FROM PUBLIC, anon, authenticated;

GRANT SELECT
ON TABLE public.cashadvance_transactions
TO authenticated;

-- Replace the broad ALL policies with explicit scoped read/create policies.
DROP POLICY IF EXISTS kas_sel ON public.cashadvances;
DROP POLICY IF EXISTS kas_w ON public.cashadvances;
DROP POLICY IF EXISTS kast_sel ON public.cashadvance_transactions;
DROP POLICY IF EXISTS kast_w ON public.cashadvance_transactions;

ALTER TABLE public.cashadvances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashadvance_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY kas_sel
ON public.cashadvances
FOR SELECT
TO authenticated
USING (
  (SELECT auth.uid()) IS NOT NULL
  AND (SELECT public.gaji_can())
  AND (
    (SELECT public.has_perm('payroll.view'))
    OR (SELECT public.has_perm('kasbon.manage'))
  )
  AND EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = cashadvances.employee_id
      AND public.can_access_scope(e.outlet_id, e.division_id)
  )
);

CREATE POLICY kas_ins
ON public.cashadvances
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT auth.uid()) IS NOT NULL
  AND (SELECT public.gaji_can())
  AND (SELECT public.has_perm('kasbon.manage'))
  AND EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = cashadvances.employee_id
      AND e.active IS TRUE
      AND e.deleted_at IS NULL
      AND public.can_access_scope(e.outlet_id, e.division_id)
  )
);

CREATE POLICY kast_sel
ON public.cashadvance_transactions
FOR SELECT
TO authenticated
USING (
  (SELECT auth.uid()) IS NOT NULL
  AND (SELECT public.gaji_can())
  AND (
    (SELECT public.has_perm('payroll.view'))
    OR (SELECT public.has_perm('kasbon.manage'))
  )
  AND EXISTS (
    SELECT 1
    FROM public.cashadvances c
    JOIN public.employees e ON e.id = c.employee_id
    WHERE c.id = cashadvance_transactions.cashadvance_id
      AND public.can_access_scope(e.outlet_id, e.division_id)
  )
);
