-- Keep internal backup tables unavailable to API roles.
-- These tables are backup snapshots; the application has no direct-client workflow for them.
-- RLS remains enabled without policies as defense in depth.
REVOKE ALL PRIVILEGES ON TABLE public.cogs_data_backup, public.user_scopes_backup
  FROM PUBLIC, anon, authenticated;
