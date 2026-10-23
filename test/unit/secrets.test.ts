import { describe, expect, test } from "bun:test";
import { countSecrets, redact } from "../../src/core/secrets";

const masked = (text: string) => redact(text).text;

describe("redact masks credentials", () => {
  test.each([
    ["DB_PASSWORD=supersecret123", "DB_PASSWORD=[REDACTED:env-secret]"],
    ["export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "export AWS_SECRET_ACCESS_KEY=[REDACTED:env-secret]"],
    ["AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE", "AWS_ACCESS_KEY_ID=[REDACTED:aws-access-key]"],
    [`token ghp_${"a".repeat(36)} end`, "token [REDACTED:github-token] end"],
    ["postgres://app:s3cr3t@db.local:5432/prod", "postgres://app:[REDACTED:url-password]@db.local:5432/prod"],
    ["https://user:ghtoken123@github.com/x.git", "https://user:[REDACTED:url-password]@github.com/x.git"],
    ['{"password": "hunter22", "user": "bob"}', '{"password": "[REDACTED:config-secret]", "user": "bob"}'],
    ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456", "Authorization: Bearer [REDACTED:bearer-token]"],
    ["-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----", "[REDACTED:private-key]"],
    [`key sk-ant-api03-${"x".repeat(40)}`, "key [REDACTED:anthropic-key]"],
    [`stripe sk_live_${"a1".repeat(12)}`, "stripe [REDACTED:stripe-key]"],
    ['{"accessToken": "abc123def456", "tokenType": "Bearer"}', '{"accessToken": "[REDACTED:config-secret]", "tokenType": "Bearer"}'],
    ["const clientSecret = 's3cr3t-value'", "const clientSecret = '[REDACTED:config-secret]'"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", "[REDACTED:jwt]"],
  ])("%s", (input, expected) => {
    expect(masked(input)).toBe(expected);
  });

  test("counts every secret it hides", () => {
    expect(redact("A_TOKEN=abcdefgh and DB_PASSWORD=12345678xyz").count).toBe(2);
  });
});

describe("redact leaves ordinary code alone", () => {
  test.each([
    "interface User { password: string; token?: string }",
    "const apiKey = process.env.API_KEY",
    "TOKEN_TTL=3600 and PASSWORD_MIN_LENGTH=12",
    "API_KEY=$API_KEY and SECRET=${SECRET}",
    "http://localhost:3000/api and user@example.com",
    "git@github.com:acme/api.git",
    '{"maxTokens": "1000", "tokenType": "Bearer"}',
    'placeholder: "Enter your password"',
  ])("%s", (input) => {
    expect(redact(input)).toEqual({ text: input, count: 0 });
  });
});

test("countSecrets skips binary and very large files", () => {
  expect(countSecrets(new TextEncoder().encode("DB_PASSWORD=supersecret123\n"))).toBe(1);
  expect(countSecrets(new Uint8Array([0, 1, 2]))).toBe(0);
  expect(countSecrets(new TextEncoder().encode(`DB_PASSWORD=supersecret123\n${"x".repeat(3 * 1024 * 1024)}`))).toBe(0);
});
