import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanClient } from "../../src/client/net/client";
import { encodeBinaryChunkFrame } from "../../src/shared/lan-protocol";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  binaryType = "blob";
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  emit(data: unknown): void {
    this.onmessage?.({ data });
  }

  parsedSent(): Record<string, unknown>[] {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }
}

const makeClient = (callbacks: ConstructorParameters<typeof LanClient>[0]["callbacks"]) =>
  new LanClient({ url: "ws://127.0.0.1:8080/ws", room: "DOM1", playerName: "Ziemek", callbacks });

describe("LanClient", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("announces connecting, then connected, and greets the room", () => {
    const statuses: string[] = [];
    const client = makeClient({ onStatusChange: (s) => statuses.push(s) });

    client.connect();
    expect(statuses).toEqual(["connecting"]);

    FakeWebSocket.instances[0].open();
    expect(statuses).toEqual(["connecting", "connected"]);
    expect(FakeWebSocket.instances[0].parsedSent()[0]).toEqual({
      t: "hello",
      name: "Ziemek",
      room: "DOM1",
    });
  });

  it("includes host, roomName, and seed in hello when hosting", () => {
    const client = new LanClient({
      url: "ws://127.0.0.1:8080/ws",
      room: "DOM1",
      playerName: "Ziemek",
      host: true,
      roomName: "Dom",
      seed: 424242,
      callbacks: {},
    });
    client.connect();
    FakeWebSocket.instances[0].open();
    expect(FakeWebSocket.instances[0].parsedSent()[0]).toEqual({
      t: "hello",
      name: "Ziemek",
      room: "DOM1",
      host: true,
      roomName: "Dom",
      seed: 424242,
    });
  });

  it("drops outgoing messages while the socket is not open", () => {
    const client = makeClient({});

    client.connect();
    client.sendBlockEdit(1, 2, 3, 9);
    client.requestChunk(0, 0, 0);

    expect(FakeWebSocket.instances[0].sent).toEqual([]);
  });

  it("numbers input frames sequentially", () => {
    const client = makeClient({});
    client.connect();
    FakeWebSocket.instances[0].open();

    client.sendInput({ x: 1.5, y: 20, z: -3 }, 0.25, -0.5, "walk");
    client.sendInput({ x: 2.5, y: 20, z: -3 }, 0.25, -0.5, "walk");

    const sent = FakeWebSocket.instances[0].parsedSent();
    expect(sent[1]).toEqual({
      t: "input",
      seq: 1,
      x: 1.5,
      y: 20,
      z: -3,
      yaw: 0.25,
      pitch: -0.5,
      anim: "walk",
    });
    expect(sent[2].seq).toBe(2);
  });

  it("sends block edits and chunk requests", () => {
    const client = makeClient({});
    client.connect();
    FakeWebSocket.instances[0].open();

    client.sendBlockEdit(4, 5, 6, 9);
    client.requestChunk(-1, 0, 2);

    const sent = FakeWebSocket.instances[0].parsedSent();
    expect(sent[1]).toEqual({ t: "block", x: 4, y: 5, z: 6, id: 9 });
    expect(sent[2]).toEqual({ t: "need", cx: -1, cy: 0, cz: 2 });
  });

  it("routes server messages to the matching callback", () => {
    const welcome = vi.fn();
    const block = vi.fn();
    const player = vi.fn();
    const join = vi.fn();
    const leave = vi.fn();
    const client = makeClient({ onWelcome: welcome, onBlock: block, onPlayer: player, onJoin: join, onLeave: leave });
    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    socket.emit(JSON.stringify({ t: "welcome", id: "p1", seed: 7, spawn: [0, 50, 0], players: [] }));
    socket.emit(JSON.stringify({ t: "block", x: 1, y: 2, z: 3, id: 4, by: "p2" }));
    socket.emit(JSON.stringify({ t: "player", id: "p2", name: "Gniewko", x: 1, y: 2, z: 3, yaw: 0, pitch: 0, anim: "idle" }));
    socket.emit(JSON.stringify({ t: "join", id: "p2", name: "Gniewko" }));
    socket.emit(JSON.stringify({ t: "leave", id: "p2" }));

    expect(welcome).toHaveBeenCalledTimes(1);
    expect(welcome.mock.calls[0][0].seed).toBe(7);
    expect(block.mock.calls[0][0].id).toBe(4);
    expect(player.mock.calls[0][0].name).toBe("Gniewko");
    expect(join.mock.calls[0][0].name).toBe("Gniewko");
    expect(leave.mock.calls[0][0].id).toBe("p2");
  });

  it("survives malformed server payloads", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = makeClient({});
    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    expect(() => socket.emit("{not json")).not.toThrow();
    expect(errors).toHaveBeenCalledWith("Failed to parse server message:", expect.anything());
  });

  it("decodes binary chunk frames", () => {
    const onChunk = vi.fn();
    const client = makeClient({ onChunk });
    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    const frame = encodeBinaryChunkFrame([{ cx: 1, cy: 0, cz: 2, rleData: new Uint8Array([4, 7]) }]);
    socket.emit(frame.buffer.slice(0));

    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk.mock.calls[0][0].cx).toBe(1);
    expect(onChunk.mock.calls[0][0].cz).toBe(2);
  });

  it("logs and ignores undecodable binary frames", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = makeClient({});
    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    socket.emit(new Uint8Array([9, 9, 9, 9]).buffer);

    expect(errors).toHaveBeenCalledWith("Failed to decode binary chunk frame:", expect.anything());
  });

  it("reconnects after an unexpected drop", () => {
    const statuses: string[] = [];
    const client = makeClient({ onStatusChange: (s) => statuses.push(s) });
    client.connect();
    FakeWebSocket.instances[0].open();

    FakeWebSocket.instances[0].onclose?.();
    expect(statuses).toEqual(["connecting", "connected", "disconnected"]);

    vi.advanceTimersByTime(2000);
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  it("stays closed after an explicit disconnect", () => {
    const statuses: string[] = [];
    const client = makeClient({ onStatusChange: (s) => statuses.push(s) });
    client.connect();
    FakeWebSocket.instances[0].open();

    client.disconnect();
    vi.advanceTimersByTime(10000);

    expect(FakeWebSocket.instances.length).toBe(1);
    expect(statuses).toEqual(["connecting", "connected", "disconnected"]);
  });

  it("cancels a pending reconnect when disconnect runs during the backoff window", () => {
    const client = makeClient({});
    client.connect();
    FakeWebSocket.instances[0].open();

    FakeWebSocket.instances[0].onclose?.();
    client.disconnect();
    vi.advanceTimersByTime(10000);

    expect(FakeWebSocket.instances.length).toBe(1);
  });
});
