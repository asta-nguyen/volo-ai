# Decisions — Desktop shadcn and TanStack Query adoption

### D1 — Use cnfast for the shared class helper

Question: Which package should implement the shared Tailwind class helper?
Decision: Use `cnfast@0.2.0` for `cn`, and remove direct `clsx` and
`tailwind-merge` dependencies when no other source imports require them.
Impact: Changes the desktop dependency set and the implementation behind the
shared `cn` export; the production TypeScript build must verify compatibility
with existing Base UI component call sites.
Confirmed by user: 2026-10-12
