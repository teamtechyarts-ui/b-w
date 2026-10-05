-- Admin-created operational identities start inactive until backend provisioning
-- has completed. Normal customer signup retains its existing active default.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
    COALESCE(NEW.phone, NEW.raw_user_meta_data ->> 'phone'),
    CASE WHEN NEW.raw_user_meta_data ->> 'bw_staff_provisioning' = 'true'
      THEN false ELSE true END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- A direct authenticated Supabase request may edit a display name or avatar,
-- but may never reactivate a deactivated staff profile.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, avatar_path) ON public.profiles TO authenticated;
