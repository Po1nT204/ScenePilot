import Link from "next/link";
export default function ProjectNotFound() {
 return <section className="project-editor"><h1 className="auth-title">Проект не найден</h1><p className="auth-description">Он удалён или недоступен вашему аккаунту.</p><Link className="text-link" href="/projects">Вернуться к своим проектам</Link></section>;
}
