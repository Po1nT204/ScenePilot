import { Brand } from "@/components/brand";
import { AppNavigation } from "@/components/app-navigation";
import { SignOutForm } from "@/components/sign-out-form";
export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
 return <div className="app-shell"><a className="skip-link" href="#workspace-main">Перейти к содержимому</a>
  <header className="app-header"><div className="container app-header-inner"><Brand /><AppNavigation /><SignOutForm /></div></header>
  <main id="workspace-main" tabIndex={-1} className="container projects-page">{children}</main>
  <footer className="app-footer container"><span>ScenePilot</span><span>Ваша история задаёт направление.</span></footer>
 </div>;
}
