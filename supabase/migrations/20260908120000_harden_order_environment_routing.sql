-- Migration: 20260908120000_harden_order_environment_routing.sql
-- Purpose: Make order-table routing server-derived and service-role-only.
-- Caller inventory before migration:
--   app/api/orders/create/route.ts is the only active application caller.
-- The legacy four-argument function remains present for dependency safety but
-- loses all grants and must not be used by application code.

CREATE OR REPLACE FUNCTION public.create_pending_order_from_reservation(
  p_reservation_id uuid,
  p_external_base_amount numeric,
  p_authenticated_user_id uuid,
  p_environment text,
  p_order_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_reservation public.code_reservations;
  v_profile_email text;
  v_unique_numeric numeric;
  v_unique_code integer;
  v_created public.orders;
  v_created_sandbox public.sandbox_orders;
  v_environment text;
BEGIN
  v_environment := upper(btrim(coalesce(p_environment, '')));

  IF v_environment NOT IN ('LIVE', 'SANDBOX') THEN
    RAISE EXCEPTION 'ORDER_ENVIRONMENT_INVALID';
  END IF;

  IF p_order_data IS NULL OR jsonb_typeof(p_order_data) <> 'object' THEN
    RAISE EXCEPTION 'ORDER_INVALID_PAYLOAD';
  END IF;

  IF p_order_data ? 'is_sandbox' THEN
    RAISE EXCEPTION 'ORDER_CLIENT_ENVIRONMENT_SELECTOR_FORBIDDEN';
  END IF;

  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_RESERVATION_REQUIRED';
  END IF;

  IF p_external_base_amount IS NULL
     OR p_external_base_amount <= 0
     OR p_external_base_amount <> trunc(p_external_base_amount) THEN
    RAISE EXCEPTION 'ORDER_EXTERNAL_AMOUNT_INVALID';
  END IF;

  SELECT * INTO v_reservation
  FROM public.code_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_RESERVATION_NOT_FOUND';
  END IF;

  IF v_reservation.expired_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'ORDER_RESERVATION_EXPIRED';
  END IF;

  IF v_reservation.total_amount <= 0
     OR v_reservation.total_amount <> trunc(v_reservation.total_amount) THEN
    RAISE EXCEPTION 'ORDER_RESERVATION_TOTAL_INVALID';
  END IF;

  v_unique_numeric := v_reservation.total_amount - p_external_base_amount;

  IF v_unique_numeric <> trunc(v_unique_numeric)
     OR v_unique_numeric < 1
     OR v_unique_numeric > 2000 THEN
    RAISE EXCEPTION 'ORDER_RESERVATION_TOTAL_MISMATCH';
  END IF;

  v_unique_code := v_unique_numeric::integer;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE status = 'Pending'
      AND total_amount = v_reservation.total_amount
  ) OR EXISTS (
    SELECT 1 FROM public.sandbox_orders
    WHERE status = 'Pending'
      AND total_amount = v_reservation.total_amount
  ) OR EXISTS (
    SELECT 1 FROM public.deposits
    WHERE status = 'Pending'
      AND total_amount::numeric = v_reservation.total_amount
  ) THEN
    RAISE EXCEPTION 'ORDER_PENDING_TOTAL_EXISTS';
  END IF;

  IF p_authenticated_user_id IS NOT NULL THEN
    SELECT email INTO v_profile_email
    FROM public.profiles
    WHERE id = p_authenticated_user_id;

    IF NOT FOUND OR nullif(btrim(v_profile_email), '') IS NULL THEN
      RAISE EXCEPTION 'ORDER_PROFILE_INVALID';
    END IF;
  END IF;

  IF v_environment = 'SANDBOX' THEN
    INSERT INTO public.sandbox_orders (
      order_id, api_ref_id, sku, product_name, item_label, customer_no,
      buy_price, price, discount, voucher_code, voucher_amount, cashback,
      payment_method, product_type, manual_product_id, sn, user_contact,
      referred_by, category, ip_address, device_id, raw_tagihan, customer_name,
      segment_power, stand_meter, "desc", status, user_id, email, used_balance,
      unique_code, total_amount, idempotency_key, created_at, updated_at
    )
    VALUES (
      p_order_data->>'order_id',
      coalesce(p_order_data->>'api_ref_id', p_order_data->>'order_id'),
      p_order_data->>'sku',
      coalesce(p_order_data->>'product_name', 'Produk Digital'),
      p_order_data->>'item_label',
      p_order_data->>'customer_no',
      coalesce((p_order_data->>'buy_price')::numeric, 0),
      (p_order_data->>'price')::numeric,
      coalesce((p_order_data->>'discount')::numeric, 0),
      p_order_data->>'voucher_code',
      coalesce((p_order_data->>'voucher_amount')::numeric, 0),
      coalesce((p_order_data->>'cashback')::numeric, 0),
      p_order_data->>'payment_method',
      coalesce(p_order_data->>'product_type', 'provider'),
      (p_order_data->>'manual_product_id')::uuid,
      p_order_data->>'sn',
      p_order_data->>'user_contact',
      p_order_data->>'referred_by',
      coalesce(p_order_data->>'category', 'umum'),
      p_order_data->>'ip_address',
      p_order_data->>'device_id',
      coalesce((p_order_data->>'raw_tagihan')::numeric, 0),
      p_order_data->>'customer_name',
      p_order_data->>'segment_power',
      p_order_data->>'stand_meter',
      p_order_data->'desc',
      'Pending',
      p_authenticated_user_id,
      v_profile_email,
      0,
      v_unique_code,
      v_reservation.total_amount,
      null,
      clock_timestamp(),
      clock_timestamp()
    )
    RETURNING * INTO v_created_sandbox;

    DELETE FROM public.code_reservations
    WHERE id = v_reservation.id;

    RETURN to_jsonb(v_created_sandbox);
  END IF;

  v_created := public._insert_order_from_trusted_payload(
    p_order_data,
    'Pending',
    p_authenticated_user_id,
    v_profile_email,
    0::bigint,
    v_unique_code,
    v_reservation.total_amount,
    null::uuid
  );

  DELETE FROM public.code_reservations
  WHERE id = v_reservation.id;

  RETURN to_jsonb(v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.create_pending_order_from_reservation(uuid, numeric, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_pending_order_from_reservation(uuid, numeric, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_pending_order_from_reservation(uuid, numeric, uuid, text, jsonb)
  TO service_role;
