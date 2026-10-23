import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { highlight } from "../../src/cli/format";
import { resumeCommand, type Session } from "../../src/core/sessions";
import { bracketMatches, clip, oneLine, repoName, shortPath, textFormat } from "../../src/core/text";

test("oneLine flattens whitespace and truncates with an ellipsis", () => {
  expect(oneLine("a\n\n  b", 10)).toBe("a b");
  expect(oneLine("abcdefghij", 5)).toBe("abcd…");
  expect(oneLine(null, 5)).toBe("");
});

test("highlight renders search marks as brackets without color", () => {
  expect(highlight("o \x01relatório\x02 mensal")).toBe("o [relatório] mensal");
});

test("numbers, sizes and dates follow the locale", () => {
  const pt = textFormat("pt-BR");
  const en = textFormat("en");
  expect(pt.count(10606)).toBe("10.606");
  expect(en.count(10606)).toBe("10,606");
  expect(pt.bytes(512)).toBe("512 B");
  expect(pt.bytes(2.5 * 1024 ** 3)).toBe("2,5 GB");
  expect(en.bytes(2.5 * 1024 ** 3)).toBe("2.5 GB");
  expect(pt.when("2026-10-01T10:00:00.000Z")).toMatch(/^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
  expect(en.when(null)).toBe("—");
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

test("clip cuts long text and bracketMatches renders search marks as plain text", () => {
  expect(clip("abcdef", 4)).toBe("abc…");
  expect(clip("abc", 4)).toBe("abc");
  expect(bracketMatches("a \x01b\x02 c")).toBe("a [b] c");
});
