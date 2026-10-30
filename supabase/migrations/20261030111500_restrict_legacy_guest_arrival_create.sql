-- Remove the legacy overload that allowed direct creation in the final "Selesai" state.
-- The current guest-arrival.js client calls the 9-argument overload with p_table_name.
REVOKE EXECUTE ON FUNCTION public.guest_arrival_create(
  text, integer, text, text, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
