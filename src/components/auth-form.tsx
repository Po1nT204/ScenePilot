"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signIn, signUp } from "@/app/auth-actions";
import { initialAuthState } from "@/lib/auth-state";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const registering = mode === "register";
  const [state, action, pending] = useActionState(registering ? signUp : signIn, initialAuthState);

  return (
    <form action={action} className="auth-form">
      <fieldset disabled={pending}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" maxLength={254} required />
        <label htmlFor="password">Пароль</label>
        <input id="password" name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} minLength={8} maxLength={128} aria-describedby="password-hint" required />
        <p id="password-hint" className="field-hint">От 8 до 128 символов.</p>
        {registering && (
          <>
            <label htmlFor="confirmPassword">Повторите пароль</label>
            <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
          </>
        )}
        <button className="button" type="submit">{pending ? "Подождите…" : registering ? "Создать аккаунт" : "Войти"}</button>
      </fieldset>
      <p className={state.success ? "form-message success" : "form-message"} role="status" aria-live="polite">{state.message}</p>
      <p className="auth-switch">{registering ? "Уже есть аккаунт?" : "Нет аккаунта?"} <Link href={registering ? "/login" : "/register"}>{registering ? "Войти" : "Зарегистрироваться"}</Link></p>
    </form>
  );
}
