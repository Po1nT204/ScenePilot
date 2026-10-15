import assert from "node:assert/strict";
import test from "node:test";
import { validateProject, isProjectId } from "../src/lib/projects/validation";
function form(overrides: Record<string, string> = {}) {
 const result = new FormData();
 const values = { title: " Мой ролик ", topic: "История города", genre: "Документальный", style: "Спокойный", language: "ru", duration: "60", ...overrides };
 Object.entries(values).forEach(([key, value]) => result.set(key, value));
 return result;
}
test("valid data is trimmed and duration becomes a number", () => {
 const result = validateProject(form());
 assert.equal(result.valid, true);
 assert.equal(result.data.title, "Мой ролик");
 assert.equal(result.data.target_duration_seconds, 60);
});
test("rejects empty text and oversized input", () => {
 const cases: Record<string, string>[] = [{ title: "   " }, { topic: "a".repeat(4001) }, { genre: "a".repeat(101) }, { style: "" }];
 for (const overrides of cases) assert.equal(validateProject(form(overrides)).valid, false);
});
test("rejects fractional, non-numeric and out-of-range duration", () => {
 for (const duration of ["", "0", "901", "-1", "1.5", "NaN", "Infinity", "1e2"]) assert.equal(validateProject(form({ duration })).valid, false, duration);
 for (const duration of ["1", "300", "301", "480", "600", "720", "900"]) assert.equal(validateProject(form({ duration })).valid, true);
});
test("rejects unknown language and file payload", () => {
 assert.equal(validateProject(form({ language: "other" })).valid, false);
 const payload = form(); payload.set("title", new Blob(["hello"]), "title.txt");
 assert.equal(validateProject(payload).valid, false);
});
test("ignores browser-supplied ownership and metadata", () => {
 const result = validateProject(form({ owner_id: "another-user", id: "another-project", updated_at: "yesterday" }));
 assert.equal(result.valid, true);
 for (const key of ["owner_id", "id", "updated_at"]) assert.equal(key in result.data, false);
});
test("project id must be a UUID", () => {
 assert.equal(isProjectId("a12065f4-d71a-4e83-8a34-b3c72cf4446f"), true);
 for (const id of [null, "", "../projects", "not-a-uuid"]) assert.equal(isProjectId(id), false);
});
