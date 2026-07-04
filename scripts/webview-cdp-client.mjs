/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: MIT
 */

const defaultRequestTimeoutMillis = Number.parseInt(
  process.env.SECPAL_WEBVIEW_CDP_REQUEST_TIMEOUT_MS ?? "10000",
  10
);

function timeoutMillis() {
  return Number.isFinite(defaultRequestTimeoutMillis) &&
    defaultRequestTimeoutMillis > 0
    ? defaultRequestTimeoutMillis
    : 10000;
}

function findTarget(list, targetPattern) {
  return list.find(
    (entry) => entry?.type === "page" && targetPattern.test(entry.url ?? "")
  );
}

async function openSocket(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out opening WebView CDP socket"));
    }, timeoutMillis());

    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener("open", handleOpen);
      ws.removeEventListener("error", handleError);
      ws.removeEventListener("close", handleClose);
    };
    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("WebView CDP socket failed before opening"));
    };
    const handleClose = () => {
      cleanup();
      reject(new Error("WebView CDP socket closed before opening"));
    };

    ws.addEventListener("open", handleOpen);
    ws.addEventListener("error", handleError);
    ws.addEventListener("close", handleClose);
  });

  return ws;
}

export async function connectToWebViewTarget({
  debuggerListUrl,
  targetPattern,
}) {
  const list = await fetch(debuggerListUrl).then((response) => response.json());
  const target = findTarget(list, targetPattern);

  if (!target?.webSocketDebuggerUrl) {
    throw new Error("No WebView target found");
  }

  const ws = await openSocket(target.webSocketDebuggerUrl);
  let nextId = 1;

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(`Timed out waiting for WebView CDP response: ${method}`)
        );
      }, timeoutMillis());

      const cleanup = () => {
        clearTimeout(timer);
        ws.removeEventListener("message", handleMessage);
        ws.removeEventListener("error", handleError);
        ws.removeEventListener("close", handleClose);
      };
      const handleMessage = (event) => {
        const payload = JSON.parse(event.data);

        if (payload.id !== id) {
          return;
        }

        cleanup();

        if (payload.error) {
          reject(new Error(payload.error.message || method));
          return;
        }

        resolve(payload.result);
      };
      const handleError = () => {
        cleanup();
        reject(
          new Error(`WebView CDP socket failed while waiting for ${method}`)
        );
      };
      const handleClose = () => {
        cleanup();
        reject(
          new Error(`WebView CDP socket closed while waiting for ${method}`)
        );
      };

      ws.addEventListener("message", handleMessage);
      ws.addEventListener("error", handleError);
      ws.addEventListener("close", handleClose);
      ws.send(JSON.stringify({ id, method, params }));
    });

  return {
    send,
    close: () => ws.close(),
  };
}

export function unwrapEvaluationResult(result, action) {
  if (result?.exceptionDetails) {
    const description =
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.text ??
      `CDP Runtime.evaluate failed for ${action}`;
    throw new Error(description);
  }

  return result?.result?.value;
}
