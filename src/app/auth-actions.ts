"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AuthState } from "@/lib/auth-state";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

function readCredentials(formData: FormData) {
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");
  if (typeof emailValue !== "string" || typeof passwordValue !== "string") return null;
  const email = emailValue.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (passwordValue.length < 8 || passwordValue.length > 128) return null;
  return { email, password: passwordValue };
}

function authErrorMessage(code?: string) {
  if (code === "email_not_confirmed") return "Подтвердите email, затем повторите вход.";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit") {
    return "Слишком много попыток. Подождите несколько минут и попробуйте снова.";
  }
  if (code === "weak_password") return "Выберите более надёжный пароль длиной от 8 символов.";
  return "Не удалось выполнить запрос. Проверьте email и пароль или попробуйте позже.";
}

export async function signIn(_previous: AuthState, formData: FormData): Promise<AuthState> {
  if (!getSupabaseConfig()) return { message: "Сначала настройте подключение Supabase по README." };
  const credentials = readCredentials(formData);
  if (!credentials) return { message: "Введите корректный email и пароль от 8 до 128 символов." };

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword(credentials);
    if (error) return { message: authErrorMessage(error.code) };
  } catch {
    return { message: "Сервис входа недоступен. Проверьте подключение и повторите попытку." };
  }
  revalidatePath("/", "layout");
  redirect("/projects");
}

export async function signUp(_previous: AuthState, formData: FormData): Promise<AuthState> {
  if (!getSupabaseConfig()) return { message: "Сначала настройте подключение Supabase по README." };
  const credentials = readCredentials(formData);
  if (!credentials) return { message: "Введите корректный email и пароль от 8 до 128 символов." };
  if (credentials.password !== formData.get("confirmPassword")) {
    return { message: "Пароли не совпадают." };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp(credentials);
    if (error) return { message: authErrorMessage(error.code) };
    if (!data.session) {
      return { success: true, message: "Если регистрация доступна для этого адреса, подтвердите email по письму, затем войдите. Если аккаунт уже есть, используйте вход." };
    }
  } catch {
    return { message: "Сервис регистрации недоступен. Попробуйте позже." };
  }
  revalidatePath("/", "layout");
  redirect("/projects");
}

export async function signOut(): Promise<AuthState> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) return { message: "Не удалось выйти. Повторите попытку." };
  } catch {
    return { message: "Не удалось связаться с сервисом. Повторите выход позже." };
  }
  revalidatePath("/", "layout");
  redirect("/login");
}
