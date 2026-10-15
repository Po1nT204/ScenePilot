import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
export const projectColumns = "id,title,topic,genre,language,style,target_duration_seconds,created_at,updated_at,channel_snapshot,brief_source";
export async function requireProjectUser() {
 const supabase = await createClient();
 const { data, error } = await supabase.auth.getUser();
 if (error && (error.name === "AuthRetryableFetchError" || (error.status && error.status >= 500))) throw new Error("Auth service unavailable");
 if (!data.user) redirect("/login");
 return { supabase, user: data.user };
}
export function projectError(code?: string) {
 if (code === "PGRST205" || code === "42P01") return "Таблица проектов ещё не настроена. Выполните миграцию из README в Supabase SQL Editor.";
 return "Не удалось выполнить операцию. Проверьте соединение и повторите попытку.";
}
