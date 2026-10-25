BEGIN;
REVOKE ALL ON FUNCTION public.guest_arrival_can_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guest_arrival_can_access() TO authenticated;

CREATE POLICY guest_arrival_counters_deny_all
  ON public.guest_arrival_daily_counters
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);
COMMIT;