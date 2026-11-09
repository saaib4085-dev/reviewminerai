/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
  readonly VITE_OPERATOR_NAME?: string;
  readonly VITE_CONTACT_EMAIL?: string;
  readonly VITE_PRIVACY_HREF?: string;
  readonly VITE_TERMS_HREF?: string;
  readonly VITE_ADMIN_HREF?: string;
  readonly VITE_HOME_HREF?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
