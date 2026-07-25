# Editor search visibility

Because `sidecar/` is gitignored, editors that respect git ignore rules hide it
from file search. `sidecar init` offers to add `sidecar/**` to
`file_scan_inclusions` in `.zed/settings.json` so Zed keeps the files
searchable; commit that file to share it with your team.

VS Code and Cursor have no per-path override. If you want sidecar files
searchable there, set `"search.useIgnoreFiles": false` in
`.vscode/settings.json` — note this makes search ignore *all* git ignore rules,
relying on `search.exclude` patterns instead.
