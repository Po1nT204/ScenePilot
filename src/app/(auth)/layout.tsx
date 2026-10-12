import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <Link className="brand" href="/">ScenePilot</Link>
      <div className="auth-card">{children}</div>
      <p className="auth-footer">От идеи к сценам. В своём темпе.</p>
    </main>
  );
}
