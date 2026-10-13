import assert from "node:assert/strict";
import test from "node:test";
import { validateScript } from "../src/lib/scripts/validation";
test("script preserves internal line breaks and trims edges", () => {
 assert.deepEqual(validateScript("  Первая сцена\n\nВторая сцена  "), { content: "Первая сцена\n\nВторая сцена", error: undefined });
});
test("script rejects missing, whitespace and file input", () => {
 for (const value of [null, " \n\t", new File(["text"], "script.txt")]) assert.ok(validateScript(value).error);
});
test("script enforces the size boundary", () => {
 assert.equal(validateScript("я".repeat(20000)).error, undefined);
 assert.ok(validateScript("я".repeat(20001)).error);
});
