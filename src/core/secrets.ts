// Credentials that tend to get pasted into prompts or echoed in replies. Matches become
// "[REDACTED:<kind>]" in everything lembra indexes; stored files keep their exact bytes so restores stay faithful.

// Bump when the rules change: stored messages are masked again on the next index run.
export const REDACTION_VERSION = 2;

interface Rule {
  kind: string;
  // `d` flag required. When the pattern has a named group `secret`, only that part is hidden.
  pattern: RegExp;
  // Values that look like secrets but are references or settings ($VAR, process.env.X, 3600).
  allow?: (secret: string) => boolean;
}

const REFERENCE = /^(?:\[REDACTED|\$|process\.env|import\.meta|os\.environ|env\(|getenv|<|\{\{|true$|false$|null$|undefined$|none$)/i;
const SHORT_NUMBER = /^\d{1,7}$/;
const notASecret = (value: string) => REFERENCE.test(value) || SHORT_NUMBER.test(value);

const SECRET_NAME = "(?:PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_?KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS?)";

const RULES: Rule[] = [
  { kind: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/dg },
  { kind: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/dg },
  { kind: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/dg },
  { kind: "gitlab-token", pattern: /\bglpat-[A-Za-z0-9_-]{20,}/dg },
  { kind: "slack-token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/dg },
  { kind: "slack-webhook", pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/dg },
  { kind: "stripe-key", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/dg },
  { kind: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/dg },
  { kind: "openai-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/dg },
  { kind: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}/dg },
  { kind: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/dg },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/dg },
  { kind: "bearer-token", pattern: /\bBearer\s+(?<secret>[A-Za-z0-9._~+/-]{20,}=*)/dg },
  // scheme://user:password@host — git remotes with tokens, database URLs.
  { kind: "url-password", pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:(?<secret>[^\s@/]{3,})@/dgi, allow: notASecret },
  // DB_PASSWORD=…, AWS_SECRET_ACCESS_KEY: … (env files, exports, YAML with upper-case keys).
  { kind: "env-secret", pattern: new RegExp(`\\b[A-Z][A-Z0-9_]*${SECRET_NAME}[A-Z0-9_]*\\s*[=:]\\s*["']?(?<secret>[^\\s"'#,;]{4,})`, "dg"), allow: notASecret },
  // "password": "…", accessToken: '…', client_secret = "…" in JSON, YAML or code (a quoted value is required,
  // so type annotations like `password: string` stay readable).
  {
    kind: "config-secret",
    pattern: /(["']?)\b[A-Za-z0-9_-]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\1\s*[:=]\s*(["'`])(?<secret>[^"'`\s]{6,})\2/dgi,
    allow: notASecret,
  },
];

export interface Redaction {
  text: string;
  count: number;
}

export function redact(text: string): Redaction {
  let count = 0;
  for (const rule of RULES) {
    let out = "";
    let last = 0;
    for (const match of text.matchAll(rule.pattern)) {
      const [start, end] = match.indices!.groups?.secret ?? match.indices![0]!;
      if (rule.allow?.(text.slice(start, end))) continue;
      out += `${text.slice(last, start)}[REDACTED:${rule.kind}]`;
      last = end;
      count++;
    }
    if (last) text = out + text.slice(last);
  }
  return { text, count };
}

// How many secrets a stored file holds; binary and very large files are not scanned.
export function countSecrets(data: Uint8Array): number {
  if (data.byteLength > 2 * 1024 * 1024 || data.includes(0)) return 0;
  return redact(new TextDecoder().decode(data)).count;
}
