-- Requires Firebase Third-Party Auth configured in Supabase before client rollout.
-- The trusted project setting is empty by default: access fails closed until set.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS private.app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
REVOKE ALL ON private.app_settings FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_trusted_firebase_jwt()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.app_settings s
    WHERE s.key = 'firebase_project_id' AND length(s.value) > 0
      AND auth.jwt()->>'iss' = 'https://securetoken.google.com/' || s.value
      AND auth.jwt()->>'aud' = s.value
      AND length(coalesce(auth.jwt()->>'sub', '')) > 0
  );
$$;
REVOKE ALL ON FUNCTION public.is_trusted_firebase_jwt() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_trusted_firebase_jwt() TO authenticated;

DO $$
DECLARE t TEXT; p RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','user_goals','workout_sessions','habit_streaks',
    'user_memories','scheduled_events','nudge_actions','user_onboarding_state','workout_progress','user_messages','google_integrations']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t
    LOOP EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t); END LOOP;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    IF t = 'google_integrations' THEN
      -- OAuth refresh tokens are accessed exclusively by authenticated backend code.
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
      EXECUTE format('CREATE POLICY trusted_project ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.is_trusted_firebase_jwt())) WITH CHECK ((SELECT public.is_trusted_firebase_jwt()))', t);
      IF t = 'users' THEN
        EXECUTE 'CREATE POLICY own_profile ON public.users FOR ALL TO authenticated USING (firebase_uid = (SELECT auth.jwt()->>''sub'')) WITH CHECK (firebase_uid = (SELECT auth.jwt()->>''sub''))';
      ELSE
        EXECUTE format('CREATE POLICY own_records ON public.%I FOR ALL TO authenticated USING (user_id IN (SELECT id FROM public.users WHERE firebase_uid = (SELECT auth.jwt()->>''sub''))) WITH CHECK (user_id IN (SELECT id FROM public.users WHERE firebase_uid = (SELECT auth.jwt()->>''sub'')))', t);
      END IF;
    END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO authenticated;
