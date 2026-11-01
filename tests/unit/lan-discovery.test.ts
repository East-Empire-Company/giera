import { describe, expect, it, vi } from "vitest";
import {
  fetchLanServer,
  isPrivateIPv4,
  localIPv4Addresses,
  scanLanServers,
  subnetHostCandidates,
} from "../../src/client/net/discovery";

const VALID_SERVER = {
  host: "giera-host",
  ip: "192.168.1.10",
  port: 8080,
  rooms: [{ code: "DOM1", name: "Dom 1", players: 2, seed: 424242 }],
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubPeerConnection(address: string): void {
  class FakePeerConnection {
    onicecandidate: ((event: { candidate: { candidate: string } | null }) => void) | null = null;

    constructor(_options?: unknown) {}

    createDataChannel(_label?: string): void {}

    async createOffer(): Promise<unknown> {
      return { type: "offer", sdp: "" };
    }

    async setLocalDescription(_description?: unknown): Promise<void> {
      this.onicecandidate?.({
        candidate: { candidate: `candidate:1 1 udp 1 ${address} 5000 typ host` },
      });
      this.onicecandidate?.({ candidate: null });
    }

    close(): void {}
  }

  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
}
const createMockFetch = (payload: unknown, status = 200) => {
  const f = async () => jsonResponse(payload, status);
  (f as unknown as { preconnect(): Promise<void> }).preconnect = async () => {};
  return f as unknown as typeof fetch;
};

describe("fetchLanServer", () => {
  it("parses a valid payload", async () => {
    const requested: string[] = [];
    const mockFetch = async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return jsonResponse(VALID_SERVER);
    };
    (mockFetch as unknown as { preconnect(): Promise<void> }).preconnect = async () => {};
    const result = await fetchLanServer("192.168.1.10", 8080, {
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(requested).toEqual(["http://192.168.1.10:8080/lan/rooms"]);
    expect(result).toEqual(VALID_SERVER);
  });

  it("returns null for malformed JSON", async () => {
    const result = await fetchLanServer("192.168.1.10", 8080, {
      fetchImpl: createMockFetch("{not-json", 200),
    });

    expect(result).toBeNull();
  });

  it.each<[string, unknown]>([
    ["missing rooms", { host: "h", ip: "192.168.1.10", port: 8080 }],
    ["rooms is not an array", { host: "h", ip: "192.168.1.10", port: 8080, rooms: {} }],
    ["room entry misses code", { host: "h", ip: "192.168.1.10", port: 8080, rooms: [{ name: "x", players: 1, seed: 1 }] }],
    ["room entry misses seed", { host: "h", ip: "192.168.1.10", port: 8080, rooms: [{ code: "A", name: "x", players: 1 }] }],
    ["players is negative", { host: "h", ip: "192.168.1.10", port: 8080, rooms: [{ code: "A", name: "x", players: -1, seed: 1 }] }],
    ["players is not a number", { host: "h", ip: "192.168.1.10", port: 8080, rooms: [{ code: "A", name: "x", players: "2", seed: 1 }] }],
    ["host is not a string", { host: 7, ip: "192.168.1.10", port: 8080, rooms: [] }],
    ["ip is not a string", { host: "h", ip: null, port: 8080, rooms: [] }],
    ["port is not a number", { host: "h", ip: "192.168.1.10", port: "8080", rooms: [] }],
  ])("returns null for %s", async (_label, payload) => {
    const result = await fetchLanServer("192.168.1.10", 8080, {
      fetchImpl: createMockFetch(payload),
    });

    expect(result).toBeNull();
  });

  it("returns null for a non-OK status", async () => {
    const result = await fetchLanServer("192.168.1.10", 8080, {
      fetchImpl: createMockFetch(VALID_SERVER, 503),
    });

    expect(result).toBeNull();
  });

  it("returns null when fetch rejects", async () => {
    const throwingFetch = async () => {
      throw new Error("network down");
    };
    (throwingFetch as unknown as { preconnect(): Promise<void> }).preconnect = async () => {};
    const result = await fetchLanServer("192.168.1.10", 8080, {
      fetchImpl: throwingFetch as unknown as typeof fetch,
    });

    expect(result).toBeNull();
  });

  it("returns null for malformed JSON", async () => {
    const result = await fetchLanServer("192.168.1.10", 8080, {
      fetchImpl: async () => new Response("{not-json", { status: 200 }),
    });

    expect(result).toBeNull();
  });

  it.each<[string, unknown]>([
    ["missing rooms", { host: "h", ip: "192.168.1.10", port: 8080 }],
    ["rooms is not an array", { host: "h", ip: "192.168.1.10", port: 8080, rooms: {} }],
    ["room entry misses code", { host: "h", ip: "192.168.1.10", port: 8080, rooms: [{ name: "x", players: 1, seed: 1 }] }],
    ["room entry misses seed", { host: "h", ip: "192.168.1.10", port: 8080, rooms: [{ code: "A", name: "x", players: 1 }] }],
    ["players is negative", { host: "h", ip: "192.168.1.10", port: 8080, rooms: [{ code: "A", name: "x", players: -1, seed: 1 }] }],
    ["players is not a number", { host: "h", ip: "192.168.1.10", port: 8080, rooms: [{ code: "A", name: "x", players: "2", seed: 1 }] }],
    ["host is not a string", { host: 7, ip: "192.168.1.10", port: 8080, rooms: [] }],
    ["ip is not a string", { host: "h", ip: null, port: 8080, rooms: [] }],
    ["port is not a number", { host: "h", ip: "192.168.1.10", port: "8080", rooms: [] }],
  ])("returns null for %s", async (_label, payload) => {
    const result = await fetchLanServer("192.168.1.10", 8080, {
      fetchImpl: async () => jsonResponse(payload),
    });

    expect(result).toBeNull();
  });

  it("returns null for a non-OK status", async () => {
    const result = await fetchLanServer("192.168.1.10", 8080, {
      fetchImpl: async () => jsonResponse(VALID_SERVER, 503),
    });

    expect(result).toBeNull();
  });

  it("returns null when fetch rejects", async () => {
    const result = await fetchLanServer("192.168.1.10", 8080, {
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });

    expect(result).toBeNull();
  });

  it("returns null and aborts the request when the probe times out", async () => {
    let capturedSignal: AbortSignal | null | undefined;
    const result = await fetchLanServer("192.168.1.10", 8080, {
      timeoutMs: 20,
      fetchImpl: (_input, init) => {
        capturedSignal = init?.signal;
        const { promise } = Promise.withResolvers<Response>();
        return promise;
      },
    });

    expect(result).toBeNull();
    expect(capturedSignal?.aborted).toBe(true);
  });
});

describe("isPrivateIPv4", () => {
  it.each(["10.0.0.1", "10.255.255.254", "172.16.0.1", "172.31.255.254", "192.168.0.1", "192.168.255.254"])(
    "accepts %s",
    (ip) => {
      expect(isPrivateIPv4(ip)).toBe(true);
    },
  );

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.15.255.254",
    "172.32.0.1",
    "192.169.0.1",
    "11.0.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "10.0.0",
    "10.0.0.256",
    "10.0.0.01",
    "10.0.0.1.2",
    "10.0.0.-1",
    "not-an-ip",
    "",
  ])("rejects %s", (ip) => {
    expect(isPrivateIPv4(ip)).toBe(false);
  });
});

describe("subnetHostCandidates", () => {
  it("returns 254 hosts for a private /24 and excludes the source", () => {
    const hosts = subnetHostCandidates("192.168.1.42");

    expect(hosts).toHaveLength(254);
    expect(hosts).not.toContain("192.168.1.42");
    expect(hosts).toContain("192.168.1.1");
    expect(hosts).toContain("192.168.1.254");
    expect(hosts.every((host) => host.startsWith("192.168.1."))).toBe(true);
  });

  it("keeps 254 hosts for other private ranges", () => {
    expect(subnetHostCandidates("10.1.2.3")).toHaveLength(254);
    expect(subnetHostCandidates("172.16.5.6")).toHaveLength(254);
    expect(subnetHostCandidates("172.16.5.6").every((host) => host.startsWith("172.16.5."))).toBe(true);
  });

  it("returns an empty list for public or malformed input", () => {
    expect(subnetHostCandidates("8.8.8.8")).toEqual([]);
    expect(subnetHostCandidates("172.32.0.1")).toEqual([]);
    expect(subnetHostCandidates("192.169.0.1")).toEqual([]);
    expect(subnetHostCandidates("192.168.1")).toEqual([]);
    expect(subnetHostCandidates("not-an-ip")).toEqual([]);
  });
});

describe("localIPv4Addresses", () => {
  it("collects host candidates from ICE events", async () => {
    stubPeerConnection("192.168.1.7");
    try {
      expect(await localIPv4Addresses()).toEqual(["192.168.1.7"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resolves an empty list when ICE discovery is unavailable", async () => {
    expect(await localIPv4Addresses()).toEqual([]);
  });
});

describe("scanLanServers", () => {
  it("finds reachable servers and sorts them deterministically", async () => {
    const payloads: Record<string, unknown> = {
      "http://192.168.1.20:8080/lan/rooms": { host: "b", ip: "192.168.1.20", port: 8080, rooms: [] },
      "http://192.168.1.10:8080/lan/rooms": { host: "a", ip: "192.168.1.10", port: 8080, rooms: [] },
    };

    const f = async (input: RequestInfo | URL) => {
      const payload = payloads[String(input)];
      return payload ? jsonResponse(payload) : new Response("{}", { status: 404 });
    };
    (f as unknown as { preconnect(): Promise<void> }).preconnect = async () => {};
    const result = await scanLanServers({
      candidates: ["192.168.1.20", "192.168.1.10"],
      fetchImpl: f as unknown as typeof fetch,
    });

    expect(result.map((server) => server.ip)).toEqual(["192.168.1.10", "192.168.1.20"]);
  });

  it("dedupes identical ip and port pairs", async () => {
    const payload = { host: "a", ip: "192.168.1.10", port: 8080, rooms: [] };
    const result = await scanLanServers({
      candidates: ["192.168.1.10", "192.168.1.11"],
      fetchImpl: createMockFetch(payload),
    });

    expect(result).toHaveLength(1);
    expect(result[0].ip).toBe("192.168.1.10");
  });

  it("keeps the same ip on different ports", async () => {
    const f = async (input: RequestInfo | URL) => {
      const port = String(input).includes("192.168.1.10") ? 9090 : 8080;
      return jsonResponse({ host: "a", ip: "192.168.1.10", port, rooms: [] });
    };
    (f as unknown as { preconnect(): Promise<void> }).preconnect = async () => {};
    const result = await scanLanServers({
      candidates: ["192.168.1.10", "192.168.1.11"],
      fetchImpl: f as unknown as typeof fetch,
    });

    expect(result.map((server) => server.port)).toEqual([8080, 9090]);
  });

  it("returns an empty list when every probe fails", async () => {
    const f = async () => {
      throw new Error("offline");
    };
    (f as unknown as { preconnect(): Promise<void> }).preconnect = async () => {};
    const result = await scanLanServers({
      candidates: ["192.168.1.10"],
      fetchImpl: f as unknown as typeof fetch,
    });

    expect(result).toEqual([]);
  });

  it("never exceeds the requested concurrency", async () => {
    let active = 0;
    let peak = 0;
    const f = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return new Response("{}", { status: 404 });
    };
    (f as unknown as { preconnect(): Promise<void> }).preconnect = async () => {};
    const result = await scanLanServers({
      candidates: ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"],
      concurrency: 2,
      fetchImpl: f as unknown as typeof fetch,
    });

    expect(result).toEqual([]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(0);
  });

  it("stops probing once the abort signal fires", async () => {
    const controller = new AbortController();
    let calls = 0;
    const f = async () => {
      calls += 1;
      controller.abort();
      return new Response("{}", { status: 404 });
    };
    (f as unknown as { preconnect(): Promise<void> }).preconnect = async () => {};
    const result = await scanLanServers({
      candidates: ["10.0.0.1", "10.0.0.2"],
      signal: controller.signal,
      fetchImpl: f as unknown as typeof fetch,
    });

    expect(result).toEqual([]);
    expect(calls).toBe(1);
  });

  it("also probes the page hostname when it is an IPv4 literal", async () => {
    const probed: string[] = [];
    vi.stubGlobal("location", { hostname: "192.168.1.50" });
    try {
      const f = async (input: RequestInfo | URL) => {
        probed.push(String(input));
        return new Response("{}", { status: 404 });
      };
      (f as unknown as { preconnect(): Promise<void> }).preconnect = async () => {};
      await scanLanServers({
        candidates: ["192.168.1.10"],
        fetchImpl: f as unknown as typeof fetch,
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(probed).toEqual([
      "http://192.168.1.10:8080/lan/rooms",
      "http://192.168.1.50:8080/lan/rooms",
    ]);
  });

  it("sweeps the subnet of discovered local addresses when no candidates are given", async () => {
    const probed: string[] = [];
    stubPeerConnection("192.168.1.7");
    try {
      const f = async (input: RequestInfo | URL) => {
        probed.push(String(input));
        return new Response("{}", { status: 404 });
      };
      (f as unknown as { preconnect(): Promise<void> }).preconnect = async () => {};
      await scanLanServers({
        fetchImpl: f as unknown as typeof fetch,
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(probed).toHaveLength(254);
    expect(probed).toContain("http://192.168.1.1:8080/lan/rooms");
    expect(probed).not.toContain("http://192.168.1.7:8080/lan/rooms");
  });
});
