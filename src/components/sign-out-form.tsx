"use client";

import { useActionState } from "react";
import { signOut } from "@/app/auth-actions";
import { initialAuthState } from "@/lib/auth-state";

export function SignOutForm() {
  const [state, action, pending] = useActionState(signOut, initialAuthState);
  return (
    <form action={action}>
      <button className="text-button" type="submit" disabled={pending}>{pending ? "Выходим…" : "Выйти"}</button>
      <p className="form-message" role="status">{state.message}</p>
    </form>
  );
}
