# Decisions — Desktop shadcn and TanStack Query adoption

### D1 — Use cnfast for the shared class helper

Question: Which package should implement the shared Tailwind class helper?
Decision: Use `cnfast@0.2.0` for `cn`, and remove direct `clsx` and
`tailwind-merge` dependencies when no other source imports require them.
Impact: Changes the desktop dependency set and the implementation behind the
shared `cn` export; the production TypeScript build must verify compatibility
with existing Base UI component call sites.
Confirmed by user: 2026-10-12

### D2 — Raise desktop development minimum to Node.js 22

Question: How should the desktop support `cnfast@0.2.0`'s Node.js `>=22`
engine requirement while the repository declares Node.js `>=20`?
Decision: Raise the desktop development minimum to Node.js `>=22`.
Impact: Update the desktop package metadata and lockfile, plus the current
runtime requirements in `README.md`, `AGENTS.md`, the local desktop spec and
plan, and `docs/desktop-development.md`; Node.js 20 is no longer supported for
desktop development. Packaged end users do not need Node.js.
Confirmed by user: 2026-10-13
