---
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
name: React Capacitor Rules
description: Applies React, TypeScript, and Capacitor bridge rules to source files.
applyTo: "src/**/*.ts,src/**/*.tsx,tests/**/*.ts,tests/**/*.tsx,vite.config.ts,vitest.config.ts,capacitor.config.ts"
---

# React Capacitor Rules

- Keep UI and domain logic in React/TypeScript. Keep Android enterprise implementation details behind explicit bridge boundaries.
- Preserve strict TypeScript and avoid `any` unless there is a documented interop boundary.
- Prefer functional components and named exports.
- Test user-visible behavior with Testing Library and verify bridge-facing behavior with focused unit tests/mocks.
- Apply the canonical proportional-evidence model: assert behavior at the
  contract boundary, use characterization or structural evidence for
  behavior-preserving work, and stop at the smallest non-redundant evidence set.
- Keep web code platform-agnostic where possible to preserve future iOS support.
- For bridge or listener fixes, assert both registration arguments and returned handle behavior, including cleanup via
  `remove()`.
- For async auth or bridge teardown, prove ordering with tests and prefer `finally` when cleanup must run after the
  awaited call settles.
- Preserve the single authoritative owner for each bridge, credential,
  runtime/tenant, and lifecycle invariant. Independent fail-closed checks remain
  valid at Android trust boundaries when they stay consistent with that owner.
- Prefer maintained Android/platform primitives for authentication and token
  handling, URL/URI parsing, canonicalization, cryptography, and lifecycle
  state. Keep justified Android domain policy custom, and use allowlists only
  for finite known sets.
- While SecPal is pre-`1.0.0`, prefer removing obsolete web, bridge, or
  wrapper compatibility shims unless a proven live caller still requires them.
