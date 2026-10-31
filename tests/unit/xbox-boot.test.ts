// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { isSoftwareRenderer } from "../../src/client/render/capabilities";
import { hostBridgeAvailable, postHostDiagnostic, postHostMessage } from "../../src/client/startup/host-bridge";

function clearHosts(): void {
  const scope = window as unknown as Record<string, unknown>;
  delete scope.chrome;
  delete scope.external;
}

afterEach(clearHosts);

describe("software renderer detection", () => {
  it("flags software rasterizers", () => {
    expect(isSoftwareRenderer("Google Inc.", "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))")).toBe(true);
    expect(isSoftwareRenderer("Mesa/X.org", "llvmpipe (LLVM 15.0.6, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer("Microsoft", "WARP")).toBe(true);
  });

  it("keeps hardware renderers on the full profile", () => {
    expect(isSoftwareRenderer("NVIDIA Corporation", "NVIDIA GeForce RTX 4070")).toBe(false);
    expect(isSoftwareRenderer("Apple", "Apple M2 Pro")).toBe(false);
  });
});

describe("host bridge", () => {
  it("reports no host outside a webview", () => {
    expect(hostBridgeAvailable()).toBe(false);
    expect(postHostMessage("boot-ready")).toBe(false);
  });

  it("posts to the webview host", () => {
    const messages: string[] = [];
    (window as unknown as Record<string, unknown>).chrome = { webview: { postMessage: (message: string) => messages.push(message) } };
    expect(hostBridgeAvailable()).toBe(true);
    expect(postHostMessage("boot-ready")).toBe(true);
    expect(messages).toEqual(["boot-ready"]);
  });

  it("posts to the legacy external host", () => {
    const messages: string[] = [];
    (window as unknown as Record<string, unknown>).external = { notify: (message: string) => messages.push(message) };
    expect(postHostMessage("boot-ready")).toBe(true);
    expect(messages).toEqual(["boot-ready"]);
  });

  it("encodes diagnostics as a single host message", () => {
    const messages: string[] = [];
    (window as unknown as Record<string, unknown>).chrome = { webview: { postMessage: (message: string) => messages.push(message) } };
    postHostDiagnostic("hb", { drift: 12, fps: 58 });
    expect(messages).toEqual(['hb {"drift":12,"fps":58}']);
  });

  it("survives a throwing host", () => {
    (window as unknown as Record<string, unknown>).chrome = {
      webview: {
        postMessage: () => {
          throw new Error("host gone");
        },
      },
    };
    expect(postHostMessage("boot-ready")).toBe(false);
  });
});
