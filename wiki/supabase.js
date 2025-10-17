// supabase.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://gophqokfkjjdozhhixoo.supabase.co"; // kendi URL'in
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvcGhxb2tma2pqZG96aGhpeG9vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxNTc0NzEsImV4cCI6MjA3NTczMzQ3MX0.LNMbomq4tbcdoBrC1lwDRGT59JfV35QRoKFupRNZQVM"; // kendi anon key'in

// Create a singleton Supabase client and attach to globalThis to avoid
// multiple GoTrueClient instances in the same browser context.
const _global = typeof globalThis !== 'undefined' ? globalThis : window;
if (!_global.__supabase_client) {
	_global.__supabase_client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export const supabase = _global.__supabase_client;
