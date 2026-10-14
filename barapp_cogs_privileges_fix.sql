-- Keep the updated_at trigger helper callable only by database trigger execution.
revoke all on function public.cogs_touch_updated_at() from public, anon, authenticated;
