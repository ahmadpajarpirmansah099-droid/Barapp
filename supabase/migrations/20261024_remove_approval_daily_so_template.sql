-- Remove the Approval Closing Template Daily SO import feature.
-- Native Daily SO, Closing Approval, history, and report exports remain available.
drop function if exists public.barapp_closing_import_template(uuid, date, uuid, jsonb);
drop table if exists public.barapp_closing_template_imports;
