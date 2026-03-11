<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Android Enterprise Roadmap

This document defines the phased implementation path for Android enterprise capabilities.

## Scope

- DPC provisioning support
- Profile Owner mode support (BYOD/work profile)
- Device Owner mode support (fully managed devices)
- Managed restrictions and kiosk/lock task controls
- Controlled app allowlist/blocklist handling

## Phase 0 (Current Bootstrap)

- Capacitor foundation and Android repo setup
- Shared governance, quality gates, and preflight scripts aligned with SecPal standards
- Architecture boundaries documented for native enterprise features

## Phase 1 (Provisioning and Policy Baseline)

- Add native Android module for provisioning intent handling
- Implement policy synchronization boundary from API to local policy state
- Add minimum audit logging for enterprise policy changes

## Phase 2 (Profile Owner Features)

- Support work profile policy enforcement
- Implement app visibility restrictions where supported
- Add integration tests for profile owner policy mapping

## Phase 3 (Device Owner Features)

- Add lock task (kiosk) lifecycle controls
- Enforce app allowlist and disable non-approved apps where policy allows
- Validate behavior on managed devices with device-owner test plans

## Phase 4 (Hardening and Operations)

- Add telemetry and audit exports for policy events
- Add rollback and safe-mode behavior for broken policy payloads
- Complete release hardening and deployment runbooks

## Notes

- Android enterprise capabilities are implemented through native Android modules, with Capacitor as bridge.
- Keep API contract alignment in `contracts` before backend/frontend/android integration changes.
