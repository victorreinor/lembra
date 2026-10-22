import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { bytes, count, highlight, oneLine, repoName, shortPath, when } from "../../src/cli/format";
import { resumeCommand, type Session } from "../../src/core/sessions";

test("oneLine flattens whitespace and truncates with an ellipsis", () => {
  expect(oneLine("a\n\n  b", 10)).toBe("a b");
  expect(oneLine("abcdefghij", 5)).toBe("abcd…");
  expect(oneLine(null, 5)).toBe("");
});

test("highlight renders search marks as brackets without color", () => {
  expect(highlight("o \x01relatório\x02 mensal")).toBe("o [relatório] mensal");
});

test("numbers and sizes use Brazilian formatting", () => {
  expect(count(10606)).toBe("10.606");
  expect(bytes(512)).toBe("512 B");
  expect(bytes(2.5 * 1024 ** 3)).toBe("2,5 GB");
});

test("dates render as dd/mm/aa hh:mm", () => {
  expect(when("2026-10-01T10:00:00.000Z")).toMatch(/^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
  expect(when(null)).toBe("—");
});

test("paths and repos are shortened for display", () => {
  expect(shortPath(`${homedir()}/Downloads/a.sql`)).toBe("~/Downloads/a.sql");
  expect(shortPath("/tmp/a")).toBe("/tmp/a");
  expect(repoName("acme/billing-api")).toBe("billing-api");
  expect(repoName(null)).toBe("?");
});

test("resumeCommand quotes the folder for the shell", () => {
  const session = { id: "abc", cwd: "/tmp/it's here" } as Session;
  expect(resumeCommand(session)).toBe(`cd '/tmp/it'\\''s here' && claude --resume abc`);
});
