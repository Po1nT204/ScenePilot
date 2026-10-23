import { Brand } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <Brand />
      <div className="auth-card">{children}</div>
      <p className="auth-footer">Ваша история. Теперь в видео.</p>
    </main>
  );
}
