# Decisions

### D1 — Remove Intel macOS release target

Question: How should the macOS x64 release job be handled when its required
PyTorch dependency has no compatible wheel on the runner?

Decision: Remove macOS x64 from the automated desktop release. Keep macOS
ARM64, Windows x64, and Linux x64.

Impact: The release matrix, required artifact set, and active release
documentation will list three targets. The desktop app's runtime behavior on
the remaining targets does not change.

Confirmed by user: 2026-10-18
