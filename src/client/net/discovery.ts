import {
  DEFAULT_LAN_PORT,
  type LanRoomSummary,
  type LanServerSummary,
} from "../../shared/lan-protocol";

const DEFAULT_TIMEOUT_MS = 900;
const DEFAULT_CONCURRENCY = 32;
const LOCAL_IP_TIMEOUT_MS = 1200;
const LAN_ROOMS_PATH = "/lan/rooms";

type FetchLike = ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) & { preconnect?: (url: string | URL, options?: { dns?: boolean; tcp?: boolean; http?: boolean; https?: boolean }) => void };

export type FetchLanServerOptions = {
  timeoutMs?: number;
  fetchImpl?: FetchLike;
};

export type ScanLanServersOptions = {
  candidates?: string[];
  port?: number;
  timeoutMs?: number;
  concurrency?: number;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
};

const defaultFetch: FetchLike = globalThis.fetch;

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(timeoutMs, 2_147_483_647);
}

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part[0] === "0") return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function isPrivateOctets(octets: number[]): boolean {
  const [first, second] = octets;
  if (first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return false;
}

export function isPrivateIPv4(ip: string): boolean {
  const octets = parseIPv4(ip);
  if (!octets) return false;
  return isPrivateOctets(octets);
}

export function subnetHostCandidates(ip: string): string[] {
  const octets = parseIPv4(ip);
  if (!octets || !isPrivateOctets(octets)) return [];
  const prefix = `${octets[0]}.${octets[1]}.${octets[2]}`;
  const sourceLast = octets[3];
  const hosts: string[] = [];
  for (let last = 0; last <= 254; last++) {
    if (last === sourceLast) continue;
    if (sourceLast === 255 && last === 0) continue;
    hosts.push(`${prefix}.${last}`);
  }
  return hosts;
}

function isLanRoomSummary(value: unknown): value is LanRoomSummary {
  if (typeof value !== "object" || value === null) return false;
  if (!("code" in value) || !("name" in value) || !("players" in value) || !("seed" in value)) return false;
  if (typeof value.code !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (typeof value.players !== "number" || !Number.isFinite(value.players) || value.players < 0) return false;
  if (typeof value.seed !== "number" || !Number.isInteger(value.seed)) return false;
  return true;
}

function isLanServerSummary(value: unknown): value is LanServerSummary {
  if (typeof value !== "object" || value === null) return false;
  if (!("host" in value) || !("ip" in value) || !("port" in value) || !("rooms" in value)) return false;
  if (typeof value.host !== "string") return false;
  if (typeof value.ip !== "string") return false;
  if (typeof value.port !== "number" || !Number.isInteger(value.port) || value.port < 0 || value.port > 65535) return false;
  if (!Array.isArray(value.rooms)) return false;
  return value.rooms.every(isLanRoomSummary);
}

async function probeLanServer(
  ip: string,
  port: number,
  timeoutMs: number,
  fetchImpl: FetchLike,
  externalSignal?: AbortSignal,
): Promise<LanServerSummary | null> {
  const host = typeof ip === "string" ? ip.trim() : "";
  if (host.length === 0) return null;
  if (!Number.isInteger(port) || port < 0 || port > 65535) return null;
  if (externalSignal?.aborted) return null;

  const controller = new AbortController();
  const abort = () => controller.abort();

  try {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    timeoutSignal.addEventListener("abort", abort, { once: true });
    externalSignal?.addEventListener("abort", abort, { once: true });

    const { promise: timeout, resolve: resolveTimeout } = Promise.withResolvers<null>();
    timeoutSignal.addEventListener("abort", () => resolveTimeout(null), { once: true });
    const request = (async (): Promise<LanServerSummary | null> => {
      try {
        const response = await fetchImpl(`http://${host}:${port}${LAN_ROOMS_PATH}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) return null;
        const payload: unknown = await response.json();
        return isLanServerSummary(payload) ? payload : null;
      } catch {
        return null;
      }
    })();
    return await Promise.race([request, timeout]);
  } catch {
    return null;
  } finally {
    externalSignal?.removeEventListener("abort", abort);
  }
}

export async function fetchLanServer(
  ip: string,
  port: number,
  options?: FetchLanServerOptions,
): Promise<LanServerSummary | null> {
  return probeLanServer(
    ip,
    port,
    normalizeTimeout(options?.timeoutMs),
    options?.fetchImpl ?? defaultFetch,
  );
}

function candidateAddress(candidate: string): string | null {
  const parts = candidate.trim().split(/\s+/);
  if (parts.length < 6) return null;
  const address = parts[4];
  return parseIPv4(address) ? address : null;
}

export async function localIPv4Addresses(): Promise<string[]> {
  const found = new Set<string>();
  const peerConnectionGlobal: { RTCPeerConnection?: typeof RTCPeerConnection } = globalThis;
  const PeerConnectionCtor = peerConnectionGlobal.RTCPeerConnection;
  let connection: RTCPeerConnection | null = null;
  try {
    if (!PeerConnectionCtor) return [];
    const peer = new PeerConnectionCtor({ iceServers: [] });
    connection = peer;
    const { promise: gathered, resolve: resolveGathered } = Promise.withResolvers<void>();
    peer.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (!event.candidate) {
        resolveGathered();
        return;
      }
      const address = candidateAddress(event.candidate.candidate);
      if (address) found.add(address);
    };

    peer.createDataChannel("lan-probe");
    await peer.setLocalDescription(await peer.createOffer());

    const deadline = AbortSignal.timeout(LOCAL_IP_TIMEOUT_MS);
    const { promise: timeout, resolve: resolveTimeout } = Promise.withResolvers<void>();
    deadline.addEventListener("abort", () => resolveTimeout(), { once: true });
    await Promise.race([gathered, timeout]);
  } catch {
    return [...found];
  } finally {
    try {
      connection?.close();
    } catch {}
  }
  return [...found];
}

function pageHostname(): string | null {
  const locationGlobal: { location?: { hostname?: unknown } } = globalThis;
  const hostname = locationGlobal.location?.hostname;
  return typeof hostname === "string" && hostname.length > 0 ? hostname : null;
}

async function collectCandidates(provided: string[] | undefined): Promise<string[]> {
  const hosts: string[] = [];
  if (Array.isArray(provided)) {
    for (const candidate of provided) {
      if (typeof candidate === "string" && candidate.trim().length > 0) hosts.push(candidate.trim());
    }
  } else {
    for (const ip of await localIPv4Addresses()) hosts.push(...subnetHostCandidates(ip));
  }
  const hostname = pageHostname();
  if (hostname && parseIPv4(hostname)) hosts.push(hostname);
  return [...new Set(hosts)];
}

export async function scanLanServers(options?: ScanLanServersOptions): Promise<LanServerSummary[]> {
  try {
    const signal = options?.signal;
    if (signal?.aborted) return [];

    const port = options?.port ?? DEFAULT_LAN_PORT;
    const timeoutMs = normalizeTimeout(options?.timeoutMs);
    const fetchImpl = options?.fetchImpl ?? defaultFetch;
    const candidates = await collectCandidates(options?.candidates);
    if (candidates.length === 0) return [];

    const requested = options?.concurrency;
    const concurrency = Math.min(
      typeof requested === "number" && Number.isFinite(requested) && requested >= 1
        ? Math.floor(requested)
        : DEFAULT_CONCURRENCY,
      candidates.length,
    );
    const found: LanServerSummary[] = [];
    const seen = new Set<string>();
    let cursor = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (signal?.aborted) return;
        const index = cursor++;
        if (index >= candidates.length) return;
        const summary = await probeLanServer(candidates[index], port, timeoutMs, fetchImpl, signal);
        if (!summary) continue;
        const key = `${summary.ip}:${summary.port}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(summary);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
    found.sort((left, right) => (left.ip !== right.ip ? (left.ip < right.ip ? -1 : 1) : left.port - right.port));
    return found;
  } catch {
    return [];
  }
}
