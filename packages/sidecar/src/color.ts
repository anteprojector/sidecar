/**
 * The five roles that carry meaning in sidecar's output.
 *
 * The scheme is deliberately stingy: labels and "nothing here" values recede to
 * dim, plain facts stay in the terminal's own foreground, and a hue only appears
 * where it carries meaning. Two of them are identity rather than state — purple
 * is your repo, the brand yellow is the sidecar (its path and its remote) — which
 * leaves green, red, and bolded yellow to mean "this needs you".
 *
 * `brand` and `attn` share the brand yellow because the palette only has one
 * yellow; `attn` is bolded so it still separates from the always-yellow path.
 */
export type Role = "label" | "quiet" | "repo" | "brand" | "attn" | "ok" | "bad";

type Level = 0 | 1 | 2 | 3; // none | 16-color | 256-color | truecolor

const BRAND = { r: 0xff, g: 0xc6, b: 0x1e }; // --accent, the favicon's yellow
const BRAND_256 = 214;
// A mid violet rather than a light one: it has to clear 4:1 on both a black and
// a white terminal, which the pastel purples (#a78bfa and friends) do not.
const REPO = { r: 0x8b, g: 0x5c, b: 0xf6 };
const REPO_256 = 99;

/**
 * Whether to emit escape codes at all, and at what fidelity.
 *
 * Piped output is plain — `sidecar status | grep dirty` should never see escapes
 * — which also means the test suite and the daemon's log files stay clean without
 * anything opting out.
 */
export function colorLevel(stream: { isTTY?: boolean } = process.stdout): Level {
  const env = process.env;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return 0;
  if (env.FORCE_COLOR === "0" || env.CLICOLOR === "0") return 0;

  const forced =
    (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "") ||
    (env.CLICOLOR_FORCE !== undefined && env.CLICOLOR_FORCE !== "0");
  if (!forced) {
    if (env.TERM === "dumb") return 0;
    if (!stream.isTTY) return 0;
  }

  const term = env.TERM ?? "";
  const colorterm = env.COLORTERM ?? "";
  if (/truecolor|24bit/i.test(colorterm)) return 3;
  if (/-256(color)?$/i.test(term) || term === "xterm-kitty" || colorterm !== "") return 2;
  return 1;
}

function code(role: Role, level: Level): string | undefined {
  switch (role) {
    case "label":
    case "quiet":
      return "2"; // dim
    case "ok":
      return "32";
    case "bad":
      return "31";
    case "repo":
      if (level === 3) return `38;2;${REPO.r};${REPO.g};${REPO.b}`;
      if (level === 2) return `38;5;${REPO_256}`;
      return "35"; // magenta
    case "brand":
    case "attn": {
      const bold = role === "attn" ? "1;" : "";
      if (level === 3) return `${bold}38;2;${BRAND.r};${BRAND.g};${BRAND.b}`;
      if (level === 2) return `${bold}38;5;${BRAND_256}`;
      return `${bold}33`;
    }
  }
}

/** Wrap `text` in the escape codes for `role`, or return it untouched. */
export function paint(role: Role, text: string, level = colorLevel()): string {
  if (level === 0 || text === "") return text;
  const sgr = code(role, level);
  return sgr ? `\x1b[${sgr}m${text}\x1b[0m` : text;
}

/** Strip every SGR sequence — for tests and for measuring printed width. */
export function stripColor(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
