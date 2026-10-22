import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/cli/main";
import { captureIo, createFixture, decode, seedBillingSession, SESSION, type Fixture } from "../support/fixture";

let f: Fixture;
let seeded: ReturnType<typeof seedBillingSession>;

beforeEach(() => {
  f = createFixture();
  seeded = seedBillingSession(f);
});

afterEach(() => f.cleanup());

async function lembra(...argv: string[]) {
  const io = captureIo();
  const code = await run(argv, io, f.paths);
  return { code, out: io.stdout.join("\n"), err: io.stderr.join("\n"), bytes: io.bytes };
}

describe("lembra", () => {
  test("--help explains every command", async () => {
    const { code, out } = await lembra("--help");
    expect(code).toBe(0);
    for (const command of ["search", "list", "show", "resume", "files", "restore", "cat", "index", "stats"]) {
      expect(out).toContain(`lembra ${command}`);
    }
  });

  test("rejects unknown options with exit code 2", async () => {
    const { code, err } = await lembra("--nope");
    expect(code).toBe(2);
    expect(err).toContain("lembra --help");
  });

  test("indexes on first use and lists recent sessions", async () => {
    const { code, out, err } = await lembra();
    expect(code).toBe(0);
    expect(err).toContain("Primeira indexação");
    expect(out).toContain("billing-fix");
    expect(out).toContain("1 prompts");
  });

  test("treats bare words as a search", async () => {
    const { out } = await lembra("faturamento");
    expect(out).toContain(SESSION.slice(0, 8));
    expect(out).toContain("[faturamento]");
  });

  test("show prints prompts, files and the resume command", async () => {
    const { out } = await lembra("show", "billing-fix");
    expect(out).toContain(`claude --resume ${SESSION}`);
    expect(out).toContain("preciso corrigir o relatório");
    expect(out).toContain("fix.sql");
    expect(out).toContain("apagado do disco");
  });

  test("files --missing lists only what is gone from disk", async () => {
    const { out } = await lembra("files", "--missing");
    expect(out).toContain("fix.sql");
    expect(out).toContain("dump.sql");
    expect(out).not.toContain("relatorio.sql");
  });

  test("restore writes the latest version back and refuses to overwrite", async () => {
    expect((await lembra("restore", seeded.fixSql)).code).toBe(0);
    expect(readFileSync(seeded.fixSql, "utf8")).toBe("UPDATE faturas SET total = 2;\n");

    const again = await lembra("restore", seeded.fixSql);
    expect(again.code).toBe(1);
    expect(again.err).toContain("já existe");
  });

  test("restore --to a folder keeps the file name", async () => {
    const desk = join(f.root, "Desktop");
    mkdirSync(desk);
    await lembra("restore", seeded.dump, "--to", desk);
    expect(existsSync(join(desk, "dump.sql"))).toBe(true);
  });

  test("cat prints the stored bytes", async () => {
    const { bytes } = await lembra("cat", seeded.dump);
    expect(decode(bytes[0]!)).toBe("INSERT INTO faturas VALUES (1);");
  });

  test("resume prints the command when the folder no longer exists", async () => {
    const { code, out, err } = await lembra("resume", "11111111");
    expect(code).toBe(0);
    expect(err).toContain("não existe mais");
    expect(out).toBe(`cd '${f.cwd}' && claude --resume ${SESSION}`);
  });

  test("stats warns while Claude Code still deletes old transcripts", async () => {
    expect((await lembra("stats")).out).toContain("30 dias (padrão)");
    writeFileSync(join(f.paths.claudeDir, "settings.json"), JSON.stringify({ cleanupPeriodDays: 3650 }));
    expect((await lembra("stats")).out).toContain("retenção: 3.650 dias");
  });

  test("explains unknown sessions with exit code 1", async () => {
    const { code, err } = await lembra("show", "zzz");
    expect(code).toBe(1);
    expect(err).toContain("Nenhuma sessão");
  });
});

test("the bin runs as a standalone executable", () => {
  const result = Bun.spawnSync(["bun", "src/cli/index.ts", "--help"], { cwd: join(import.meta.dir, "..", "..") });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("lembra search");
});
