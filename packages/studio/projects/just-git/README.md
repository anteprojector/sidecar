# just-git

21s. For the skeptic who assumes lock-in.

**Thesis:** the scratchpad is a normal git repo you own. If you already know
git, you already know how to inspect, extend, and debug sidecar.

**Beats**

1. `cd sidecar && git log --oneline` — real commits, including the inbox
   merges. The sidecar CLI does not appear again after this line.
2. A browser slides in on `github.com/you/your-notes`: it's just a repo, on a
   host, with a file listing.
3. `grep -rl` finds notes by content; `git blame` attributes lines to the
   machine that wrote them.
4. Handwritten aside: clone it, hook it, build on it.

**Editing:** commands, the commit log, the browser's file rows, and captions
are all in `timeline.ts`. `Browser.tsx` is a deliberate sketch — enough chrome
to read as "a repo on a host" and no more — and is single-use.
