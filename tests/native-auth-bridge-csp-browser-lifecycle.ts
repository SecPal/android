/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export const browserProcessTimeoutMs = 35_000;
export const browserShutdownTimeoutMs = 2_000;
export const browserServerShutdownTimeoutMs = 2_000;
export const browserTestTimeoutMs = 45_000;

export type BrowserExit = [
  exitCode: number | null,
  signal: NodeJS.Signals | null,
];

export interface BrowserProcess {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill(signal: NodeJS.Signals): boolean;
}

export interface BrowserSmokeServer {
  readonly listening: boolean;
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections(): void;
}

export const remainingBrowserProcessTimeout = (
  deadlineMs: number,
  nowMs = Date.now()
) => Math.max(0, deadlineMs - nowMs);

export const waitForServerListening = async (
  serverListening: Promise<unknown>,
  timeoutMs: number
) => {
  let setupTimeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      serverListening,
      new Promise<never>((_resolve, reject) => {
        setupTimeout = setTimeout(() => {
          reject(
            new Error(`HTTP server did not start within ${timeoutMs} ms.`)
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(setupTimeout);
  }
};

export const waitForBrowserClose = async (
  browser: BrowserProcess,
  browserClosed: Promise<BrowserExit>,
  timeoutMs = browserProcessTimeoutMs
) => {
  let processTimeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      browserClosed,
      new Promise<never>((_resolve, reject) => {
        processTimeout = setTimeout(() => {
          browser.kill("SIGKILL");
          reject(
            new Error(
              `Chromium did not exit within ${timeoutMs} ms and was terminated.`
            )
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(processTimeout);
  }
};

export const terminateBrowser = async (
  browser: BrowserProcess,
  browserClosed: Promise<BrowserExit>,
  timeoutMs = browserShutdownTimeoutMs
) => {
  if (browser.exitCode === null && browser.signalCode === null) {
    browser.kill("SIGKILL");
  }

  let shutdownTimeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      browserClosed,
      new Promise<never>((_resolve, reject) => {
        shutdownTimeout = setTimeout(() => {
          reject(
            new Error(
              `Chromium did not close within ${timeoutMs} ms after SIGKILL.`
            )
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(shutdownTimeout);
  }
};

export const closeServer = async (
  server: BrowserSmokeServer,
  timeoutMs = browserServerShutdownTimeoutMs
) => {
  if (!server.listening) {
    return;
  }

  let closeTimeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await new Promise<void>((resolve, reject) => {
      closeTimeout = setTimeout(() => {
        reject(new Error(`HTTP server did not close within ${timeoutMs} ms.`));
      }, timeoutMs);
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
      server.closeAllConnections();
    });
  } finally {
    clearTimeout(closeTimeout);
  }
};

export const cleanupBrowserSmoke = async (
  browser: BrowserProcess | undefined,
  browserClosed: Promise<BrowserExit> | undefined,
  server: BrowserSmokeServer,
  shutdownTimeoutMs = browserShutdownTimeoutMs,
  serverShutdownTimeoutMs = browserServerShutdownTimeoutMs
) => {
  try {
    if (browser && browserClosed) {
      await terminateBrowser(browser, browserClosed, shutdownTimeoutMs);
    }
  } finally {
    await closeServer(server, serverShutdownTimeoutMs);
  }
};
