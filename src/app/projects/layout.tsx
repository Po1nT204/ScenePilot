import Link from "next/link";
import { SignOutForm } from "@/components/sign-out-form";
export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
 return <><header className="header container"><Link href="/" className="brand">ScenePilot</Link><nav aria-label="Навигация проектов"><Link href="/projects">Мои проекты</Link></nav><SignOutForm /></header><main className="container projects-page">{children}</main></>;
}
