import Link from 'next/link';

export function Brand() {
  return <Link className="brand" href="/" aria-label="ScenePilot — главная">
    <span className="brand-mark" aria-hidden="true">S<span>▸</span></span>
    ScenePilot
  </Link>;
}
