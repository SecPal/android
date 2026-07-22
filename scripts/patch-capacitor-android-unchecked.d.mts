/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

export function patchCapacitorAndroidSource(
  source: string,
  expectedReplacements?: ReadonlyArray<readonly [string, string]>
): string;
export function patchCapacitorMessageHandlerSource(source: string): string;
export function patchCapacitorBridgeCleanupSource(source: string): string;
export function patchCapacitorLegacyInterfaceSource(
  source: string,
  interfaceName: string
): string;
export function patchCapacitorAndroidSources(repoRoot: string): void;
