import { expect, test } from "bun:test";
import type { Session } from "../../src/core/sessions";
import { summaryPrompt } from "../../src/core/summarize";

const session = { repo: "acme/billing-api", branch: "fix/fatura", title: "Corrigir fatura" } as Session;

test("summaryPrompt names the session and labels who said what", () => {
  const prompt = summaryPrompt(session, [
    { role: "prompt", ts: "", text: "corrige a fatura" },
    { role: "reply", ts: "", text: "feito" },
  ], "pt-BR");
  expect(prompt).toContain("acme/billing-api · branch: fix/fatura · título: Corrigir fatura");
  expect(prompt).toContain("[usuário] corrige a fatura\n\n[claude] feito");
  expect(prompt).toContain("português do Brasil");
});

test("summaryPrompt keeps the start and the end of long sessions", () => {
  const messages = Array.from({ length: 60 }, (_, i) => ({ role: "prompt" as const, ts: "", text: `pedido ${i} ${"x".repeat(900)}` }));
  const prompt = summaryPrompt(session, messages, "pt-BR");
  expect(prompt).toContain("pedido 0 ");
  expect(prompt).toContain("pedido 59 ");
  expect(prompt).toContain("[…]");
  expect(prompt.length).toBeLessThan(26_000);
});

test("summaryPrompt asks for the summary in the user's language", () => {
  const prompt = summaryPrompt(session, [{ role: "prompt", ts: "", text: "fix the invoice" }], "en");
  expect(prompt).toContain("Answer in English");
  expect(prompt).toContain("[user] fix the invoice");
});
