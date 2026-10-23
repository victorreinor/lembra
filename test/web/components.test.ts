import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { FileDTO, ResultDTO, SessionDetailResponse, SessionDTO, SessionMessage } from "../../src/web/types";

// A DOM only for this file; component modules touch `document` only when called.
beforeAll(async () => {
  GlobalRegistrator.register({ url: "http://localhost:4747/" });
  (await import("../../src/web/ui/lib/i18n")).setLocale("pt-BR");
});
afterAll(() => GlobalRegistrator.unregister());

const { h, highlighted } = await import("../../src/web/ui/lib/dom");
const { SessionCard } = await import("../../src/web/ui/components/session-card/session-card");
const { FileRow } = await import("../../src/web/ui/components/file-row/file-row");
const { SessionDetail } = await import("../../src/web/ui/components/session-detail/session-detail");
const { FilterBar } = await import("../../src/web/ui/components/filter-bar/filter-bar");
const { PromptList } = await import("../../src/web/ui/components/prompt-list/prompt-list");
const { EmptyState } = await import("../../src/web/ui/components/empty-state/empty-state");
const { DEFAULT_STATE } = await import("../../src/web/ui/lib/state");
const { Button } = await import("../../src/web/ui/components/button/button");

const message = (role: SessionMessage["role"], text: string): SessionMessage => ({ id: 1, role, ts: "2026-10-01T10:00:00.000Z", text, truncated: false });

const session: SessionDTO = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Corrigir faturamento",
  repo: "acme/billing-api",
  repoName: "billing-api",
  branch: "fix/fatura",
  cwd: "/work/billing-api",
  startedAt: "2026-10-01T10:00:00.000Z",
  endedAt: "2026-10-01T11:00:00.000Z",
  promptCount: 3,
  source: "transcript",
  costUsd: 1.5,
  linesAdded: 10,
  linesRemoved: 2,
  digest: null,
  lastPrompt: "e o mensal?",
  resumeCommand: "cd '/work/billing-api' && claude --resume 11111111-2222-3333-4444-555555555555",
};

const file = (overrides: Partial<FileDTO> = {}): FileDTO => ({
  id: 7,
  path: "/home/me/Downloads/fix.sql",
  displayPath: "~/Downloads/fix.sql",
  kind: "write",
  ts: "2026-10-01T10:05:00.000Z",
  size: 120,
  repoName: "billing-api",
  sessionId: session.id,
  versions: 1,
  secrets: 0,
  status: "missing",
  ...overrides,
});

describe("dom helpers", () => {
  test("h() never turns text into markup", () => {
    const el = h("p", { class: "x", dataset: { id: "1" }, style: { "--repo-hue": 120 } }, "<img src=x onerror=alert(1)>");
    expect(el.innerHTML).toBe("&lt;img src=x onerror=alert(1)&gt;");
    expect(el.dataset.id).toBe("1");
    expect(el.style.getPropertyValue("--repo-hue")).toBe("120");
  });

  test("highlighted() turns search markers into <mark>", () => {
    const el = h("span", null, highlighted("o \x01relatório\x02 mensal"));
    expect(el.innerHTML).toBe("o <mark>relatório</mark> mensal");
  });
});

describe("Button", () => {
  test("stays busy and ignores clicks while an async action runs", async () => {
    let finish!: () => void;
    let runs = 0;
    const button = Button({
      label: "Copiar",
      onClick: () => {
        runs++;
        return new Promise<void>((resolve) => (finish = resolve));
      },
    });
    button.click();
    button.click();
    expect(runs).toBe(1);
    expect(button.getAttribute("aria-busy")).toBe("true");
    finish();
    await Bun.sleep(0);
    expect(button.hasAttribute("aria-busy")).toBe(false);
  });

  test("icon-only buttons are small ghost buttons labelled by their title", () => {
    const button = Button({ label: "Ajuda", icon: "keyboard", iconOnly: true });
    expect(button.dataset).toMatchObject({ variant: "ghost", size: "sm" });
    expect(button.title).toBe("Ajuda");
  });
});

describe("SessionCard", () => {
  const result: ResultDTO = { session, snippets: [{ role: "prompt", ts: session.startedAt!, text: "corrigir o \x01faturamento\x02" }] };

  test("shows title, repo, branch and the marked snippet", () => {
    const card = SessionCard({ result, index: 0, selected: false, onSelect: () => {} });
    expect(card.querySelector(".session-card__title")!.textContent).toBe("Corrigir faturamento");
    expect(card.querySelector(".session-card__repo")!.textContent).toBe("billing-api");
    expect(card.querySelector("mark")!.textContent).toBe("faturamento");
    expect(card.querySelector(".session-card")!.getAttribute("aria-current")).toBeNull();
  });

  test("marks the selection, flags prompt-only sessions and reports clicks", () => {
    const onSelect = mock();
    const card = SessionCard({ result: { session: { ...session, source: "history" }, snippets: [] }, index: 0, selected: true, onSelect });
    const button = card.querySelector<HTMLButtonElement>(".session-card")!;
    expect(button.getAttribute("aria-current")).toBe("true");
    expect(card.textContent).toContain("só prompts");
    expect(card.textContent).toContain("e o mensal?");
    button.click();
    expect(onSelect).toHaveBeenCalledWith(session.id);
  });
});

describe("FileRow", () => {
  test("restores a missing file and updates its status", async () => {
    const onRestore = mock(async () => ({ displayDest: "~/Downloads/fix.sql" }));
    const row = FileRow({ file: file(), rawUrl: (id, download) => `/raw/${id}${download ? "?d" : ""}`, onRestore });
    expect(row.querySelector(".file-row__name")!.textContent).toBe("fix.sql");
    expect([...row.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["/raw/7", "/raw/7?d"]);
    [...row.querySelectorAll("button")].find((b) => b.textContent?.includes("Restaurar"))!.click();
    await Bun.sleep(0);
    expect(onRestore).toHaveBeenCalledWith(7);
    expect(row.querySelector(".file-row__status")!.textContent).toBe("restaurado");
  });

  test("offers no content actions when only the edit was recorded", () => {
    const row = FileRow({ file: file({ status: "partial" }), rawUrl: () => "", onRestore: async () => ({ displayDest: "" }) });
    expect(row.querySelectorAll("a, button")).toHaveLength(0);
    expect(row.textContent).toContain("sem conteúdo completo");
  });
});

describe("SessionDetail", () => {
  const data: SessionDetailResponse = {
    session,
    messages: [message("prompt", "corrige a fatura")],
    files: [file()],
  };
  const callbacks = {
    showReplies: false,
    canOpenTerminal: true,
    rawUrl: () => "",
    messageUrl: () => "",
    onRestore: async () => ({ displayDest: "" }),
    onBack: () => {},
    onToggleReplies: () => {},
    onOpenTerminal: async () => {},
    onCopyCommand: () => {},
    onCopyHandoff: async () => {},
  };

  test("offers resume actions for sessions with a transcript", () => {
    const el = SessionDetail({ data, ...callbacks });
    const labels = [...el.querySelectorAll(".session-detail__actions .button__label")].map((n) => n.textContent);
    expect(labels).toEqual(["Retomar no Terminal", "Copiar comando", "Copiar handoff"]);
    expect(el.querySelector(".session-detail__command")!.textContent).toBe(session.resumeCommand!);
    expect(el.textContent).toContain("Arquivos · 1");
  });

  test("renders in English when the page language is English", async () => {
    const { setLocale } = await import("../../src/web/ui/lib/i18n");
    setLocale("en");
    try {
      const el = SessionDetail({ data, ...callbacks });
      const labels = [...el.querySelectorAll(".session-detail__actions .button__label")].map((n) => n.textContent);
      expect(labels).toEqual(["Resume in Terminal", "Copy command", "Copy handoff"]);
      expect(el.textContent).toContain("Files · 1");
    } finally {
      setLocale("pt-BR");
    }
  });

  test("prompt-only sessions can only be handed off", () => {
    const el = SessionDetail({ data: { ...data, session: { ...session, source: "history", resumeCommand: null } }, ...callbacks });
    const labels = [...el.querySelectorAll(".session-detail__actions .button__label")].map((n) => n.textContent);
    expect(labels).toEqual(["Copiar handoff"]);
    expect(el.querySelector(".session-detail__notice")).not.toBeNull();
  });
});

describe("FilterBar", () => {
  const facets = { repos: [{ value: "acme/billing-api", sessions: 3, label: "billing-api" }], branches: [{ value: "fix/fatura", sessions: 1 }] };

  test("shows only what the view offers", () => {
    const bar = FilterBar({ onChange: () => {} });
    bar.update({ ...DEFAULT_STATE, view: "pending", repo: "acme" }, facets);
    expect(bar.el.querySelectorAll("select")).toHaveLength(0);
    expect([...bar.el.querySelectorAll(".chip")].map((c) => c.textContent)).toEqual(["14 dias", "30 dias", "90 dias"]);
    expect(bar.el.textContent).not.toContain("Limpar filtros");
  });

  test("reports changes and offers to clear active filters", () => {
    const onChange = mock();
    const bar = FilterBar({ onChange });
    bar.update({ ...DEFAULT_STATE, since: "7d" }, facets);
    expect(bar.el.querySelectorAll("select")).toHaveLength(2);
    expect(bar.el.querySelector('.chip[aria-pressed="true"]')!.textContent).toBe("7 dias");
    bar.el.querySelector<HTMLButtonElement>(".chip")!.click();
    expect(onChange).toHaveBeenCalledWith({ since: "" });
    expect(bar.el.textContent).toContain("Limpar filtros");
  });
});

describe("PromptList and EmptyState", () => {
  test("numbers prompts and collapses long ones behind a toggle", () => {
    const list = PromptList({
      messages: [message("prompt", "curto"), message("reply", "resposta"), message("prompt", "x".repeat(900))],
      messageUrl: (id) => `/api/messages/${id}`,
    });
    expect([...list.querySelectorAll(".prompt-list__gutter")].map((g) => g.textContent)).toEqual(["01", "↳", "02"]);
    const more = list.querySelector<HTMLButtonElement>(".prompt-list__more")!;
    more.click();
    expect(more.textContent).toBe("recolher");
    expect(list.querySelector("[data-collapsed]")).toBeNull();
  });

  test("links a message the server cut short to its whole text", () => {
    const list = PromptList({ messages: [{ ...message("prompt", "log longo"), id: 42, truncated: true }], messageUrl: (id) => `/api/messages/${id}` });
    expect(list.querySelector<HTMLAnchorElement>(".prompt-list__whole")!.getAttribute("href")).toBe("/api/messages/42");
  });

  test("empty states explain and suggest the next step", () => {
    const el = EmptyState({ icon: "search", title: "Nada encontrado", text: "Tente menos palavras." });
    expect(el.textContent).toBe("Nada encontradoTente menos palavras.");
  });
});
