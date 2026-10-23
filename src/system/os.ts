import { LembraError } from "../core/errors";

// Thin wrappers over the commands each OS offers; everything here is a side effect on the user's desktop.

async function pipeTo(cmd: string[], input: string) {
  const proc = Bun.spawn(cmd, { stdin: new Blob([input]), stdout: "ignore", stderr: "pipe" });
  if ((await proc.exited) !== 0) throw new LembraError(`${cmd[0]} falhou: ${(await new Response(proc.stderr).text()).trim()}`);
}

export async function copyToClipboard(text: string) {
  if (process.platform === "darwin") return pipeTo(["pbcopy"], text);
  const tool = Bun.which("wl-copy") ? ["wl-copy"] : Bun.which("xclip") ? ["xclip", "-selection", "clipboard"] : null;
  if (!tool) throw new LembraError("Não achei pbcopy, wl-copy nem xclip para copiar.");
  return pipeTo(tool, text);
}

export function openUrl(url: string) {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore" });
}

const appleScriptString = (text: string) => `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

// Opens a new Terminal.app window running the command (macOS only).
export async function runInTerminal(command: string) {
  if (process.platform !== "darwin") throw new LembraError("Abrir no Terminal só funciona no macOS por enquanto.");
  const script = `tell application "Terminal"\n  activate\n  do script ${appleScriptString(command)}\nend tell`;
  const proc = Bun.spawn(["osascript", "-e", script], { stdout: "ignore", stderr: "pipe" });
  if ((await proc.exited) !== 0) throw new LembraError(`osascript falhou: ${(await new Response(proc.stderr).text()).trim()}`);
}
