-- Ordenacao personalizada do cardapio NS Gourmet
ALTER TABLE public.public_order_products
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.admin_menu_categories (
  name text PRIMARY KEY,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_menu_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_client_access_admin_menu_categories ON public.admin_menu_categories;
CREATE POLICY deny_client_access_admin_menu_categories ON public.admin_menu_categories
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.admin_menu_categories FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_menu_categories TO service_role;

INSERT INTO public.admin_menu_categories(name, sort_order, created_at)
SELECT category, row_number() OVER (ORDER BY lower(category))::integer, first_product_at
FROM (
  SELECT btrim(category) AS category, min(created_at) AS first_product_at
  FROM public.public_order_products
  WHERE btrim(category) <> ''
  GROUP BY btrim(category)
) c
ON CONFLICT (name) DO NOTHING;

WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY lower(category), lower(name), created_at, id)::integer AS pos
  FROM public.public_order_products
)
UPDATE public.public_order_products p SET sort_order = ranked.pos
FROM ranked WHERE p.id = ranked.id AND p.sort_order = 0;

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
  is_open := COALESCE(s.accepting_orders,false);
  IF COALESCE(s.business_hours_enabled,false) THEN
    day_key := (ARRAY['sun','mon','tue','wed','thu','fri','sat'])[extract(dow FROM now() AT TIME ZONE tz)::int + 1];
    day_config := schedule -> day_key;
    current_time_local := (now() AT TIME ZONE tz)::time;
    is_open := COALESCE(s.accepting_orders,false)
      AND COALESCE((day_config ->> 'closed')::boolean,false) = false
      AND NULLIF(day_config ->> 'open','') IS NOT NULL
      AND NULLIF(day_config ->> 'close','') IS NOT NULL
      AND current_time_local >= (day_config ->> 'open')::time
      AND current_time_local < (day_config ->> 'close')::time;
  END IF;
  RETURN jsonb_build_object(
    'storeName',s.store_name,'whatsapp',s.whatsapp,
    'products',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'category',p.category,
        'unitPriceCents',p.unit_price_cents,'available',p.available,'imageDataUrl',p.image_url)
        ORDER BY COALESCE(c.sort_order,2147483647), p.sort_order, lower(p.name), p.created_at)
      FROM public_order_products p
      LEFT JOIN public.admin_menu_categories c ON c.name = p.category
      WHERE p.available = true
    ),'[]'::jsonb),
    'deliveryRates',COALESCE((SELECT jsonb_agg(jsonb_build_object('neighborhood',r.neighborhood,'feeCents',r.fee_cents)
      ORDER BY r.neighborhood) FROM public_order_delivery_rates r WHERE r.active = true),'[]'::jsonb),
    'businessHours',jsonb_build_object('enabled',COALESCE(s.business_hours_enabled,false),'isOpen',is_open,'timeZone',tz,'schedule',schedule)
  );
END; $$;

REVOKE ALL ON FUNCTION public.public_order_menu() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_order_menu() TO service_role;
