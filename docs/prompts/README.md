# Phase prompts

Give one prompt at a time to a coding agent working in `fenwira_v2/`, in order. Each prompt assumes that `AGENTS.md` has been read and every earlier phase is ✅ in `docs/ROADMAP.md`.

Every prompt starts from the same preamble:

> You are working on Fenwira v2, a new application built from scratch in this repository. Read `AGENTS.md` and the docs listed below before writing code. Do not reference, copy from or port any other Fenwira repository. If something is unspecified, stop and ask rather than invent architecture.

Every prompt ends with the same exit rule:

> When done, run `pnpm lint && pnpm typecheck && pnpm test`, then `docker compose up -d` from a clean state, and confirm every service is healthy. Report each acceptance criterion as pass/fail with evidence. Mark the phase ✅ in `docs/ROADMAP.md` only if all pass.
