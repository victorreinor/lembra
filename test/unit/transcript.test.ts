import { describe, expect, test } from "bun:test";
import { applyEdit, findPaths, historyPrompt, normalizePrompt, parseRecord, shouldParse } from "../../src/core/transcript";
import { records } from "../support/fixture";

const CWD = "/Users/dev/projects/app";
const TS = "2026-10-01T10:00:00.000Z";
const r = records(CWD);

describe("shouldParse", () => {
  test("skips bookkeeping records without parsing them", () => {
    expect(shouldParse('{"type":"api-request-blob","hash":"x"}')).toBe(false);
    expect(shouldParse('{"type":"permission-mode","permissionMode":"auto"}')).toBe(false);
    expect(shouldParse("")).toBe(false);
  });

  test("keeps content records, including those whose first key is not type", () => {
    expect(shouldParse('{"type":"user","uuid":"1"}')).toBe(true);
    expect(shouldParse('{"type":"custom-title","customTitle":"x"}')).toBe(true);
    expect(shouldParse('{"parentUuid":null,"type":"assistant"}')).toBe(true);
  });
});

describe("parseRecord", () => {
  test("reads a typed prompt with its context", () => {
    const parsed = parseRecord(r.prompt("u1", TS, "corrige o bug"));
    expect(parsed).toMatchObject({ ts: TS, cwd: CWD, branch: "fix/billing", sidechain: false });
    expect(parsed.messages).toEqual([{ uid: "u1", role: "prompt", text: "corrige o bug" }]);
  });

  test("keeps pasted images as files", () => {
    const content = [
      { type: "text", text: "olha esse print" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
    ];
    const parsed = parseRecord(r.prompt("abcdef123", TS, content));
    expect(parsed.messages[0]!.text).toBe("olha esse print");
    expect(parsed.files).toEqual([{ uid: "abcdef123:1", kind: "image", path: "imagem-abcdef12-1.png", base64: "aGVsbG8=" }]);
  });

  test("keeps only the text of replies", () => {
    expect(parseRecord(r.reply("a1", TS, "pronto")).messages).toEqual([{ uid: "a1", role: "reply", text: "pronto" }]);
  });

  test("ignores subagent chatter, meta records and machine-sent turns", () => {
    expect(parseRecord({ ...r.reply("a1", TS, "x"), isSidechain: true }).messages).toEqual([]);
    expect(parseRecord(r.meta("u1", TS, "caveat")).messages).toEqual([]);
    expect(parseRecord(r.notification("u1", TS, "<task-notification>")).messages).toEqual([]);
    expect(parseRecord({ ...r.prompt("u1", TS, "x"), origin: undefined, turnOrigin: "peer" }).messages).toEqual([]);
    expect(parseRecord({ ...r.prompt("u1", TS, "x"), promptSource: "system" }).messages).toEqual([]);
  });

  test("treats older records without origin fields as human", () => {
    const old = { ...r.prompt("u1", TS, "antigo"), origin: undefined, promptSource: undefined };
    expect(parseRecord(old).messages).toHaveLength(1);
  });

  test("marks /compact summaries", () => {
    expect(parseRecord(r.compactSummary("u1", TS, "This session is being continued…")).messages[0]!.role).toBe("summary");
  });

  test("reads messages typed while Claude was working", () => {
    expect(parseRecord(r.queued("q1", TS, "qualquer coisa me pergunta")).messages).toEqual([
      { uid: "q1", role: "prompt", text: "qualquer coisa me pergunta" },
    ]);
    expect(parseRecord(r.queued("q2", TS, "ls", { commandMode: "bash" })).messages).toEqual([]);
    expect(parseRecord(r.queued("q3", TS, "x", { origin: { kind: "coordinator" } })).messages).toEqual([]);
  });

  test("turns Write and Edit results into file operations", () => {
    const write = parseRecord(r.toolResult("u1", TS, { type: "create", filePath: `${CWD}/a.sql`, content: "x" }));
    expect(write.files).toEqual([{ uid: "toolu_u1", kind: "write", path: `${CWD}/a.sql`, content: "x" }]);

    const edit = parseRecord(
      r.toolResult("u2", TS, { filePath: `${CWD}/a.sql`, oldString: "x", newString: "y", originalFile: "x", replaceAll: true }),
    );
    expect(edit.files).toEqual([
      { uid: "toolu_u2", kind: "edit", path: `${CWD}/a.sql`, oldText: "x", newText: "y", replaceAll: true, original: "x" },
    ]);
  });

  test("keeps full reads of files outside the repo only", () => {
    const read = (filePath: string, file: object = {}) =>
      parseRecord(
        r.toolResult("u1", TS, { type: "text", file: { filePath, content: "c", numLines: 3, startLine: 1, totalLines: 3, ...file } }),
      ).files;
    expect(read("/Users/dev/Downloads/q.sql")).toEqual([{ uid: "toolu_u1", kind: "read", path: "/Users/dev/Downloads/q.sql", content: "c" }]);
    expect(read(`${CWD}/src/index.ts`)).toEqual([]);
    expect(read("/Users/dev/other/node_modules/x/index.js")).toEqual([]);
    expect(read("/Users/dev/Downloads/q.sql", { startLine: 10 })).toEqual([]);
  });

  test("reads titles and cost", () => {
    expect(parseRecord(r.aiTitle("Título")).aiTitle).toBe("Título");
    expect(parseRecord(r.customTitle("nome")).customTitle).toBe("nome");
    expect(parseRecord(r.cost(2, 5, 1)).cost).toEqual({ usd: 2, added: 5, removed: 1 });
  });
});

describe("normalizePrompt", () => {
  test("turns slash-command markup into the command line", () => {
    expect(normalizePrompt("<command-message>rename</command-message><command-name>/rename</command-name><command-args>billing</command-args>")).toBe(
      "/rename billing",
    );
    expect(normalizePrompt("<command-name>/clear</command-name><command-args></command-args>")).toBe("/clear");
  });

  test("drops injected reminders and pasted-content tags", () => {
    expect(normalizePrompt('olha <pasted_content id="a1">log</pasted_content id="a1"><system-reminder>x</system-reminder>')).toBe("olha log");
  });

  test("ignores command output and interruptions", () => {
    expect(normalizePrompt("<local-command-stdout>ok</local-command-stdout>")).toBeNull();
    expect(normalizePrompt("[Request interrupted by user]")).toBeNull();
    expect(normalizePrompt("   ")).toBeNull();
  });
});

test("historyPrompt appends pasted contents to what was typed", () => {
  const entry = { display: "[Pasted text #1 +2 lines] explica", pastedContents: { 1: { id: 1, type: "text", content: "stack trace" } } };
  expect(historyPrompt(entry)).toBe("[Pasted text #1 +2 lines] explica\n\nstack trace");
});

test("findPaths extracts unique absolute and home paths without trailing punctuation", () => {
  expect(findPaths("veja ~/Downloads/a.sql. e /Users/x/b.png, depois ~/Downloads/a.sql")).toEqual(["~/Downloads/a.sql", "/Users/x/b.png"]);
  expect(findPaths("nada aqui")).toEqual([]);
});

describe("applyEdit", () => {
  test("replaces the first occurrence, or all of them", () => {
    expect(applyEdit("a a", { oldText: "a", newText: "b", replaceAll: false })).toBe("b a");
    expect(applyEdit("a a", { oldText: "a", newText: "b", replaceAll: true })).toBe("b b");
  });

  test("inserts replacement text literally", () => {
    expect(applyEdit("x", { oldText: "x", newText: "$&$1", replaceAll: false })).toBe("$&$1");
  });

  test("fails when the old text is not there", () => {
    expect(applyEdit("abc", { oldText: "z", newText: "y", replaceAll: false })).toBeUndefined();
    expect(applyEdit("abc", { oldText: "", newText: "y", replaceAll: false })).toBeUndefined();
  });
});
