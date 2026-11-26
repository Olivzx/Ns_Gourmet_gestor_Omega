CREATE OR REPLACE FUNCTION public.admin_update_public_order(p_order_id uuid, p_order jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_order public_orders%ROWTYPE; v_item jsonb; v_product public_order_products%ROWTYPE;
  v_product_id text; v_quantity integer; v_subtotal bigint; v_delivery_fee bigint;
  v_status text; v_old_product_id text; v_old_qty integer; v_old_items jsonb;
  v_unit_price bigint; v_unit_cost bigint;
BEGIN
  IF p_order IS NULL OR jsonb_typeof(p_order) <> 'object' THEN RAISE EXCEPTION 'Dados do pedido inválidos.'; END IF;
  SELECT * INTO v_order FROM public_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;

  IF p_order ? 'status' THEN
    v_status := CASE p_order->>'status'
      WHEN 'novo' THEN 'received' WHEN 'preparando' THEN 'preparing' WHEN 'pronto' THEN 'ready'
      WHEN 'saiu_entrega' THEN 'out_for_delivery' WHEN 'entregue' THEN 'completed' WHEN 'cancelado' THEN 'cancelled'
      WHEN 'received' THEN 'received' WHEN 'preparing' THEN 'preparing' WHEN 'ready' THEN 'ready'
      WHEN 'out_for_delivery' THEN 'out_for_delivery' WHEN 'completed' THEN 'completed' WHEN 'cancelled' THEN 'cancelled'
      ELSE NULL END;
    IF v_status IS NULL THEN RAISE EXCEPTION 'Status inválido.'; END IF;
  ELSE v_status := v_order.status; END IF;

  IF p_order ? 'customerName' AND NULLIF(btrim(p_order->>'customerName'),'') IS NULL THEN RAISE EXCEPTION 'O nome do cliente é obrigatório.'; END IF;
  IF p_order ? 'fulfillmentType' AND p_order->>'fulfillmentType' NOT IN ('delivery','pickup') THEN RAISE EXCEPTION 'Modalidade de recebimento inválida.'; END IF;
  IF p_order ? 'paymentMethod' AND p_order->>'paymentMethod' NOT IN ('pix','cash','debit','credit') THEN RAISE EXCEPTION 'Forma de pagamento inválida.'; END IF;

  IF p_order ? 'items' THEN
    IF jsonb_typeof(p_order->'items') <> 'array' OR jsonb_array_length(p_order->'items') = 0 THEN RAISE EXCEPTION 'O pedido precisa ter pelo menos um produto.'; END IF;
    IF jsonb_array_length(p_order->'items') > 50 THEN RAISE EXCEPTION 'O pedido excede o limite de 50 linhas de produtos.'; END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',product_id,'unitPriceCents',unit_price_cents,'unitCostCents',unit_cost_cents)), '[]'::jsonb)
    INTO v_old_items FROM public_order_items WHERE order_id = p_order_id;

    FOR v_old_product_id, v_old_qty IN
      SELECT product_id, SUM(quantity)::integer FROM public_order_items WHERE order_id = p_order_id GROUP BY product_id
    LOOP
      UPDATE public_order_products SET stock_quantity = stock_quantity + v_old_qty, updated_at = now()
      WHERE id = v_old_product_id AND stock_quantity IS NOT NULL;
    END LOOP;
    DELETE FROM public_order_items WHERE order_id = p_order_id;
    v_subtotal := 0;

    FOR v_item IN
      SELECT jsonb_build_object('productId', i.value->>'productId', 'quantity', SUM((i.value->>'quantity')::integer))
      FROM jsonb_array_elements(p_order->'items') AS i(value) GROUP BY i.value->>'productId'
    LOOP
      v_product_id := NULLIF(btrim(v_item->>'productId'),'');
      BEGIN v_quantity := (v_item->>'quantity')::integer;
      EXCEPTION WHEN others THEN RAISE EXCEPTION 'Quantidade de produto inválida.'; END;
      IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity < 1 OR v_quantity > 99 THEN RAISE EXCEPTION 'Produto ou quantidade inválida.'; END IF;
      SELECT * INTO v_product FROM public_order_products WHERE id = v_product_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Um dos produtos não foi encontrado no catálogo.'; END IF;
      IF v_product.stock_quantity IS NOT NULL AND v_product.stock_quantity < v_quantity THEN
        RAISE EXCEPTION 'Estoque insuficiente para %: disponível % unidade(s).', v_product.name, v_product.stock_quantity;
      END IF;
      IF v_product.stock_quantity IS NOT NULL THEN
        UPDATE public_order_products SET stock_quantity = stock_quantity - v_quantity,
          available = CASE WHEN stock_quantity - v_quantity = 0 THEN false ELSE available END, updated_at = now()
        WHERE id = v_product_id;
      END IF;
      SELECT (old_line->>'unitPriceCents')::bigint, (old_line->>'unitCostCents')::bigint
      INTO v_unit_price, v_unit_cost
      FROM jsonb_array_elements(v_old_items) old_line
      WHERE old_line->>'productId' = v_product_id LIMIT 1;
      IF NOT FOUND THEN
        v_unit_price := v_product.unit_price_cents;
        v_unit_cost := COALESCE(v_product.cost_price_cents,0);
      END IF;
      INSERT INTO public_order_items(order_id,product_id,product_name,quantity,unit_price_cents,unit_cost_cents)
      VALUES(p_order_id,v_product.id,v_product.name,v_quantity,v_unit_price,v_unit_cost);
      v_subtotal := v_subtotal + v_unit_price * v_quantity;
    END LOOP;
  ELSE
    SELECT COALESCE(SUM(quantity * unit_price_cents),0) INTO v_subtotal FROM public_order_items WHERE order_id = p_order_id;
  END IF;

  IF p_order ? 'deliveryFeeCents' THEN
    BEGIN v_delivery_fee := (p_order->>'deliveryFeeCents')::bigint;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'Valor de entrega inválido.'; END;
    IF v_delivery_fee < 0 THEN RAISE EXCEPTION 'O frete não pode ser negativo.'; END;
  ELSIF COALESCE(p_order->>'fulfillmentType',v_order.fulfillment_type) = 'pickup' THEN v_delivery_fee := 0;
  ELSE v_delivery_fee := v_order.delivery_fee_cents; END IF;

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
    subtotal_cents = v_subtotal, delivery_fee_cents = v_delivery_fee, total_cents = v_subtotal + v_delivery_fee
  WHERE id = p_order_id;

  SELECT to_jsonb(o) || jsonb_build_object('public_order_items',
    COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.product_name) FROM public_order_items i WHERE i.order_id = o.id),'[]'::jsonb))
  INTO v_item FROM public_orders o WHERE o.id = p_order_id;
  RETURN v_item;
END; $$;
REVOKE ALL ON FUNCTION public.admin_update_public_order(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_public_order(uuid,jsonb) TO service_role;
