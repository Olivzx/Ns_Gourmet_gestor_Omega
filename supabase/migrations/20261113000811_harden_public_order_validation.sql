-- NS Gourmet public order API
-- Server-side only: Vercel calls these functions using SUPABASE_SERVICE_ROLE_KEY.
-- Direct browser roles are explicitly denied; service_role bypasses RLS.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['public_store_settings','public_order_products','public_order_delivery_rates','public_orders','public_order_items'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'deny_client_access_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', 'deny_client_access_' || t, t);
  END LOOP;
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
    'products',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'category',p.category,
      'unitPriceCents',p.unit_price_cents,'available',p.available,'imageDataUrl',p.image_url) ORDER BY p.category,p.name)
      FROM public_order_products p WHERE p.available = true),'[]'::jsonb),
    'deliveryRates',COALESCE((SELECT jsonb_agg(jsonb_build_object('neighborhood',r.neighborhood,'feeCents',r.fee_cents)
      ORDER BY r.neighborhood) FROM public_order_delivery_rates r WHERE r.active = true),'[]'::jsonb),
    'businessHours',jsonb_build_object('enabled',COALESCE(s.business_hours_enabled,false),'isOpen',is_open,'timeZone',tz,'schedule',schedule)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.create_public_order(p_order jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  s public_store_settings%ROWTYPE;
  v_request_id uuid;
  v_existing public_orders%ROWTYPE;
  v_order_id uuid;
  v_customer_name text;
  v_phone text;
  v_address text;
  v_neighborhood text;
  v_fulfillment text;
  v_payment text;
  v_notes text;
  v_subtotal bigint := 0;
  v_delivery_fee bigint := 0;
  v_total bigint := 0;
  v_product public_order_products%ROWTYPE;
  v_item jsonb;
  v_product_id text;
  v_quantity integer;
  v_tz text;
  v_day_key text;
  v_day_config jsonb;
  v_current_time time;
BEGIN
  IF p_order IS NULL OR jsonb_typeof(p_order) <> 'object' THEN RAISE EXCEPTION 'Dados do pedido inválidos.'; END IF;
  BEGIN v_request_id := (p_order ->> 'requestId')::uuid;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'Identificador do pedido inválido.'; END;
  IF v_request_id IS NULL THEN RAISE EXCEPTION 'Identificador do pedido inválido.'; END IF;

  SELECT * INTO s FROM public_store_settings WHERE id = true LIMIT 1;
  IF NOT FOUND OR COALESCE(s.accepting_orders,false) = false THEN RAISE EXCEPTION 'A loja não está aceitando pedidos no momento.'; END IF;
  v_tz := COALESCE(NULLIF(s.time_zone,''),'America/Maceio');
  IF COALESCE(s.business_hours_enabled,false) THEN
    v_day_key := (ARRAY['sun','mon','tue','wed','thu','fri','sat'])[extract(dow FROM now() AT TIME ZONE v_tz)::int + 1];
    v_day_config := COALESCE(s.business_hours,'{}'::jsonb) -> v_day_key;
    v_current_time := (now() AT TIME ZONE v_tz)::time;
    IF v_day_config IS NULL OR COALESCE((v_day_config ->> 'closed')::boolean,false)
      OR NULLIF(v_day_config ->> 'open','') IS NULL OR NULLIF(v_day_config ->> 'close','') IS NULL
      OR v_current_time < (v_day_config ->> 'open')::time OR v_current_time >= (v_day_config ->> 'close')::time
    THEN RAISE EXCEPTION 'A loja está fora do horário de atendimento.'; END IF;
  END IF;

  v_customer_name := NULLIF(btrim(p_order ->> 'customerName'),'');
  v_phone := NULLIF(btrim(p_order ->> 'phone'),'');
  v_address := NULLIF(btrim(p_order ->> 'address'),'');
  v_neighborhood := NULLIF(btrim(p_order ->> 'neighborhood'),'');
  v_fulfillment := p_order ->> 'fulfillmentType';
  v_payment := p_order ->> 'paymentMethod';
  v_notes := NULLIF(btrim(p_order ->> 'notes'),'');
  IF v_customer_name IS NULL THEN RAISE EXCEPTION 'Informe o nome do cliente.'; END IF;
  IF v_fulfillment IS NULL OR v_fulfillment NOT IN ('delivery','pickup') THEN RAISE EXCEPTION 'Modalidade de recebimento inválida.'; END IF;
  IF v_payment IS NULL OR v_payment NOT IN ('pix','cash','debit','credit') THEN RAISE EXCEPTION 'Selecione uma forma de pagamento válida.'; END IF;
  IF v_fulfillment = 'delivery' AND (v_address IS NULL OR v_neighborhood IS NULL) THEN RAISE EXCEPTION 'Informe endereço e bairro para entrega.'; END IF;
  IF COALESCE(jsonb_typeof(p_order -> 'items'),'') <> 'array' OR jsonb_array_length(COALESCE(p_order -> 'items','[]'::jsonb)) = 0
    THEN RAISE EXCEPTION 'Adicione pelo menos um produto ao pedido.'; END IF;

  SELECT * INTO v_existing FROM public_orders WHERE request_id = v_request_id;
  IF FOUND THEN RETURN jsonb_build_object('orderId',v_existing.id,'totalCents',v_existing.total_cents,'duplicate',true); END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_order -> 'items') LOOP
    v_product_id := NULLIF(btrim(v_item ->> 'productId'),'');
    BEGIN v_quantity := (v_item ->> 'quantity')::integer;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'Quantidade de produto inválida.'; END;
    IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity < 1 OR v_quantity > 99 THEN RAISE EXCEPTION 'Produto ou quantidade inválida.'; END IF;
    SELECT * INTO v_product FROM public_order_products WHERE id = v_product_id AND available = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Um dos produtos não está disponível.'; END IF;
    v_subtotal := v_subtotal + (v_product.unit_price_cents * v_quantity);
  END LOOP;

  IF v_fulfillment = 'delivery' THEN
    SELECT fee_cents INTO v_delivery_fee FROM public_order_delivery_rates WHERE neighborhood = v_neighborhood AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Não realizamos entrega para o bairro informado.'; END IF;
  END IF;
  v_total := v_subtotal + v_delivery_fee;

  INSERT INTO public_orders(request_id,customer_name,phone,address,neighborhood,fulfillment_type,payment_method,notes,subtotal_cents,delivery_fee_cents,total_cents)
  VALUES(v_request_id,v_customer_name,v_phone,v_address,v_neighborhood,v_fulfillment,v_payment,v_notes,v_subtotal,v_delivery_fee,v_total)
  ON CONFLICT(request_id) DO NOTHING RETURNING id INTO v_order_id;
  IF v_order_id IS NULL THEN
    SELECT * INTO v_existing FROM public_orders WHERE request_id = v_request_id;
    RETURN jsonb_build_object('orderId',v_existing.id,'totalCents',v_existing.total_cents,'duplicate',true);
  END IF;

  INSERT INTO public_order_items(order_id,product_id,product_name,quantity,unit_price_cents)
  SELECT v_order_id,p.id,p.name,SUM((i.value ->> 'quantity')::integer)::integer,p.unit_price_cents
  FROM jsonb_array_elements(p_order -> 'items') i(value)
  JOIN public_order_products p ON p.id = i.value ->> 'productId'
  GROUP BY p.id,p.name,p.unit_price_cents;
  RETURN jsonb_build_object('orderId',v_order_id,'totalCents',v_total,'duplicate',false);
END; $$;

REVOKE ALL ON FUNCTION public.public_order_menu() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_public_order(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_order_menu() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_public_order(jsonb) TO service_role;
