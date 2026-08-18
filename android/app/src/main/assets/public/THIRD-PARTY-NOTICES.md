<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Third-Party Notices

## shadcn registry source

The files below contain copied or adapted source from the
[shadcn registry](https://ui.shadcn.com). The registry is distributed under
the MIT License:

```text
SPDX-FileCopyrightText: 2023 shadcn
SPDX-License-Identifier: MIT
```

The complete MIT license text is included at [LICENSES/MIT.txt](LICENSES/MIT.txt).
This notice is the human-readable provenance record for the listed source
files. `REUSE.toml` aggregates the upstream MIT copyright and license metadata
with the SecPal SPDX metadata already present in those files. Release builds
include this notice and the complete MIT license text.

### Compared registry revisions

- The shared UI migration merged in frontend commit
  [`03768a6`](https://github.com/SecPal/frontend/commit/03768a65bb3b232c18d35929b67fadd7341480d1)
  on 2026-06-12. Its shadcn `new-york` registry baseline was compared with
  [`shadcn-ui/ui@ea9d371a2dda3365a382ff361f96b55daeeab88d`](https://github.com/shadcn-ui/ui/tree/ea9d371a2dda3365a382ff361f96b55daeeab88d).
- The sidebar-07 migration merged in frontend commit
  [`8d11b33`](https://github.com/SecPal/frontend/commit/8d11b336c1c813f1f65519f83602b4889b16fd68)
  on 2026-07-02. Its `new-york-v4` registry and `sidebar-07` block baselines
  were compared with
  [`shadcn-ui/ui@a409271270ad3a5d121e21f037c28bfaff912fc7`](https://github.com/shadcn-ui/ui/tree/a409271270ad3a5d121e21f037c28bfaff912fc7).

The migration commits did not record a registry commit ID at import time. The
snapshots above are the latest upstream revisions immediately preceding each
migration, and comparison of their structure, exports, Radix composition, and
class variants identified the following adapted files.

### Adapted files

- `src/lib/utils.ts`
- `src/ui/alert.tsx`
- `src/ui/alert-dialog.tsx`
- `src/ui/avatar.tsx`
- `src/ui/breadcrumb.tsx`
- `src/ui/button.tsx`
- `src/ui/card.tsx`
- `src/ui/checkbox.tsx`
- `src/ui/collapsible.tsx`
- `src/ui/dropdown-menu.tsx`
- `src/ui/input.tsx`
- `src/ui/select.tsx`
- `src/ui/separator.tsx`
- `src/ui/sheet.tsx`
- `src/ui/sidebar.tsx`
- `src/ui/skeleton.tsx`
- `src/ui/switch.tsx`
- `src/ui/textarea.tsx`
- `src/ui/tooltip.tsx`
- `src/ui/primitives.tsx`
- `src/ui/styles.ts`
- `src/ui/auth.tsx`
- `src/ui/onboarding.tsx`
- `src/components/app-sidebar.tsx`
- `src/components/nav-main.tsx`
- `src/components/nav-user.tsx`
- `src/components/team-switcher.tsx`

The route-local primitive layers from the original migration were removed in
frontend commit `101ccc3`; no remaining route-local primitive source requires
a separate notice.

## NPM dependency inventory

NPM packages are third-party software distinct from copied source. The exact,
resolved inventory of direct and transitive packages is maintained in
[package-lock.json](package-lock.json); its license metadata is checked for
AGPL compatibility by
[scripts/check-license-compatibility.sh](scripts/check-license-compatibility.sh).
Every release build also emits that inventory as
`dist/dependencies.spdx.json` in SPDX 2.3 format.

This inventory includes build dependencies such as `tailwindcss` and
`@tailwindcss/vite`, as well as runtime dependencies such as React, Base UI,
and Lucide. Their package licenses remain independent from the shadcn copied-
source provenance recorded above.

## Audit status (2026-07-11)

- `reuse lint` passes. The repository uses only `AGPL-3.0-or-later`,
  `CC0-1.0`, and `MIT` in its REUSE metadata; each has a corresponding text in
  `LICENSES/`.
- The Lingui catalogs and compiled messages contain SecPal translation content.
  Their checked-in `.license` sidecars therefore remain the authority for
  their SecPal licensing. The obsolete `CC0-1.0` Lingui annotations were
  removed from `REUSE.toml` so generated output is not misclassified as
  third-party or public-domain source.
- The audit identified the shadcn material listed above as copied or adapted
  third-party source. Its upstream copyright and MIT license remain aggregated
  in `REUSE.toml` and preserved in release artifacts; its notice was not
  replaced with `SecPal Contributors`.
- `package-lock.json` contains license declarations for every resolved npm
  package and the compatibility check accepts the current license set. The
  SBOM is an inventory, not a replacement for required package notices.
- Tailwind is used only as an npm dependency and styling tool; the audit found
  no Tailwind-derived source, so no Tailwind-specific license terms apply.

A production-build inspection confirmed that `@fontsource/inter` webfonts
licensed under `OFL-1.1` are distributed, while the artifact currently ships
only the shadcn MIT text. Release artifacts therefore still need a complete
dependency-notice bundle for the packages actually bundled, including the
Inter copyright and OFL text and any package-specific notices. That focused
distribution remediation is tracked in [#1367](https://github.com/SecPal/frontend/issues/1367).
