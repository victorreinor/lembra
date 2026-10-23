import { LembraError } from "../core/errors";
import { TOOLS, type ToolContext } from "./tools";

// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0): initialize, ping, tools/list, tools/call.
// Anything written to stdout must be protocol; diagnostics go to stderr.

const FALLBACK_PROTOCOL = "2025-06-18";
const INSTRUCTIONS =
  "lembra guarda o histórico completo do Claude Code desta máquina (todas as pastas, inclusive sessões antigas). " +
  "Antes de refazer algo que o usuário diz já ter feito, use search_history. Para continuar o trabalho de outra sessão, use handoff. " +
  "Para recuperar um arquivo gerado antes, use list_files e get_file.";

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: any;
}

export interface McpOptions extends ToolContext {
  version: string;
  // Called before each tool runs, so answers include what happened seconds ago.
  refresh?: () => Promise<void>;
}

export function createMcpHandler(opts: McpOptions) {
  return async function handle(message: JsonRpcMessage): Promise<object | null> {
    const isNotification = message.id === undefined || message.id === null;
    const result = (value: object) => ({ jsonrpc: "2.0", id: message.id, result: value });
    const error = (code: number, text: string) => ({ jsonrpc: "2.0", id: message.id ?? null, error: { code, message: text } });

    switch (message.method) {
      case "initialize":
        return result({
          protocolVersion: message.params?.protocolVersion ?? FALLBACK_PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: "lembra", version: opts.version },
          instructions: INSTRUCTIONS,
        });
      case "ping":
        return result({});
      case "tools/list":
        return result({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case "tools/call": {
        const tool = TOOLS.find((candidate) => candidate.name === message.params?.name);
        if (!tool) return error(-32602, `Ferramenta desconhecida: ${message.params?.name}`);
        try {
          await opts.refresh?.();
          const text = await tool.run(opts, message.params?.arguments ?? {});
          return result({ content: [{ type: "text", text }] });
        } catch (failure) {
          if (!(failure instanceof LembraError)) throw failure;
          return result({ content: [{ type: "text", text: failure.message }], isError: true });
        }
      }
      default:
        return isNotification ? null : error(-32601, `Método não suportado: ${message.method}`);
    }
  };
}

export async function serveStdio(handle: ReturnType<typeof createMcpHandler>) {
  const send = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line);
      } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } });
        continue;
      }
      try {
        const response = await handle(message);
        if (response) send(response);
      } catch (failure) {
        console.error(failure);
        send({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32603, message: (failure as Error).message } });
      }
    }
  }
}
