import { LembraError } from "../core/errors";
import { exec } from "../core/exec";

// Thin wrappers over the commands each OS offers; everything here is a side effect on the user's desktop.

async function pipeTo(cmd: string[], input: string) {
  const { code, err } = await exec(cmd, { stdin: input });
  if (code !== 0) throw new LembraError("commandFailed", { command: cmd[0]!, detail: err });
}

export async function copyToClipboard(text: string) {
  if (process.platform === "darwin") return pipeTo(["pbcopy"], text);
  const tool = Bun.which("wl-copy") ? ["wl-copy"] : Bun.which("xclip") ? ["xclip", "-selection", "clipboard"] : null;
  if (!tool) throw new LembraError("noClipboard");
  return pipeTo(tool, text);
}

export function openUrl(url: string) {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore" });
}

const appleScriptString = (text: string) => `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

// Opens a new Terminal.app window running the command (macOS only).
export async function runInTerminal(command: string) {
  if (process.platform !== "darwin") throw new LembraError("terminalMacOnly");
  // osascript reads the script from stdin when given no file.
  return pipeTo(["osascript"], `tell application "Terminal"\n  activate\n  do script ${appleScriptString(command)}\nend tell`);
}
