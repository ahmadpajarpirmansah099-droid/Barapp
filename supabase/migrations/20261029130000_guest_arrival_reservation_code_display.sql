-- Include the linked reservation code in Guest Arrival row payloads.
-- This is read-only metadata enrichment: no data, table structure, or access rules change.
CREATE OR REPLACE FUNCTION public.guest_arrival_row_json(p_row guest_arrivals)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', p_row.id,
    'outlet_id', p_row.outlet_id,
    'outlet_code', (SELECT o.code FROM public.outlets o WHERE o.id=p_row.outlet_id),
    'outlet_name', (SELECT o.name FROM public.outlets o WHERE o.id=p_row.outlet_id),
    'operational_date', p_row.operational_date,
    'queue_number', p_row.queue_number,
    'queue_code', 'WL-' || lpad(p_row.queue_number::text, 3, '0'),
    'reservation_code', (
      SELECT r.reservation_code
      FROM public.guest_reservations r
      WHERE r.guest_arrival_id = p_row.id
      LIMIT 1
    ),
    'guest_name', p_row.guest_name,
    'packs', p_row.packs,
    'whatsapp', p_row.whatsapp,
    'smoking_preference', p_row.smoking_preference,
    'note', p_row.note,
    'arrived_at', p_row.arrived_at,
    'status', p_row.status,
    'table_name', p_row.table_name,
    'seated_at', p_row.seated_at,
    'finished_at', p_row.finished_at,
    'waiting_seconds', p_row.waiting_seconds,
    'cancellation_reason', p_row.cancellation_reason,
    'created_by_email', p_row.created_by_email,
    'created_at', p_row.created_at,
    'correction_count', (
      SELECT count(*) FROM public.guest_arrival_changes c
      WHERE c.guest_arrival_id = p_row.id AND c.change_type = 'CORRECTION'
    ),
    'last_correction_at', (
      SELECT max(c.changed_at) FROM public.guest_arrival_changes c
      WHERE c.guest_arrival_id = p_row.id AND c.change_type = 'CORRECTION'
    ),
    'last_correction_reason', (
      SELECT c.reason FROM public.guest_arrival_changes c
      WHERE c.guest_arrival_id = p_row.id AND c.change_type = 'CORRECTION'
      ORDER BY c.changed_at DESC LIMIT 1
    )
  );
$function$;
