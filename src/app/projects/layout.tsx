import Link from "next/link";
import { SignOutForm } from "@/components/sign-out-form";
export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
 return <><a className="skip-link" href="#workspace-main">Перейти к содержимому</a><header className="header container"><Link href="/projects" className="brand" aria-label="ScenePilot — библиотека роликов">ScenePilot</Link><nav aria-label="Навигация проектов"><Link href="/projects">Мои ролики</Link></nav><SignOutForm /></header><main id="workspace-main" className="container projects-page">{children}</main></>;
}
