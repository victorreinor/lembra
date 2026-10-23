import { bracketMatches } from "../core/text";

// Terminal colors. Text helpers (dates, sizes, paths) live in core/text.

const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: string) => (text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);

export const bold = paint("1");
export const dim = paint("2");
export const red = paint("31");
export const green = paint("32");
export const yellow = paint("33");
export const cyan = paint("36");

export function highlight(snippet: string): string {
  if (!color) return bracketMatches(snippet);
  return `${snippet.replaceAll("\x01", "\x1b[1;33m").replaceAll("\x02", "\x1b[0m")}\x1b[0m`;
}
