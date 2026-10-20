-- Applied to Supabase production as migration: optimize_auth_rls_initplan
-- Scope: performance-only RLS optimization; authorization semantics are unchanged.
-- Rollback: replace "(SELECT auth.uid())" with "auth.uid()" in the four policies below.

ALTER POLICY p_rel_ins ON public.payslip_releases
WITH CHECK (
  (app_role() = ANY (ARRAY['dev'::text, 'hr'::text])
   AND has_perm('payslip.release'::text)
   AND released_by = (SELECT auth.uid())
   AND EXISTS (
     SELECT 1
     FROM public.payroll_items i
     JOIN public.payroll_runs r ON r.id = i.run_id
     WHERE i.id = payslip_releases.item_id
       AND r.status = 'finalized'::text
   ))
);

ALTER POLICY p_prof_sel ON public.user_profiles
USING ((user_id = (SELECT auth.uid())) OR is_dev());

ALTER POLICY p_scope_sel ON public.user_scopes
USING ((user_id = (SELECT auth.uid())) OR is_dev());

ALTER POLICY p_perm_sel ON public.user_permissions
USING ((user_id = (SELECT auth.uid())) OR is_dev());
