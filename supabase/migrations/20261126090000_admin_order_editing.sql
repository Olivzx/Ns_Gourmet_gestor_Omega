-- Atualização transacional de pedidos pela área administrativa.
CREATE OR REPLACE FUNCTION public.admin_update_public_order(p_order_id uuid, p_order jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_order public_orders%ROWTYPE;
  v_status text;
  v_subtotal bigint;
  v_delivery_fee bigint;
BEGIN
  IF p_order IS NULL OR jsonb_typeof(p_order) <> 'object' THEN
    RAISE EXCEPTION 'Dados do pedido inválidos.';
  END IF;
  SELECT * INTO v_order FROM public_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;

  v_status := v_order.status;
  IF p_order ? 'status' THEN
    v_status := CASE p_order->>'status'
      WHEN 'novo' THEN 'received'
      WHEN 'preparando' THEN 'preparing'
      WHEN 'pronto' THEN 'ready'
      WHEN 'saiu_entrega' THEN 'out_for_delivery'
      WHEN 'entregue' THEN 'completed'
      WHEN 'cancelado' THEN 'cancelled'
      ELSE NULL
    END;
    IF v_status IS NULL THEN RAISE EXCEPTION 'Status inválido.'; END IF;
  END IF;

  IF p_order ? 'customerName' AND NULLIF(btrim(p_order->>'customerName'),'') IS NULL THEN
    RAISE EXCEPTION 'O nome do cliente é obrigatório.';
  END IF;
  IF p_order ? 'fulfillmentType' AND p_order->>'fulfillmentType' NOT IN ('delivery','pickup') THEN
    RAISE EXCEPTION 'Modalidade de recebimento inválida.';
  END IF;
  IF p_order ? 'paymentMethod' AND p_order->>'paymentMethod' NOT IN ('pix','cash','debit','credit') THEN
    RAISE EXCEPTION 'Forma de pagamento inválida.';
  END IF;

  IF p_order ? 'items' THEN
    IF jsonb_typeof(p_order->'items') <> 'array' OR jsonb_array_length(p_order->'items') = 0 THEN
      RAISE EXCEPTION 'O pedido precisa ter pelo menos um produto.';
    END IF;
    IF jsonb_array_length(p_order->'items') > 50 THEN
      RAISE EXCEPTION 'O pedido excede o limite de 50 linhas de produtos.';
    END IF;

    UPDATE public_order_products AS product
    SET stock_quantity = product.stock_quantity + old_items.quantity,
        updated_at = now()
    FROM (
      SELECT product_id, SUM(quantity)::integer AS quantity
      FROM public_order_items WHERE order_id = p_order_id GROUP BY product_id
    ) AS old_items
    WHERE product.id = old_items.product_id AND product.stock_quantity IS NOT NULL;

    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_order->'items') AS requested("productId" text, quantity integer, "unitPriceCents" bigint)
      LEFT JOIN public_order_products product ON product.id = requested."productId"
      WHERE product.id IS NULL OR requested.quantity IS NULL OR requested.quantity < 1
        OR requested.quantity > 99 OR requested."unitPriceCents" < 0
    ) THEN
      RAISE EXCEPTION 'Confira os produtos, preços e quantidades informados.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM (
        SELECT "productId", SUM(quantity)::integer AS quantity
        FROM jsonb_to_recordset(p_order->'items') AS requested("productId" text, quantity integer, "unitPriceCents" bigint)
        GROUP BY "productId"
      ) requested
      JOIN public_order_products product ON product.id = requested."productId"
      WHERE product.stock_quantity IS NOT NULL AND product.stock_quantity < requested.quantity
    ) THEN
      RAISE EXCEPTION 'Estoque insuficiente para um ou mais produtos.';
    END IF;

    UPDATE public_order_products AS product
    SET stock_quantity = product.stock_quantity - requested.quantity,
        available = CASE WHEN product.stock_quantity - requested.quantity = 0 THEN false ELSE product.available END,
        updated_at = now()
    FROM (
      SELECT "productId", SUM(quantity)::integer AS quantity
      FROM jsonb_to_recordset(p_order->'items') AS requested("productId" text, quantity integer, "unitPriceCents" bigint)
      GROUP BY "productId"
    ) AS requested
    WHERE product.id = requested."productId" AND product.stock_quantity IS NOT NULL;

    DELETE FROM public_order_items WHERE order_id = p_order_id;
    INSERT INTO public_order_items(order_id,product_id,product_name,quantity,unit_price_cents,unit_cost_cents)
    SELECT p_order_id, product.id, product.name, requested.quantity,
      COALESCE(requested."unitPriceCents",product.unit_price_cents),
      COALESCE(product.cost_price_cents,0)
    FROM (
      SELECT "productId", SUM(quantity)::integer AS quantity, MAX("unitPriceCents") AS "unitPriceCents"
      FROM jsonb_to_recordset(p_order->'items') AS requested("productId" text, quantity integer, "unitPriceCents" bigint)
      GROUP BY "productId"
    ) AS requested
    JOIN public_order_products product ON product.id = requested."productId";

    SELECT COALESCE(SUM(quantity * unit_price_cents),0)
    INTO v_subtotal FROM public_order_items WHERE order_id = p_order_id;
  ELSE
    SELECT COALESCE(SUM(quantity * unit_price_cents),0)
    INTO v_subtotal FROM public_order_items WHERE order_id = p_order_id;
  END IF;

  IF p_order ? 'deliveryFeeCents' THEN
    v_delivery_fee := (p_order->>'deliveryFeeCents')::bigint;
    IF v_delivery_fee < 0 THEN RAISE EXCEPTION 'O frete não pode ser negativo.'; END IF;
  ELSIF COALESCE(p_order->>'fulfillmentType',v_order.fulfillment_type) = 'pickup' THEN
    v_delivery_fee := 0;
  ELSE
    v_delivery_fee := v_order.delivery_fee_cents;
  END IF;

  UPDATE public_orders SET
    customer_name = CASE WHEN p_order ? 'customerName' THEN btrim(p_order->>'customerName') ELSE customer_name END,
    phone = CASE WHEN p_order ? 'phone' THEN NULLIF(btrim(p_order->>'phone'),'') ELSE phone END,
    address = CASE WHEN p_order ? 'address' THEN NULLIF(btrim(p_order->>'address'),'') ELSE address END,
    neighborhood = CASE WHEN p_order ? 'neighborhood' THEN NULLIF(btrim(p_order->>'neighborhood'),'') ELSE neighborhood END,
    fulfillment_type = CASE WHEN p_order ? 'fulfillmentType' THEN p_order->>'fulfillmentType' ELSE fulfillment_type END,
    payment_method = CASE WHEN p_order ? 'paymentMethod' THEN p_order->>'paymentMethod' ELSE payment_method END,
    notes = CASE WHEN p_order ? 'notes' THEN NULLIF(btrim(p_order->>'notes'),'') ELSE notes END,
    courier = CASE WHEN p_order ? 'courier' THEN left(btrim(COALESCE(p_order->>'courier','')),120) ELSE courier END,
    status = v_status,
    delivery_confirmed_at = CASE WHEN v_status = 'completed' THEN COALESCE(delivery_confirmed_at,now()) WHEN p_order ? 'status' THEN NULL ELSE delivery_confirmed_at END,
    subtotal_cents = v_subtotal,
    delivery_fee_cents = v_delivery_fee,
    total_cents = v_subtotal + v_delivery_fee
  WHERE id = p_order_id;

  RETURN (
    SELECT to_jsonb(o) || jsonb_build_object(
      'public_order_items',
      COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.product_name) FROM public_order_items i WHERE i.order_id = o.id),'[]'::jsonb)
    )
    FROM public_orders o WHERE o.id = p_order_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_public_order(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_public_order(uuid,jsonb) TO service_role;
