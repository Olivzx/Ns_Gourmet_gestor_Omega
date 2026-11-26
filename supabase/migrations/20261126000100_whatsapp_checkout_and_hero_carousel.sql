-- Additive WhatsApp checkout configuration and public hero carousel support.
-- Existing store settings, banner URL, products and orders are preserved.
ALTER TABLE public.public_store_settings
  ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS whatsapp_contact_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS whatsapp_message_template text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS hero_slides jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS hero_slides_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS hero_slide_interval_seconds integer NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='public_store_settings_hero_slides_array_check' AND conrelid='public.public_store_settings'::regclass) THEN
    ALTER TABLE public.public_store_settings ADD CONSTRAINT public_store_settings_hero_slides_array_check CHECK (jsonb_typeof(hero_slides)='array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='public_store_settings_hero_slide_interval_check' AND conrelid='public.public_store_settings'::regclass) THEN
    ALTER TABLE public.public_store_settings ADD CONSTRAINT public_store_settings_hero_slide_interval_check CHECK (hero_slide_interval_seconds BETWEEN 2 AND 30);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.public_order_menu()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  s public_store_settings%ROWTYPE;
  tz text;
  day_key text;
  day_config jsonb;
  current_time_local time;
  is_open boolean := false;
  schedule jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO s FROM public_store_settings WHERE id = true LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('storeName','NS Gourmet','whatsapp','','products','[]'::jsonb,'deliveryRates','[]'::jsonb,
      'businessHours',jsonb_build_object('enabled',false,'isOpen',false,'timeZone','America/Maceio'));
  END IF;
  tz := COALESCE(NULLIF(s.time_zone,''),'America/Maceio');
  schedule := COALESCE(s.business_hours,'{}'::jsonb);
  IF s.manual_open_override IS NOT NULL THEN
    is_open := s.manual_open_override;
  ELSE
    is_open := CASE WHEN COALESCE(s.business_hours_enabled,false) THEN true ELSE COALESCE(s.accepting_orders,false) END;
  END IF;
  IF s.manual_open_override IS NULL AND COALESCE(s.business_hours_enabled,false) THEN
    day_key := (ARRAY['sun','mon','tue','wed','thu','fri','sat'])[extract(dow FROM now() AT TIME ZONE tz)::int + 1];
    day_config := schedule -> day_key;
    current_time_local := (now() AT TIME ZONE tz)::time;
    is_open := COALESCE((day_config ->> 'closed')::boolean,false) = false
      AND NULLIF(day_config ->> 'open','') IS NOT NULL
      AND NULLIF(day_config ->> 'close','') IS NOT NULL
      AND current_time_local >= (day_config ->> 'open')::time
      AND current_time_local < (day_config ->> 'close')::time;
  END IF;
  RETURN jsonb_build_object(
    'storeName',s.store_name,'whatsapp',s.whatsapp,
    'whatsappEnabled',COALESCE(s.whatsapp_enabled,true),
    'whatsappContactName',COALESCE(NULLIF(s.whatsapp_contact_name,''),s.store_name,'NS Gourmet'),
    'whatsappMessageTemplate',COALESCE(s.whatsapp_message_template,''),
    'heroImageDataUrl',COALESCE(s.hero_image_url,''),
    'heroSlides',COALESCE(s.hero_slides,'[]'::jsonb),
    'heroSlidesEnabled',COALESCE(s.hero_slides_enabled,true),
    'heroSlideIntervalSeconds',COALESCE(s.hero_slide_interval_seconds,3),
    'products',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'category',p.category,
      'unitPriceCents',p.unit_price_cents,'available',p.available,'imageDataUrl',p.image_url) ORDER BY p.category,p.name)
      FROM public_order_products p WHERE p.available = true),'[]'::jsonb),
    'deliveryRates',COALESCE((SELECT jsonb_agg(jsonb_build_object('neighborhood',r.neighborhood,'feeCents',r.fee_cents)
      ORDER BY r.neighborhood) FROM public_order_delivery_rates r WHERE r.active = true),'[]'::jsonb),
    'businessHours',jsonb_build_object('enabled',COALESCE(s.business_hours_enabled,false),'isOpen',is_open,'manualOpenOverride',s.manual_open_override,'timeZone',tz,'schedule',schedule)
  );
END; $$;
REVOKE ALL ON FUNCTION public.public_order_menu() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_order_menu() TO service_role;
