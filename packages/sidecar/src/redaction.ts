export type RedactionMode = "none" | "secrets" | "secrets+pii";

// "secrets" over "secrets+pii": most false positives live in the PII rules,
// and a default should never be the mode most likely to mangle content.
export const DEFAULT_REDACTION_MODE: RedactionMode = "secrets";
export const REDACTION_MODES: readonly RedactionMode[] = ["none", "secrets", "secrets+pii"];

// Files carrying this marker near the top opt out of redaction entirely; the
// local original is committed as-is.
export const NO_REDACT_PRAGMA = "sidecar:no-redact";
// Deep enough to clear the preamble a file may be obliged to open with — a
// licence header, YAML front matter, an XML declaration, a shebang and module
// docstring — so the marker can go where a reader would put it rather than
// having to fight for line one. `split`'s limit stops the scan there, so the
// window costs nothing on a large file.
const PRAGMA_SCAN_LINES = 30;
// The marker has to start its own line, but anything punctuation-like may lead
// it: rather than enumerate comment syntaxes, allow a short run of non-word
// characters, which is every leader in practice (# // /* <!-- ; * -- % " ! '
// (* {- ::). Four is the width of `<!--`, the one that matters most here since
// the notes these files hold are usually Markdown.
//
// Punctuation only, and never a word: that is what keeps prose from disarming
// redaction by mentioning the marker. "see: sidecar:no-redact" and "the
// sidecar:no-redact marker" both open on word characters and so do not match.
// The asymmetry is deliberate — failing to recognise a marker only leaves
// redaction on, while matching one by accident commits secrets in the clear.
const NO_REDACT_PRAGMA_REGEX = new RegExp(
  String.raw`^\s*[^\w\s]{0,4}\s*${NO_REDACT_PRAGMA}\b`,
);

export function hasNoRedactPragma(text: string): boolean {
  return text
    .split(/\r\n|\r|\n/, PRAGMA_SCAN_LINES)
    .some((line) => NO_REDACT_PRAGMA_REGEX.test(line));
}

// Digit-leading keys (2FA_TOKEN) are as sensitive as any other.
const KEY_NAME_PATTERN = String.raw`[A-Za-z0-9_][A-Za-z0-9_-]*`;
// `key: "value"`, `key='value'`, and `"key": "value"` in one pattern: the key
// quote is optional (a word boundary otherwise), and the quoted value runs to
// the matching close quote, so it may contain spaces, the other quote char,
// and escapes.
const QUOTED_SECRET_REGEX = new RegExp(
  String.raw`(?:(?<keyQuote>["'])|\b)(?<key>${KEY_NAME_PATTERN})\k<keyQuote>` +
    // The escape branch is the only one that can consume a backslash, so the
    // alternation is unambiguous — an unterminated value can't trigger
    // exponential backtracking.
    String.raw`(?<separator>\s*[:=]\s*)(?<valueQuote>["'])(?:\\[^\r\n]|(?!\k<valueQuote>)[^\\\r\n])+\k<valueQuote>`,
  "g",
);

const BARE_ASSIGNMENT_SECRET_REGEX = new RegExp(
  String.raw`\b(${KEY_NAME_PATTERN})(\s*[:=]\s*)([^\s"',;` + "`" + String.raw`]+)`,
  "g",
);

const AUTHORIZATION_HEADER_REGEX = /\b(authorization\s*[:=]\s*(?:bearer|basic|token)\s+)([^\s"',;`]+)/gi;
const PEM_PRIVATE_KEY_REGEX =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g;
const URL_CREDENTIALS_REGEX = /(\/\/[^\s/:@"'`]+):([^\s/@"'`]+)@/g;
const BARE_BEARER_TOKEN_REGEX =
  /\b(Bearer\s+)(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Za-z0-9._~+/-]{20,})\b/g;

const TOKEN_PATTERNS: Array<[RegExp, string]> = [
  [/\bAKIA[0-9A-Z]{16}\b/g, "<API_KEY>"],
  [/\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, "<API_KEY>"],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "<API_KEY>"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, "<TOKEN>"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "<TOKEN>"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "<TOKEN>"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "<TOKEN>"],
];

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
// Requires phone-style separators so bare digit runs (IDs, counters) pass.
const PHONE_REGEX = /\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)\s?|\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
const CREDIT_CARD_CANDIDATE_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;

export function redactText(input: string, mode: RedactionMode = DEFAULT_REDACTION_MODE): string {
  if (mode === "none") return input;
  let output = input
    .replace(PEM_PRIVATE_KEY_REGEX, "<PRIVATEKEY>")
    .replace(AUTHORIZATION_HEADER_REGEX, (_match, prefix: string) => `${prefix}<TOKEN>`)
    .replace(BARE_BEARER_TOKEN_REGEX, (_match, prefix: string) => `${prefix}<TOKEN>`)
    .replace(URL_CREDENTIALS_REGEX, (_match, prefix: string) => `${prefix}:<SECRET>@`)
    .replace(QUOTED_SECRET_REGEX, (match, ...args) => {
      const { keyQuote = "", key, separator, valueQuote } = args.at(-1) as {
        keyQuote?: string;
        key: string;
        separator: string;
        valueQuote: string;
      };
      if (!isSensitiveKey(key)) return match;
      return `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${placeholderForKey(key)}${valueQuote}`;
    })
    .replace(
      BARE_ASSIGNMENT_SECRET_REGEX,
      (match, key: string, separator: string) =>
        isSensitiveKey(key) ? `${key}${separator}${placeholderForKey(key)}` : match,
    );

  for (const [pattern, replacement] of TOKEN_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  if (mode === "secrets") return output;

  return output
    .replace(EMAIL_REGEX, "<EMAIL>")
    .replace(PHONE_REGEX, "<PHONENUMBER>")
    .replace(SSN_REGEX, "<SSN>")
    .replace(CREDIT_CARD_CANDIDATE_REGEX, (candidate) =>
      isLikelyCreditCard(candidate) ? "<CREDITCARD>" : candidate,
    );
}

const PLACEHOLDER_REGEX = /<(?:API_KEY|TOKEN|SECRET|PRIVATEKEY|EMAIL|PHONENUMBER|SSN|CREDITCARD)>/g;

export function countRedactionPlaceholders(text: string): number {
  return text.match(PLACEHOLDER_REGEX)?.length ?? 0;
}

function placeholderForKey(key: string): string {
  if (/api[_-]?key/i.test(key)) return "<API_KEY>";
  if (/password|passwd|pwd|passphrase|secret|private/i.test(key)) return "<SECRET>";
  return "<TOKEN>";
}

const COMPACT_SENSITIVE_KEYS = new Set([
  "apikey",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authtoken",
  "githubtoken",
  "bearertoken",
  "clientsecret",
  "credential",
  "credentials",
  "secretkey",
  "privatekey",
  "password",
  "passwd",
  "pwd",
  "passphrase",
  "token",
  "secret",
]);

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/-/g, "_");
  const lower = normalized.toLowerCase();
  const compact = lower.replace(/_/g, "");
  if (COMPACT_SENSITIVE_KEYS.has(compact)) return true;

  const parts = normalized
    .toUpperCase()
    .split("_")
    .filter(Boolean);
  const last = parts.at(-1);
  if (["PASSWORD", "PASSWD", "PWD", "PASSPHRASE", "TOKEN", "SECRET"].includes(last ?? "")) {
    return true;
  }
  if (parts.includes("API") && parts.includes("KEY")) return true;
  if (parts.includes("ACCESS") && parts.includes("TOKEN")) return true;
  if (parts.includes("REFRESH") && parts.includes("TOKEN")) return true;
  if (parts.includes("SECRET") && (parts.includes("KEY") || parts.includes("ACCESS"))) return true;
  if (parts.includes("PRIVATE") && parts.includes("KEY")) return true;

  return false;
}

function isLikelyCreditCard(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  // A separator-free digit run is only treated as a card at the two dominant
  // card lengths; anything else is far more likely an ID or hash.
  if (!/[ -]/.test(value) && digits.length !== 15 && digits.length !== 16) return false;

  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }

  return sum % 10 === 0;
}
