# secrets-stay-home

21s. The objection-killer, and the best standalone social clip of the set.

**Thesis:** an auto-syncing repo that pushes whatever your agent wrote is a
scary idea — until you see that the push is redacted and your own file isn't.

**Beats**

1. An agent debugs a 401 and writes `sidecar/debug.md`. `tail` shows it pasted
   the staging token in full.
2. The terminal hands off to two cards of the same file, side by side.
3. Left, "your file" at `sidecar/debug.md`: the key, in full, still readable —
   you keep working.
4. Right, "what you pushed" at `origin/main`: the same line flips to
   `[REDACTED:api-key]` with a green flare.
5. Handwritten aside: `--pii` covers names, emails and paths too.

**Editing:** the key, its redaction, the file body, and the swap frame
(`beats.redactAt`) are all in `timeline.ts`. `FileCard.tsx` renders one copy of
the note and is single-use.

**Note:** `SECRET` is a shaped-but-fake key. Keep it that way — it renders at
full size on screen.
