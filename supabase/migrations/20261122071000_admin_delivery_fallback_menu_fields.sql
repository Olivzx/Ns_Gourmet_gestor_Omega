-- Expose the store's configurable distance-fallback freight settings to the public checkout.
CREATE OR REPLACE FUNCTION public.public_order_menu()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  s public.public_store_settings%ROWTYPE;
  tz text;
  day_key text;
  day_config jsonb;
  current_time_local time;
  is_open boolean := false;
  schedule jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO s FROM public.public_store_settings WHERE id = true LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'storeName', 'NS Gourmet',
      'whatsapp', '',
      'heroImageDataUrl', '',
      'deliveryFallbackCents', 200,
      'deliveryFallbackKm', 3,
      'products', '[]'::jsonb,
      'deliveryRates', '[]'::jsonb,
      'businessHours', jsonb_build_object('enabled', false, 'isOpen', false, 'timeZone', 'America/Maceio')
    );
  END IF;

  tz := COALESCE(NULLIF(s.time_zone, ''), 'America/Maceio');
  schedule := COALESCE(s.business_hours, '{}'::jsonb);
  is_open := COALESCE(s.accepting_orders, false);

  IF COALESCE(s.business_hours_enabled, false) THEN
    day_key := (ARRAY['sun','mon','tue','wed','thu','fri','sat'])[extract(dow FROM now() AT TIME ZONE tz)::int + 1];
    day_config := schedule -> day_key;
    current_time_local := (now() AT TIME ZONE tz)::time;
    is_open := COALESCE(s.accepting_orders, false)
      AND COALESCE((day_config ->> 'closed')::boolean, false) = false
      AND NULLIF(day_config ->> 'open', '') IS NOT NULL
      AND NULLIF(day_config ->> 'close', '') IS NOT NULL
      AND current_time_local >= (day_config ->> 'open')::time
      AND current_time_local < (day_config ->> 'close')::time;
  END IF;

  RETURN jsonb_build_object(
    'storeName', s.store_name,
    'whatsapp', s.whatsapp,
    'heroImageDataUrl', COALESCE(s.hero_image_url, ''),
    'deliveryFallbackCents', COALESCE(s.delivery_fallback_cents, 200),
    'deliveryFallbackKm', COALESCE(s.delivery_fallback_km, 3),
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'category', p.category,
        'unitPriceCents', p.unit_price_cents,
        'available', p.available,
        'imageDataUrl', p.image_url
      ) ORDER BY p.sort_order, p.category, p.name)
      FROM public.public_order_products p
      WHERE p.available = true
    ), '[]'::jsonb),
    'deliveryRates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'neighborhood', r.neighborhood,
        'feeCents', r.fee_cents
      ) ORDER BY r.neighborhood)
      FROM public.public_order_delivery_rates r
      WHERE r.active = true
    ), '[]'::jsonb),
    'businessHours', jsonb_build_object(
      'enabled', COALESCE(s.business_hours_enabled, false),
      'isOpen', is_open,
      'timeZone', tz,
      'schedule', schedule
    )
  );
END;
$$;
