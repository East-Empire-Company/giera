type WebViewHost = { postMessage: (message: string) => void };
type ExternalHost = { notify: (message: string) => void };

function webviewHost(): WebViewHost | null {
  const host = (window as unknown as { chrome?: { webview?: WebViewHost } }).chrome?.webview;
  return host && typeof host.postMessage === "function" ? host : null;
}

function externalHost(): ExternalHost | null {
  const host = (window as unknown as { external?: ExternalHost }).external;
  return host && typeof host.notify === "function" ? host : null;
}

export function hostBridgeAvailable(): boolean {
  return webviewHost() !== null || externalHost() !== null;
}

export function postHostMessage(message: string): boolean {
  try {
    const webview = webviewHost();
    if (webview) {
      webview.postMessage(message);
      return true;
    }
    const external = externalHost();
    if (external) {
      external.notify(message);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function postHostDiagnostic(kind: string, payload: Record<string, unknown>): boolean {
  return postHostMessage(`${kind} ${JSON.stringify(payload)}`);
}
