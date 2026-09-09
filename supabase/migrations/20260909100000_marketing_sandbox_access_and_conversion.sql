DO $$
BEGIN
  IF to_regclass('public.sandbox_access') IS NOT NULL THEN
    RAISE EXCEPTION 'BATCH_1A_OBJECT_EXISTS: public.sandbox_access';
  END IF;

  IF to_regclass('public.sandbox_reactivation_requests') IS NOT NULL THEN
    RAISE EXCEPTION 'BATCH_1A_OBJECT_EXISTS: public.sandbox_reactivation_requests';
  END IF;

  IF to_regclass('public.sandbox_tester_conversion_events') IS NOT NULL THEN
    RAISE EXCEPTION 'BATCH_1A_OBJECT_EXISTS: public.sandbox_tester_conversion_events';
  END IF;
END $$;

CREATE TABLE public.sandbox_access (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'ACTIVE',
  changed_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at timestamp with time zone NOT NULL DEFAULT now(),
  reason text NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sandbox_access_state_check CHECK (state IN ('ACTIVE', 'LOCKED', 'REVOKED'))
);

CREATE INDEX sandbox_access_state_changed_at_idx
  ON public.sandbox_access (state, changed_at);

ALTER TABLE public.sandbox_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Member can read own sandbox access"
ON public.sandbox_access
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.sandbox_access FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.sandbox_access TO authenticated;

CREATE TABLE public.sandbox_reactivation_requests (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'PENDING',
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  reviewed_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamp with time zone NULL,
  rejection_reason text NULL,
  CONSTRAINT sandbox_reactivation_requests_state_check
    CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT sandbox_reactivation_requests_review_check
    CHECK (
      (state = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL)
      OR (state IN ('APPROVED', 'REJECTED', 'CANCELLED') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    ),
  CONSTRAINT sandbox_reactivation_requests_rejection_check
    CHECK (state <> 'REJECTED' OR NULLIF(btrim(rejection_reason), '') IS NOT NULL)
);

CREATE UNIQUE INDEX sandbox_reactivation_requests_one_pending_idx
  ON public.sandbox_reactivation_requests (user_id)
  WHERE state = 'PENDING';

CREATE INDEX sandbox_reactivation_requests_state_requested_at_idx
  ON public.sandbox_reactivation_requests (state, requested_at);

ALTER TABLE public.sandbox_reactivation_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Member can read own sandbox reactivation requests"
ON public.sandbox_reactivation_requests
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.sandbox_reactivation_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.sandbox_reactivation_requests TO authenticated;

CREATE TABLE public.sandbox_tester_conversion_events (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  source text NOT NULL,
  actor_type text NOT NULL,
  actor_user_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  resulting_state text NOT NULL DEFAULT 'MEMBER_LIVE_LOCKED',
  CONSTRAINT sandbox_tester_conversion_events_source_check CHECK (source = 'marketing_sandbox'),
  CONSTRAINT sandbox_tester_conversion_events_actor_type_check CHECK (actor_type IN ('self_service', 'management')),
  CONSTRAINT sandbox_tester_conversion_events_actor_check CHECK (
    (actor_type = 'self_service' AND (actor_user_id IS NULL OR actor_user_id = user_id))
    OR (actor_type = 'management' AND actor_user_id IS NOT NULL)
  ),
  CONSTRAINT sandbox_tester_conversion_events_resulting_state_check CHECK (resulting_state = 'MEMBER_LIVE_LOCKED'),
  CONSTRAINT sandbox_tester_conversion_events_user_unique UNIQUE (user_id)
);

ALTER TABLE public.sandbox_tester_conversion_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.sandbox_tester_conversion_events FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'update_updated_at_column'
      AND pg_function_is_visible(oid)
  ) THEN
    CREATE TRIGGER update_sandbox_access_updated_at
    BEFORE UPDATE ON public.sandbox_access
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.convert_tester_to_member(
  p_user_id uuid,
  p_actor_type text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target public.profiles%ROWTYPE;
  v_actor public.profiles%ROWTYPE;
  v_access public.sandbox_access%ROWTYPE;
  v_existing_event_id uuid;
  v_event_id uuid;
  v_role text;
  v_access_exists boolean;
BEGIN
  IF p_user_id IS NULL OR p_actor_type IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'CONVERSION_INPUT_INVALID';
  END IF;

  IF p_actor_type NOT IN ('self_service', 'management') THEN
    RAISE EXCEPTION 'CONVERSION_ACTOR_TYPE_INVALID';
  END IF;

  SELECT *
  INTO v_target
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONVERSION_TARGET_NOT_FOUND';
  END IF;

  v_role := lower(trim(coalesce(v_target.role, '')));
  IF v_role IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'MANAGEMENT_PERSONA_NOT_ELIGIBLE';
  END IF;

  SELECT *
  INTO v_actor
  FROM public.profiles
  WHERE id = p_actor_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONVERSION_ACTOR_NOT_FOUND';
  END IF;

  IF p_actor_type = 'self_service' THEN
    IF p_actor_user_id <> p_user_id THEN
      RAISE EXCEPTION 'SELF_SERVICE_ACTOR_MISMATCH';
    END IF;
  ELSIF lower(trim(coalesce(v_actor.role, ''))) NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'MANAGEMENT_ACTOR_REQUIRED';
  END IF;

  SELECT id
  INTO v_existing_event_id
  FROM public.sandbox_tester_conversion_events
  WHERE user_id = p_user_id
  LIMIT 1
  FOR UPDATE;

  IF v_existing_event_id IS NOT NULL THEN
    SELECT state
    INTO v_access.state
    FROM public.sandbox_access
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
      'success', true,
      'already_converted', true,
      'conversion_event_id', v_existing_event_id,
      'access_state', coalesce(v_access.state, 'LOCKED')
    );
  END IF;

  IF v_target.is_tester IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TESTER_NOT_ELIGIBLE';
  END IF;

  SELECT *
  INTO v_access
  FROM public.sandbox_access
  WHERE user_id = p_user_id
  FOR UPDATE;
  v_access_exists := FOUND;

  IF v_access_exists THEN
    UPDATE public.sandbox_access
    SET state = 'LOCKED',
        changed_by = p_actor_user_id,
        changed_at = now(),
        reason = 'Tester converted to Member',
        updated_at = now()
    WHERE user_id = p_user_id;
  ELSE
    INSERT INTO public.sandbox_access (user_id, state, changed_by, changed_at, reason)
    VALUES (p_user_id, 'LOCKED', p_actor_user_id, now(), 'Tester converted to Member');
  END IF;

  UPDATE public.sandbox_reactivation_requests
  SET state = 'CANCELLED',
      reviewed_by = p_actor_user_id,
      reviewed_at = now()
  WHERE user_id = p_user_id
    AND state = 'PENDING';

  UPDATE public.profiles
  SET is_tester = false
  WHERE id = p_user_id;

  INSERT INTO public.sandbox_tester_conversion_events (
    user_id,
    source,
    actor_type,
    actor_user_id,
    resulting_state
  )
  VALUES (
    p_user_id,
    'marketing_sandbox',
    p_actor_type,
    CASE WHEN p_actor_type = 'self_service' THEN NULL ELSE p_actor_user_id END,
    'MEMBER_LIVE_LOCKED'
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'already_converted', false,
    'conversion_event_id', v_event_id,
    'access_state', 'LOCKED'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_sandbox_reactivation_request(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target public.profiles%ROWTYPE;
  v_access public.sandbox_access%ROWTYPE;
  v_pending_id uuid;
  v_request_id uuid;
  v_role text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'REACTIVATION_USER_REQUIRED';
  END IF;

  SELECT *
  INTO v_target
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REACTIVATION_USER_NOT_FOUND';
  END IF;

  v_role := lower(trim(coalesce(v_target.role, '')));
  IF v_role IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'MANAGEMENT_PERSONA_NOT_ELIGIBLE';
  END IF;

  SELECT *
  INTO v_access
  FROM public.sandbox_access
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_access.state NOT IN ('LOCKED', 'REVOKED') THEN
    RAISE EXCEPTION 'SANDBOX_REACTIVATION_NOT_ALLOWED';
  END IF;

  SELECT id
  INTO v_pending_id
  FROM public.sandbox_reactivation_requests
  WHERE user_id = p_user_id
    AND state = 'PENDING'
  LIMIT 1
  FOR UPDATE;

  IF v_pending_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_pending', true,
      'request_id', v_pending_id,
      'state', 'PENDING'
    );
  END IF;

  INSERT INTO public.sandbox_reactivation_requests (user_id, state)
  VALUES (p_user_id, 'PENDING')
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'already_pending', false,
    'request_id', v_request_id,
    'state', 'PENDING'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_sandbox_reactivation(
  p_request_id uuid,
  p_decision text,
  p_reviewer_id uuid,
  p_rejection_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.sandbox_reactivation_requests%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_reviewer public.profiles%ROWTYPE;
  v_access public.sandbox_access%ROWTYPE;
  v_decision text;
BEGIN
  IF p_request_id IS NULL OR p_reviewer_id IS NULL THEN
    RAISE EXCEPTION 'REACTIVATION_DECISION_INPUT_INVALID';
  END IF;

  v_decision := upper(trim(coalesce(p_decision, '')));
  IF v_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'REACTIVATION_DECISION_INVALID';
  END IF;

  SELECT *
  INTO v_request
  FROM public.sandbox_reactivation_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REACTIVATION_REQUEST_NOT_FOUND';
  END IF;

  SELECT *
  INTO v_target
  FROM public.profiles
  WHERE id = v_request.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REACTIVATION_USER_NOT_FOUND';
  END IF;

  SELECT *
  INTO v_access
  FROM public.sandbox_access
  WHERE user_id = v_request.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SANDBOX_ACCESS_NOT_FOUND';
  END IF;

  SELECT *
  INTO v_request
  FROM public.sandbox_reactivation_requests
  WHERE id = p_request_id
  FOR UPDATE;

  SELECT *
  INTO v_reviewer
  FROM public.profiles
  WHERE id = p_reviewer_id
  FOR UPDATE;

  IF NOT FOUND OR lower(trim(coalesce(v_reviewer.role, ''))) NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'MANAGEMENT_ACTOR_REQUIRED';
  END IF;

  IF lower(trim(coalesce(v_target.role, ''))) IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'MANAGEMENT_PERSONA_NOT_ELIGIBLE';
  END IF;

  IF v_request.state <> 'PENDING' THEN
    IF v_request.state = v_decision THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_decided', true,
        'request_id', v_request.id,
        'state', v_request.state,
        'access_state', v_access.state
      );
    END IF;
    RAISE EXCEPTION 'REACTIVATION_REQUEST_ALREADY_TERMINAL';
  END IF;

  IF v_decision = 'APPROVED' THEN
    UPDATE public.sandbox_reactivation_requests
    SET state = 'APPROVED',
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        rejection_reason = NULL
    WHERE id = p_request_id;

    UPDATE public.sandbox_access
    SET state = 'ACTIVE',
        changed_by = p_reviewer_id,
        changed_at = now(),
        reason = 'Sandbox reactivation approved',
        updated_at = now()
    WHERE user_id = v_request.user_id;
  ELSE
    IF NULLIF(btrim(p_rejection_reason), '') IS NULL THEN
      RAISE EXCEPTION 'REJECTION_REASON_REQUIRED';
    END IF;

    UPDATE public.sandbox_reactivation_requests
    SET state = 'REJECTED',
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        rejection_reason = btrim(p_rejection_reason)
    WHERE id = p_request_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_decided', false,
    'request_id', p_request_id,
    'state', v_decision,
    'access_state', CASE WHEN v_decision = 'APPROVED' THEN 'ACTIVE' ELSE v_access.state END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_sandbox_access(
  p_target_user_id uuid,
  p_state text,
  p_actor_user_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target public.profiles%ROWTYPE;
  v_actor public.profiles%ROWTYPE;
  v_access public.sandbox_access%ROWTYPE;
  v_state text;
  v_existing boolean;
BEGIN
  IF p_target_user_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'SANDBOX_ACCESS_INPUT_INVALID';
  END IF;

  v_state := upper(trim(coalesce(p_state, '')));
  IF v_state NOT IN ('ACTIVE', 'LOCKED', 'REVOKED') THEN
    RAISE EXCEPTION 'SANDBOX_ACCESS_STATE_INVALID';
  END IF;

  SELECT *
  INTO v_target
  FROM public.profiles
  WHERE id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SANDBOX_ACCESS_TARGET_NOT_FOUND';
  END IF;

  IF lower(trim(coalesce(v_target.role, ''))) IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'MANAGEMENT_PERSONA_NOT_ELIGIBLE';
  END IF;

  SELECT *
  INTO v_actor
  FROM public.profiles
  WHERE id = p_actor_user_id
  FOR UPDATE;

  IF NOT FOUND OR lower(trim(coalesce(v_actor.role, ''))) NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'MANAGEMENT_ACTOR_REQUIRED';
  END IF;

  SELECT *
  INTO v_access
  FROM public.sandbox_access
  WHERE user_id = p_target_user_id
  FOR UPDATE;
  v_existing := FOUND;

  IF v_existing AND v_access.state = v_state THEN
    IF v_state IN ('LOCKED', 'REVOKED') THEN
      UPDATE public.sandbox_reactivation_requests
      SET state = 'CANCELLED',
          reviewed_by = p_actor_user_id,
          reviewed_at = now()
      WHERE user_id = p_target_user_id
        AND state = 'PENDING';
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'no_op', true,
      'user_id', p_target_user_id,
      'access_state', v_state
    );
  END IF;

  IF NOT v_existing AND v_state <> 'ACTIVE' THEN
    RAISE EXCEPTION 'SANDBOX_ACCESS_INITIAL_STATE_INVALID';
  END IF;

  IF v_existing THEN
    UPDATE public.sandbox_access
    SET state = v_state,
        changed_by = p_actor_user_id,
        changed_at = now(),
        reason = NULLIF(btrim(p_reason), ''),
        updated_at = now()
    WHERE user_id = p_target_user_id;
  ELSE
    INSERT INTO public.sandbox_access (user_id, state, changed_by, changed_at, reason)
    VALUES (p_target_user_id, v_state, p_actor_user_id, now(), NULLIF(btrim(p_reason), ''));
  END IF;

  IF v_state IN ('LOCKED', 'REVOKED') THEN
    UPDATE public.sandbox_reactivation_requests
    SET state = 'CANCELLED',
        reviewed_by = p_actor_user_id,
        reviewed_at = now()
    WHERE user_id = p_target_user_id
      AND state = 'PENDING';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'no_op', false,
    'user_id', p_target_user_id,
    'access_state', v_state
  );
END;
$$;

INSERT INTO public.sandbox_access (user_id, state, changed_at, reason)
SELECT id, 'ACTIVE', now(), 'Initial tester access backfill'
FROM public.profiles
WHERE is_tester = true
  AND lower(trim(coalesce(role, ''))) NOT IN ('admin', 'manager')
ON CONFLICT (user_id) DO NOTHING;

REVOKE ALL ON FUNCTION public.convert_tester_to_member(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convert_tester_to_member(uuid, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.create_sandbox_reactivation_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_sandbox_reactivation_request(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.decide_sandbox_reactivation(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_sandbox_reactivation(uuid, text, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.set_sandbox_access(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_sandbox_access(uuid, text, uuid, text) TO service_role;
