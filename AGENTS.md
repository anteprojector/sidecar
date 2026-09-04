# Agent Instructions

Be aggressive with rewrites when they make the system simpler or more coherent.

Do not add backwards compatibility unless explicitly instructed.

Do not run integration tests unless explicitly requested by the user.

Some user-facing copy is baked into images (`site/assets/og.png`). After
changing the install command, tagline, or palette, re-render the generated
assets — see `.claude/skills/refresh-brand-assets/SKILL.md`.
