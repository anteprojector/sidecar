const CREDENTIAL_KEY_PATTERN =
  String.raw`(?:openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|aws[_-]?secret[_-]?access[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|github[_-]?token|bearer[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key|password|passwd|pwd|passphrase|token|secret)`;

const QUOTED_KEY_SECRET_REGEX = new RegExp(
  String.raw`(["'])(${CREDENTIAL_KEY_PATTERN})\1(\s*:\s*)(["'])([^"'\r\n]+)(\4)`,
  "gi",
);

const ASSIGNMENT_SECRET_REGEX = new RegExp(
  String.raw`\b(${CREDENTIAL_KEY_PATTERN})(\s*[:=]\s*)(["']?)([^\s"',;` + "`" + String.raw`]+)(\3)`,
  "gi",
);

const AUTHORIZATION_HEADER_REGEX = /\b(authorization\s*:\s*bearer\s+)([^\s"',;`]+)/gi;
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
const PHONE_REGEX = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
const CREDIT_CARD_CANDIDATE_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;

export function redactText(input: string): string {
  let output = input
    .replace(AUTHORIZATION_HEADER_REGEX, (_match, prefix: string) => `${prefix}<TOKEN>`)
    .replace(BARE_BEARER_TOKEN_REGEX, (_match, prefix: string) => `${prefix}<TOKEN>`)
    .replace(
      QUOTED_KEY_SECRET_REGEX,
      (
        _match,
        keyQuote: string,
        key: string,
        separator: string,
        valueQuote: string,
        _value: string,
      ) => `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${placeholderForKey(key)}${valueQuote}`,
    )
    .replace(
      ASSIGNMENT_SECRET_REGEX,
      (_match, key: string, separator: string, quote: string) =>
        `${key}${separator}${quote}${placeholderForKey(key)}${quote}`,
    );

  for (const [pattern, replacement] of TOKEN_PATTERNS) {
    output = output.replace(pattern, replacement);
  }

  return output
    .replace(EMAIL_REGEX, "<EMAIL>")
    .replace(PHONE_REGEX, "<PHONENUMBER>")
    .replace(SSN_REGEX, "<SSN>")
    .replace(CREDIT_CARD_CANDIDATE_REGEX, (candidate) =>
      isLikelyCreditCard(candidate) ? "<CREDITCARD>" : candidate,
    );
}

function placeholderForKey(key: string): string {
  if (/api[_-]?key/i.test(key)) return "<API_KEY>";
  if (/password|passwd|pwd|passphrase|secret|private/i.test(key)) return "<SECRET>";
  return "<TOKEN>";
}

function isLikelyCreditCard(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;

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
