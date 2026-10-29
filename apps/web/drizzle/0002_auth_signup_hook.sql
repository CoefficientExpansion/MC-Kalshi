-- Custom migration (hand-written): sign-in domain restriction at the auth layer.
-- See docs/specs/m2b-auth.md and CLAUDE.md hard constraint 2.
--
-- Supabase "Before User Created" auth hook, Postgres-function variant. Supabase Auth calls it with
-- {"metadata": {...}, "user": {"email": ..., ...}} before it inserts an auth.users row. Returning
-- {} lets the sign-up proceed; returning {"error": {"http_code": ..., "message": ...}} blocks it
-- and the message reaches the client. The owner switches it on in the dashboard (Authentication >
-- Hooks > Before User Created > Postgres function > public.hook_before_user_created).
--
-- The allowed domains are literals here because a Postgres hook cannot read the app's
-- ALLOWED_EMAIL_DOMAINS. Changing them means a new migration that replaces this function, and an
-- update to apps/web/src/server/auth-email.ts (src/db/auth-hook.test.ts checks both agree).
-- The rule mirrors isAllowedEmail(): printable ASCII only (so unicode lookalikes and the Kelvin
-- sign cannot fold into an allowed address), one @, a plain local part, exact domain match.
CREATE OR REPLACE FUNCTION public.hook_before_user_created(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  raw text;
  addr text;
BEGIN
  raw := btrim(coalesce(event -> 'user' ->> 'email', ''));
  -- ASCII is checked before lower(), which would fold the Kelvin sign (U+212A) into a plain k.
  addr := CASE WHEN octet_length(raw) = char_length(raw) THEN lower(raw) ELSE '' END;

  IF addr <> ''
     AND char_length(addr) <= 254
     AND char_length(split_part(addr, '@', 1)) <= 64
     AND addr ~ '^[a-z0-9_+''-]+(\.[a-z0-9_+''-]+)*@(maryvillecollege\.edu|my\.maryvillecollege\.edu)$'
  THEN
    RETURN '{}'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Sign-in is limited to Maryville College email addresses (@maryvillecollege.edu or @my.maryvillecollege.edu).'
    )
  );
END;
$$;--> statement-breakpoint

-- Nobody but Supabase Auth may call it. `public` is every role; on Supabase, `anon` and
-- `authenticated` also hold default execute grants on new public functions, so they are revoked
-- by name. The roles below exist on Supabase but not on PGlite, hence the guards.
REVOKE ALL ON FUNCTION public.hook_before_user_created(jsonb) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.hook_before_user_created(jsonb) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.hook_before_user_created(jsonb) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
    GRANT EXECUTE ON FUNCTION public.hook_before_user_created(jsonb) TO supabase_auth_admin;
  END IF;
END
$$;
