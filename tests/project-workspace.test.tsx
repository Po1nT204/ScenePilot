import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectWorkspace } from "../src/components/project-workspace";

const projectId = "11111111-1111-4111-8111-111111111111";
const version = { id: "22222222-2222-4222-8222-222222222222", version_number: 2 };

test("all workspace destinations keep the selected historical version", () => {
  for (const current of ["settings", "scripts", "scenes", "publication", "export"] as const) {
    const html = renderToStaticMarkup(<ProjectWorkspace projectId={projectId} title="Ролик" current={current} version={version} />);
    const links = [...html.matchAll(/<a\b[^>]*>/g)].map(match => match[0]);
    const destinations = ["", "/scripts", "/scenes", "/publication", "/export"].map(path => `/projects/${projectId}${path}?version=${version.id}`);
    for (const href of destinations) assert.ok(links.some(link => link.includes(`href="${href}"`)));
    const active = links.filter(link => link.includes('aria-current="page"'));
    assert.equal(active.length, 1);
    assert.ok(active[0].includes(`href="/projects/${projectId}${current === "settings" ? "" : `/${current}`}?version=${version.id}"`));
  }
});

test("unsaved project has no links to scenes or export and explains why", () => {
  const html = renderToStaticMarkup(<ProjectWorkspace projectId={projectId} title="Новый" current="scripts" />);
  assert.ok(html.includes(`href="/projects/${projectId}/scripts"`));
  assert.ok(!html.includes(`href="/projects/${projectId}/scenes`));
  assert.ok(!html.includes(`href="/projects/${projectId}/export`));
  assert.ok(!html.includes(`href="/projects/${projectId}/publication`));
  assert.equal((html.match(/aria-disabled="true"/g) ?? []).length, 3);
  assert.ok(html.includes("Сохраните первый сценарий"));
});

test("workspace escapes a user title and always offers a direct library link", () => {
  const html = renderToStaticMarkup(<ProjectWorkspace projectId={projectId} title={'<script>alert("x")</script>'} current="export" version={version} />);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes('href="/projects"'));
});
