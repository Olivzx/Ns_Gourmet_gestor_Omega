-- NS Gourmet Gestor Omega: gerência financeira, estoque e catálogo profissional.
-- O acesso aos módulos administrativos é feito exclusivamente pelo Cloudflare Worker.

ALTER TABLE public.public_order_products
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS cost_price_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prep_minutes integer,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='public_order_products_cost_price_cents_check') THEN
    ALTER TABLE public.public_order_products ADD CONSTRAINT public_order_products_cost_price_cents_check CHECK (cost_price_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='public_order_products_prep_minutes_check') THEN
    ALTER TABLE public.public_order_products ADD CONSTRAINT public_order_products_prep_minutes_check CHECK (prep_minutes IS NULL OR prep_minutes >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS public_order_products_sku_unique
  ON public.public_order_products (lower(sku))
  WHERE sku IS NOT NULL AND length(btrim(sku)) > 0;

ALTER TABLE public.public_order_items
  ADD COLUMN IF NOT EXISTS unit_cost_cents bigint NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='public_order_items_unit_cost_cents_check') THEN
    ALTER TABLE public.public_order_items ADD CONSTRAINT public_order_items_unit_cost_cents_check CHECK (unit_cost_cents >= 0);
  END IF;
END $$;

ALTER TABLE public.public_orders
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='public_orders_payment_status_check') THEN
    ALTER TABLE public.public_orders ADD CONSTRAINT public_orders_payment_status_check CHECK (payment_status IN ('pending','paid','refunded'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.admin_finance_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('income','expense')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_finance_categories_name_kind_key UNIQUE (name, kind)
);

CREATE TABLE IF NOT EXISTS public.admin_finance_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('income','expense')),
  category_id uuid REFERENCES public.admin_finance_categories(id) ON DELETE RESTRICT,
  description text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('pending','paid','void')),
  due_date date NOT NULL DEFAULT current_date,
  paid_at timestamptz,
  payment_method text CHECK (payment_method IS NULL OR payment_method IN ('pix','cash','debit','credit','transfer','other')),
  source_order_id uuid UNIQUE REFERENCES public.public_orders(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_finance_entries_due_date_idx ON public.admin_finance_entries (due_date DESC);
CREATE INDEX IF NOT EXISTS admin_finance_entries_status_paid_at_idx ON public.admin_finance_entries (status, paid_at DESC);
CREATE INDEX IF NOT EXISTS admin_finance_entries_kind_idx ON public.admin_finance_entries (kind, status);
CREATE INDEX IF NOT EXISTS admin_finance_entries_category_id_idx ON public.admin_finance_entries (category_id);

CREATE TABLE IF NOT EXISTS public.admin_inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'un',
  quantity_on_hand numeric(12,3) NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  minimum_quantity numeric(12,3) NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0),
  unit_cost_cents bigint NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_inventory_items_active_name_idx ON public.admin_inventory_items (active, name);

CREATE TABLE IF NOT EXISTS public.admin_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.admin_inventory_items(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('in','out','adjustment')),
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_cost_cents bigint CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  reason text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_stock_movements_item_created_idx ON public.admin_stock_movements (item_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_apply_stock_movement()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE affected integer;
BEGIN
  IF NEW.movement_type = 'in' THEN
    UPDATE admin_inventory_items
       SET quantity_on_hand = quantity_on_hand + NEW.quantity, updated_at = now()
     WHERE id = NEW.item_id;
  ELSIF NEW.movement_type = 'out' THEN
    UPDATE admin_inventory_items
       SET quantity_on_hand = quantity_on_hand - NEW.quantity, updated_at = now()
     WHERE id = NEW.item_id AND quantity_on_hand >= NEW.quantity;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected = 0 THEN
      IF NOT EXISTS (SELECT 1 FROM admin_inventory_items WHERE id = NEW.item_id) THEN
        RAISE EXCEPTION 'Insumo não encontrado.';
      END IF;
      RAISE EXCEPTION 'Estoque insuficiente para esta saída.';
    END IF;
  ELSE
    UPDATE admin_inventory_items
       SET quantity_on_hand = NEW.quantity, updated_at = now()
     WHERE id = NEW.item_id;
  END IF;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN RAISE EXCEPTION 'Insumo não encontrado.'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_stock_movement_apply ON public.admin_stock_movements;
CREATE TRIGGER admin_stock_movement_apply
AFTER INSERT ON public.admin_stock_movements
FOR EACH ROW EXECUTE FUNCTION public.admin_apply_stock_movement();

INSERT INTO public.admin_finance_categories (name, kind) VALUES
  ('Pedidos online','income'),('Vendas avulsas','income'),('Outras entradas','income'),
  ('Ingredientes','expense'),('Embalagens','expense'),('Taxas e tarifas','expense'),
  ('Entrega','expense'),('Equipamentos','expense'),('Marketing','expense'),
  ('Despesas fixas','expense'),('Outras despesas','expense')
ON CONFLICT (name, kind) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_set_order_payment_status(p_order_id uuid, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_order public.public_orders%ROWTYPE;
  v_category_id uuid;
BEGIN
  IF p_status NOT IN ('pending','paid','refunded') THEN
    RAISE EXCEPTION 'Status de pagamento inválido.';
  END IF;
  UPDATE public_orders
     SET payment_status = p_status,
         paid_at = CASE WHEN p_status = 'paid' THEN COALESCE(paid_at, now()) ELSE NULL END
   WHERE id = p_order_id
   RETURNING * INTO v_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;

  IF p_status = 'paid' THEN
    SELECT id INTO v_category_id FROM admin_finance_categories
     WHERE name = 'Pedidos online' AND kind = 'income' LIMIT 1;
    INSERT INTO admin_finance_entries (
      kind, category_id, description, amount_cents, status, due_date,
      paid_at, payment_method, source_order_id
    ) VALUES (
      'income', v_category_id, 'Pedido online ' || left(v_order.id::text, 8),
      v_order.total_cents, 'paid', (now() AT TIME ZONE 'America/Maceio')::date,
      v_order.paid_at, v_order.payment_method, v_order.id
    )
    ON CONFLICT (source_order_id) DO UPDATE SET
      amount_cents = EXCLUDED.amount_cents, status = 'paid', paid_at = EXCLUDED.paid_at,
      payment_method = EXCLUDED.payment_method, updated_at = now();
  ELSE
    UPDATE admin_finance_entries SET status = 'void', updated_at = now()
     WHERE source_order_id = v_order.id;
  END IF;

  RETURN jsonb_build_object('orderId', v_order.id, 'paymentStatus', v_order.payment_status, 'paidAt', v_order.paid_at);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_order_payment_status(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_order_payment_status(uuid, text) TO service_role;

ALTER TABLE public.admin_finance_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_finance_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_client_access_admin_finance_categories ON public.admin_finance_categories;
CREATE POLICY deny_client_access_admin_finance_categories ON public.admin_finance_categories FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS deny_client_access_admin_finance_entries ON public.admin_finance_entries;
CREATE POLICY deny_client_access_admin_finance_entries ON public.admin_finance_entries FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS deny_client_access_admin_inventory_items ON public.admin_inventory_items;
CREATE POLICY deny_client_access_admin_inventory_items ON public.admin_inventory_items FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS deny_client_access_admin_stock_movements ON public.admin_stock_movements;
CREATE POLICY deny_client_access_admin_stock_movements ON public.admin_stock_movements FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE public.admin_finance_categories, public.admin_finance_entries,
  public.admin_inventory_items, public.admin_stock_movements FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_finance_categories,
  public.admin_finance_entries, public.admin_inventory_items, public.admin_stock_movements TO service_role;

-- Captura o custo vigente no momento do pedido, sem alterar o preço público.
CREATE OR REPLACE FUNCTION public.create_public_order(p_order jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public' AS $function$
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
  IF NOT FOUND OR COALESCE(s.accepting_orders, false) = false THEN RAISE EXCEPTION 'A loja não está aceitando pedidos no momento.'; END IF;
  v_tz := COALESCE(NULLIF(s.time_zone, ''), 'America/Maceio');
  IF COALESCE(s.business_hours_enabled, false) THEN
    v_day_key := (ARRAY['sun','mon','tue','wed','thu','fri','sat'])[extract(dow FROM now() AT TIME ZONE v_tz)::int + 1];
    v_day_config := COALESCE(s.business_hours, '{}'::jsonb) -> v_day_key;
    v_current_time := (now() AT TIME ZONE v_tz)::time;
    IF v_day_config IS NULL OR COALESCE((v_day_config ->> 'closed')::boolean, false)
       OR NULLIF(v_day_config ->> 'open', '') IS NULL OR NULLIF(v_day_config ->> 'close', '') IS NULL
       OR v_current_time < (v_day_config ->> 'open')::time OR v_current_time >= (v_day_config ->> 'close')::time THEN
      RAISE EXCEPTION 'A loja está fora do horário de atendimento.';
    END IF;
  END IF;

  v_customer_name := NULLIF(btrim(p_order ->> 'customerName'), '');
  v_phone := NULLIF(btrim(p_order ->> 'phone'), '');
  v_address := NULLIF(btrim(p_order ->> 'address'), '');
  v_neighborhood := NULLIF(btrim(p_order ->> 'neighborhood'), '');
  v_fulfillment := p_order ->> 'fulfillmentType';
  v_payment := p_order ->> 'paymentMethod';
  v_notes := NULLIF(btrim(p_order ->> 'notes'), '');
  IF v_customer_name IS NULL THEN RAISE EXCEPTION 'Informe o nome do cliente.'; END IF;
  IF v_fulfillment IS NULL OR v_fulfillment NOT IN ('delivery','pickup') THEN RAISE EXCEPTION 'Modalidade de recebimento inválida.'; END IF;
  IF v_payment IS NULL OR v_payment NOT IN ('pix','cash','debit','credit') THEN RAISE EXCEPTION 'Selecione uma forma de pagamento válida.'; END IF;
  IF v_fulfillment = 'delivery' AND (v_address IS NULL OR v_neighborhood IS NULL) THEN RAISE EXCEPTION 'Informe endereço e bairro para entrega.'; END IF;
  IF COALESCE(jsonb_typeof(p_order -> 'items'), '') <> 'array' OR jsonb_array_length(COALESCE(p_order -> 'items', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Adicione pelo menos um produto ao pedido.';
  END IF;
  SELECT * INTO v_existing FROM public_orders WHERE request_id = v_request_id;
  IF FOUND THEN RETURN jsonb_build_object('orderId', v_existing.id, 'totalCents', v_existing.total_cents, 'duplicate', true); END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_order -> 'items') LOOP
    v_product_id := NULLIF(btrim(v_item ->> 'productId'), '');
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

  INSERT INTO public_orders (
    request_id, customer_name, phone, address, neighborhood, fulfillment_type, payment_method, notes,
    subtotal_cents, delivery_fee_cents, total_cents
  ) VALUES (
    v_request_id, v_customer_name, v_phone, v_address, v_neighborhood, v_fulfillment, v_payment, v_notes,
    v_subtotal, v_delivery_fee, v_total
  ) ON CONFLICT (request_id) DO NOTHING RETURNING id INTO v_order_id;

  IF v_order_id IS NULL THEN
    SELECT * INTO v_existing FROM public_orders WHERE request_id = v_request_id;
    RETURN jsonb_build_object('orderId', v_existing.id, 'totalCents', v_existing.total_cents, 'duplicate', true);
  END IF;

  INSERT INTO public_order_items (order_id, product_id, product_name, quantity, unit_price_cents, unit_cost_cents)
  SELECT v_order_id, p.id, p.name, SUM((i.value ->> 'quantity')::integer)::integer, p.unit_price_cents, p.cost_price_cents
  FROM jsonb_array_elements(p_order -> 'items') i(value)
  JOIN public_order_products p ON p.id = i.value ->> 'productId'
  GROUP BY p.id, p.name, p.unit_price_cents, p.cost_price_cents;

  RETURN jsonb_build_object('orderId', v_order_id, 'totalCents', v_total, 'duplicate', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.public_order_menu()
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public' AS $function$
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
    RETURN jsonb_build_object(
      'storeName','NS Gourmet','whatsapp','','products','[]'::jsonb,'deliveryRates','[]'::jsonb,
      'businessHours',jsonb_build_object('enabled',false,'isOpen',false,'timeZone','America/Maceio')
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
    'storeName',s.store_name,'whatsapp',s.whatsapp,
    'products',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',p.id,'name',p.name,'description',p.description,'category',p.category,
        'unitPriceCents',p.unit_price_cents,'available',p.available,'imageDataUrl',p.image_url
      ) ORDER BY p.category,p.name) FROM public_order_products p WHERE p.available = true
    ),'[]'::jsonb),
    'deliveryRates',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('neighborhood',r.neighborhood,'feeCents',r.fee_cents)
      ORDER BY r.neighborhood) FROM public_order_delivery_rates r WHERE r.active = true
    ),'[]'::jsonb),
    'businessHours',jsonb_build_object('enabled',COALESCE(s.business_hours_enabled,false),'isOpen',is_open,'timeZone',tz,'schedule',schedule)
  );
END;
$function$;
