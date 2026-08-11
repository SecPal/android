/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { spawn } from "node:child_process";

interface ChromiumBrowserSmokeOptions {
  chromiumPath: string;
  arguments: string[];
  timeoutMilliseconds?: number;
}

interface ChromiumBrowserSmokeResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

const outputDrainMilliseconds = 100;
const defaultTimeoutMilliseconds = 60_000;
const diagnosticCharacterLimit = 4_000;

function formatTimeoutDiagnostics(stderr: string, stdout: string): string {
  const diagnostics = [stderr.trim(), stdout.trim()]
    .filter((output) => output.length > 0)
    .join("\n")
    .slice(-diagnosticCharacterLimit);
  return diagnostics.length > 0 ? `\n${diagnostics}` : "";
}

export function runChromiumBrowserSmoke({
  chromiumPath,
  arguments: browserArguments,
  timeoutMilliseconds = defaultTimeoutMilliseconds,
}: ChromiumBrowserSmokeOptions): Promise<ChromiumBrowserSmokeResult> {
  return new Promise((resolve, reject) => {
    const browser = spawn(chromiumPath, browserArguments, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let stderr = "";
    let stdout = "";

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      browser.stdout.destroy();
      browser.stderr.destroy();
      callback();
    };

    browser.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    browser.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      browser.kill("SIGKILL");
      settle(() => {
        reject(
          new Error(
            `Chromium browser smoke timed out after ${timeoutMilliseconds} ms.${formatTimeoutDiagnostics(stderr, stdout)}`
          )
        );
      });
    }, timeoutMilliseconds);

    browser.once("error", (error) => {
      settle(() => reject(error));
    });
    browser.once("exit", (status) => {
      clearTimeout(timeout);
      setTimeout(() => {
        settle(() => resolve({ status, stderr, stdout }));
      }, outputDrainMilliseconds);
    });
  });
}
