/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserProcessTimeoutMs,
  browserShutdownTimeoutMs,
  browserTestTimeoutMs,
  cleanupBrowserSmoke,
  closeServer,
  terminateBrowser,
  waitForBrowserClose,
  type BrowserExit,
  type BrowserProcess,
  type BrowserSmokeServer,
} from "./native-auth-bridge-csp-browser-lifecycle";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
};

const createBrowser = () => {
  const kill = vi.fn((signal: NodeJS.Signals): boolean => signal === "SIGKILL");
  const browser: BrowserProcess & { kill: typeof kill } = {
    exitCode: null,
    signalCode: null,
    kill,
  };

  return browser;
};

const createServer = (listening = true) => {
  let closeCallback: ((error?: Error) => void) | undefined;
  const close = vi.fn((callback: (error?: Error) => void): unknown => {
    closeCallback = callback;
    return undefined;
  });
  const closeAllConnections = vi.fn();
  const server: BrowserSmokeServer = {
    listening,
    close,
    closeAllConnections,
  };

  return {
    close,
    closeAllConnections,
    completeClose: (error?: Error) => closeCallback?.(error),
    server,
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("strict-CSP browser smoke lifecycle", () => {
  it("keeps process termination and cleanup inside the outer test deadline", () => {
    expect(browserProcessTimeoutMs + browserShutdownTimeoutMs).toBeLessThan(
      browserTestTimeoutMs
    );
  });

  it("returns a normal Chromium close without terminating it", async () => {
    const browser = createBrowser();
    const exit: BrowserExit = [0, null];

    await expect(
      waitForBrowserClose(browser, Promise.resolve(exit), 25)
    ).resolves.toEqual(exit);
    expect(browser.kill).not.toHaveBeenCalled();
  });

  it("terminates Chromium and rejects when the process deadline expires", async () => {
    vi.useFakeTimers();
    const browser = createBrowser();
    const browserClosed = deferred<BrowserExit>();
    const result = waitForBrowserClose(browser, browserClosed.promise, 25);
    const rejection = expect(result).rejects.toThrow(
      "Chromium did not exit within 25 ms and was terminated."
    );

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(browser.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  });

  it("terminates the browser and closes the server during assertion cleanup", async () => {
    const browser = createBrowser();
    const browserClosed = deferred<BrowserExit>();
    const { close, closeAllConnections, completeClose, server } =
      createServer();
    browser.kill.mockImplementation((signal) => {
      browser.signalCode = signal;
      browserClosed.resolve([null, signal]);
      return true;
    });

    const cleanup = cleanupBrowserSmoke(
      browser,
      browserClosed.promise,
      server,
      25
    );
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    completeClose();
    await cleanup;

    expect(browser.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(closeAllConnections).toHaveBeenCalledOnce();
  });

  it("does not terminate a browser that already closed successfully", async () => {
    const browser = createBrowser();
    browser.exitCode = 0;

    await terminateBrowser(browser, Promise.resolve([0, null]), 25);

    expect(browser.kill).not.toHaveBeenCalled();
  });

  it("bounds the wait for Chromium to acknowledge forced termination", async () => {
    vi.useFakeTimers();
    const browser = createBrowser();
    const browserClosed = deferred<BrowserExit>();
    const result = terminateBrowser(browser, browserClosed.promise, 25);
    const rejection = expect(result).rejects.toThrow(
      "Chromium did not close within 25 ms after SIGKILL."
    );

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(browser.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  });

  it("awaits server closure and drops active HTTP connections", async () => {
    const { close, closeAllConnections, completeClose, server } =
      createServer();
    let closed = false;
    const closing = closeServer(server).then(() => {
      closed = true;
    });

    await Promise.resolve();
    expect(closed).toBe(false);
    expect(close).toHaveBeenCalledOnce();
    expect(closeAllConnections).toHaveBeenCalledOnce();

    completeClose();
    await closing;
    expect(closed).toBe(true);
  });

  it("skips server closure when listening never started", async () => {
    const { close, closeAllConnections, server } = createServer(false);

    await closeServer(server);

    expect(close).not.toHaveBeenCalled();
    expect(closeAllConnections).not.toHaveBeenCalled();
  });

  it("propagates an HTTP server closure failure", async () => {
    const { closeAllConnections, completeClose, server } = createServer();
    const closing = closeServer(server);
    const rejection = expect(closing).rejects.toThrow("server close failed");

    completeClose(new Error("server close failed"));

    await rejection;
    expect(closeAllConnections).toHaveBeenCalledOnce();
  });

  it("closes the server even when forced browser shutdown fails", async () => {
    vi.useFakeTimers();
    const browser = createBrowser();
    const browserClosed = deferred<BrowserExit>();
    const { close, closeAllConnections, completeClose, server } =
      createServer();
    const result = cleanupBrowserSmoke(
      browser,
      browserClosed.promise,
      server,
      25
    );
    const rejection = expect(result).rejects.toThrow(
      "Chromium did not close within 25 ms after SIGKILL."
    );

    await vi.advanceTimersByTimeAsync(25);
    completeClose();

    await rejection;
    expect(close).toHaveBeenCalledOnce();
    expect(closeAllConnections).toHaveBeenCalledOnce();
  });
});
