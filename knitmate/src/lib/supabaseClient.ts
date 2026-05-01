import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isValidUrl = (s: string) => { try { return !!new URL(s); } catch { return false; } };

export const supabase = url && key && isValidUrl(url) ? createClient(url, key) : null;
