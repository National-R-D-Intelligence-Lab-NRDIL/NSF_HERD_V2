import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// null when env vars aren't set — auth is skipped entirely in that case.
export const supabase = url && key ? createClient(url, key) : null;

export const isAuthConfigured = () => Boolean(url && key);
