#!/usr/bin/env bun
// Builds a fictional ~/.claude (no real data) and serves lembra on it, for screenshots, demos and UI work.
// Usage: bun run demo [port]   (default 4848)

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, consoleIo } from "../src/cli/main";
import { openDb } from "../src/core/db";
import { indexAll } from "../src/core/indexer";
import type { BranchFacts } from "../src/core/pending";
import type { Services } from "../src/core/services";
import { getSession } from "../src/core/sessions";
import { summarizeSession } from "../src/core/summarize";
import { records, writeJsonl } from "../test/support/fixture";

const port = process.argv[2] ?? "4848";
const root = join(tmpdir(), "lembra-demo");
const paths = { claudeDir: join(root, "claude"), dataDir: join(root, "data") };
rmSync(root, { recursive: true, force: true });

const HOUR = 3_600_000;
const at = (hoursAgo: number, minutes = 0) => new Date(Date.now() - hoursAgo * HOUR + minutes * 60_000).toISOString();

interface DemoSession {
  id: string;
  repo: string;
  branch: string;
  title: string;
  hoursAgo: number;
  turns: [prompt: string, reply: string][];
  files?: { name: string; content: string }[];
  digest?: string;
  cost?: number;
}

const SESSIONS: DemoSession[] = [
  {
    id: "3f2a91c0-1111-4000-8000-000000000001",
    repo: "billing-api",
    branch: "fix/fatura-duplicada",
    title: "Corrigir cálculo de faturamento duplicado",
    hoursAgo: 1.5,
    cost: 3.42,
    turns: [
      ["a query de faturamento mensal está retornando linhas duplicadas quando a nota tem mais de um item, investiga", "O join com `itens_nota` multiplica o faturamento por item. Vou agrupar por nota antes de somar."],
      ["gera o SQL de correção e salva em ~/Downloads pra eu rodar em homologação", "Gerei `fix-fatura-duplicada.sql` com o UPDATE e uma consulta de conferência antes e depois."],
      ["agora cria o teste de regressão", "Teste criado em `faturamento.spec.ts`: cobre nota com 1, 3 e 12 itens."],
    ],
    files: [
      { name: "fix-fatura-duplicada.sql", content: "-- conferência antes\nSELECT nota_id, sum(valor) FROM faturamento GROUP BY 1 HAVING count(*) > 1;\n" },
      { name: "faturamento.spec.ts", content: "describe('faturamento', () => {\n  it('não duplica notas com vários itens', () => {});\n});\n" },
    ],
    digest:
      "Corrigir o faturamento mensal que duplicava notas com vários itens.\nCausa: join com itens_nota antes do agrupamento. SQL de correção em fix-fatura-duplicada.sql e teste de regressão em faturamento.spec.ts. Pendente: rodar em homologação.",
  },
  {
    id: "8c41d2e7-1111-4000-8000-000000000002",
    repo: "orders-web",
    branch: "feat/filtro-status",
    title: "Filtro de status na listagem de pedidos",
    hoursAgo: 5,
    cost: 1.18,
    turns: [
      ["preciso de um filtro por status na tela de pedidos, com chips e contagem", "Adicionei chips com contagem por status e persistência na URL."],
      ["os chips precisam funcionar no teclado também", "Agora cada chip é um botão com aria-pressed; setas navegam entre eles."],
    ],
  },
  {
    id: "5b77e019-1111-4000-8000-000000000003",
    repo: "billing-api",
    branch: "main",
    title: "Relatório mensal de inadimplência",
    hoursAgo: 26,
    cost: 2.05,
    turns: [
      ["monta o relatório mensal de inadimplência por região, com faturamento em aberto", "Criei a view `inadimplencia_mensal` e o endpoint `/relatorios/inadimplencia`."],
      ["exporta em CSV também", "Endpoint aceita `?formato=csv`; o arquivo sai com cabeçalho em português."],
    ],
  },
  {
    id: "a90c3f44-1111-4000-8000-000000000004",
    repo: "infra",
    branch: "chore/alarme-cpu",
    title: "Alarme de CPU no banco de leitura",
    hoursAgo: 30,
    turns: [
      ["o alarme de CPU do banco de leitura disparou de novo às 7h, investiga", "Pico causado pelo job de conciliação; ele roda sem índice em `pagamentos.criado_em`."],
      ["cria o índice com CONCURRENTLY e me manda o passo a passo", "Script de migração pronto, com verificação de bloat e rollback."],
    ],
  },
  {
    id: "d2e8b6a1-1111-4000-8000-000000000005",
    repo: "orders-web",
    branch: "main",
    title: "Revisar acessibilidade do checkout",
    hoursAgo: 75,
    turns: [["faz uma revisão de acessibilidade do checkout, foco em teclado e contraste", "Encontrei 6 problemas; os dois críticos são foco perdido no modal e contraste do botão desabilitado."]],
  },
  {
    id: "61f0aa38-1111-4000-8000-000000000006",
    repo: "data-pipeline",
    branch: "feat/backfill-notas",
    title: "Backfill das notas fiscais de 2025",
    hoursAgo: 120,
    turns: [
      ["preciso reprocessar as notas fiscais de 2025 sem travar a fila", "Backfill em lotes de 500 com checkpoint em tabela de controle."],
      ["quanto tempo leva?", "Pela amostra, cerca de 3 horas para 1,2 milhão de notas."],
    ],
  },
];

const HISTORY_ONLY = [
  { sessionId: "77aa0000-1111-4000-8000-000000000007", project: "/Users/demo/projects/billing-api", display: "como funcionava o cálculo de faturamento antes da reforma tributária?", daysAgo: 90 },
  { sessionId: "77aa0000-1111-4000-8000-000000000007", project: "/Users/demo/projects/billing-api", display: "e o arredondamento por item?", daysAgo: 90 },
];

for (const session of SESSIONS) {
  const cwd = `/Users/demo/projects/${session.repo}`;
  const r = records(cwd, session.id);
  const lines: object[] = [];
  session.turns.forEach(([prompt, reply], i) => {
    lines.push({ ...r.prompt(`${session.id}-p${i}`, at(session.hoursAgo, i * 7), prompt), gitBranch: session.branch });
    lines.push({ ...r.reply(`${session.id}-r${i}`, at(session.hoursAgo, i * 7 + 2), reply), gitBranch: session.branch });
  });
  (session.files ?? []).forEach((file, i) => {
    const filePath = file.name.endsWith(".sql") ? `/Users/demo/Downloads/${file.name}` : `${cwd}/src/${file.name}`;
    lines.push({ ...r.toolResult(`${session.id}-f${i}`, at(session.hoursAgo, 9 + i), { type: "create", filePath, content: file.content }), gitBranch: session.branch });
  });
  lines.push(r.aiTitle(session.title));
  if (session.cost) lines.push(r.cost(session.cost, 120, 18));
  writeJsonl(join(paths.claudeDir, "projects", cwd.replaceAll("/", "-"), `${session.id}.jsonl`), lines);
}

mkdirSync(paths.claudeDir, { recursive: true });
writeFileSync(
  join(paths.claudeDir, "history.jsonl"),
  HISTORY_ONLY.map((entry) => JSON.stringify({ ...entry, pastedContents: {}, timestamp: Date.now() - entry.daysAgo * 24 * HOUR })).join("\n") + "\n",
);
writeFileSync(join(paths.claudeDir, "settings.json"), JSON.stringify({ cleanupPeriodDays: 3650 }));

// Fixed answers instead of git/gh/Claude, so the demo is the same on every machine.
const PENDING: Record<string, BranchFacts> = {
  "fix/fatura-duplicada": { exists: true, upstream: true, ahead: 2, dirty: false, pr: "NONE" },
  "feat/backfill-notas": { exists: true, upstream: false, ahead: 0, dirty: true, pr: "NONE" },
};
const services: Services = {
  git: {
    root: async (cwd) => cwd,
    defaultBranch: async () => "main",
    facts: async (_root, branch) => PENDING[branch] ?? { exists: true, upstream: true, ahead: 0, dirty: false, pr: "MERGED" },
  },
  summarizer: () => async () => "",
};

const db = openDb(paths.dataDir);
await indexAll(db, paths);
for (const session of SESSIONS.filter((s) => s.digest)) {
  await summarizeSession(db, getSession(db, session.id)!, async () => session.digest!, "pt-BR");
}
db.close();

console.log(`Demo com dados fictícios em ${root}`);
process.exit(await run(["ui", "--port", port], consoleIo, paths, services));
