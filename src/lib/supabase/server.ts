import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./config";
import { supabaseTransport } from './network';

export async function createClient() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase is not configured");
  const cookieStore = await cookies();

  return createServerClient(config.url, config.key, {
    global: { fetch: supabaseTransport() },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies; proxy refreshes them instead.
        }
      },
    },
  });
}
