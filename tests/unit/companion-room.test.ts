import { describe, expect, it } from "vitest";
import { RoomState } from "../../server/room";
import { createRoomRegistry, createWsConnection, handleWsClose, handleWsMessage, type WsDeps, type WsSocket } from "../../server/ws-handler";
import { BLOCK_ID } from "../../src/shared/blocks";
import { generateBlock } from "../../src/shared/worldgen";
import { tycoonSlotOrigin } from "../../src/shared/tycoon-slots";

type Msg = Record<string, unknown>;
type BlockRef = { x: number; y: number; z: number; id: number };

type Harness = {
  deps: WsDeps;
  published: { topic: string; msg: Msg }[];
  clock: { now: number };
  connect(id: string): WsSocket & { sent: (string | Uint8Array)[]; subscriptions: string[] };
  room(code: string): RoomState;
};

const harness = (): Harness => {
  const clock = { now: 1_000_000 };
  const published: { topic: string; msg: Msg }[] = [];
  const rooms = createRoomRegistry(64, (code) => new RoomState(code, 777));
  const deps: WsDeps = {
    rooms,
    publish: (topic, payload) => published.push({ topic, msg: JSON.parse(payload) as Msg }),
    now: () => clock.now,
  };
  return {
    deps,
    published,
    clock,
    connect(id) {
      const sent: (string | Uint8Array)[] = [];
      const subscriptions: string[] = [];
      return {
        data: createWsConnection(id, clock.now),
        send: (p) => sent.push(p),
        subscribe: (t) => subscriptions.push(t),
        sent,
        subscriptions,
      };
    },
    room: (code) => rooms.get(code)!,
  };
};

const send = (ws: WsSocket, deps: WsDeps, msg: unknown) => handleWsMessage(ws, JSON.stringify(msg), deps);
const clear = (h: Harness) => {
  h.published.length = 0;
};

const join = (h: Harness, id: string, opts: { host?: boolean; seed?: number; roomName?: string } = {}) => {
  const ws = h.connect(id);
  const hello: Record<string, unknown> = { t: "hello", name: `Gracz-${id}`, room: "DOM1" };
  if (opts.host) hello.host = true;
  if (opts.seed !== undefined) hello.seed = opts.seed;
  if (opts.roomName !== undefined) hello.roomName = opts.roomName;
  send(ws, h.deps, hello);
  clear(h);
  return ws;
};

const pose = (ws: WsSocket & { sent: unknown[] }, h: Harness, x: number, y: number, z: number) => {
  h.clock.now += 2_000;
  send(ws, h.deps, { t: "input", seq: 1, x, y, z, yaw: 0, pitch: 0, anim: "idle" });
  clear(h);
};

const firstSent = (ws: WsSocket & { sent: unknown[] }): Msg => JSON.parse(ws.sent[0] as string) as Msg;
const lastSent = (ws: WsSocket & { sent: unknown[] }): Msg => JSON.parse(ws.sent[ws.sent.length - 1] as string) as Msg;
const findSent = (ws: WsSocket & { sent: unknown[] }, t: string): Msg[] =>
  ws.sent.map((p) => JSON.parse(p as string) as Msg).filter((m) => m.t === t);
const publishedOf = (h: Harness, t: string): Msg[] => h.published.filter((p) => p.msg.t === t).map((p) => p.msg);

describe("RoomState world parity", () => {
  it("getWorldBlock returns existing edits including air, otherwise generates from the seed", () => {
    const room = new RoomState("DOM1", 777);
    room.setBlock(3, 45, 4, BLOCK_ID.air);
    expect(room.getWorldBlock(3, 45, 4)).toBe(BLOCK_ID.air);
    expect(room.getWorldBlock(5, 50, 6)).toBe(generateBlock(5, 50, 6, 777));
    expect(room.getBlock(5, 50, 6)).toBeUndefined();
  });
});

describe("companion authority", () => {
  it("makes the first hello the owner and never lets later host claims steal it", () => {
    const h = harness();
    const owner = join(h, "p1", { host: true, seed: 42, roomName: "Baza" });
    const late = join(h, "p2", { host: true, seed: 99, roomName: "Kradziez" });

    expect(firstSent(owner)).toMatchObject({ ownerId: "p1", companion: null, generation: 0, buildPreview: null });
    expect(firstSent(late)).toMatchObject({ ownerId: "p1", seed: 42, roomName: "Baza" });
    expect(h.room("DOM1").getOwnerId()).toBe("p1");
    expect(h.room("DOM1").seed).toBe(42);
  });

  it("rejects companion spawn from non-owners and duplicate spawns", () => {
    const h = harness();
    const owner = join(h, "p1");
    const other = join(h, "p2");
    pose(owner, h, 10, 50, 10);

    send(other, h.deps, { t: "companion_spawn", profile: "staszek" });
    expect(lastSent(other)).toMatchObject({ t: "companion_error" });
    expect(publishedOf(h, "companion_state")).toHaveLength(0);

    send(owner, h.deps, { t: "companion_spawn", profile: "staszek" });
    const states = publishedOf(h, "companion_state");
    expect(states).toHaveLength(1);
    const companion = states[0].companion as { id: string; profile: string; anim: string; x: number };
    expect(companion.profile).toBe("staszek");
    expect(companion.anim).toBe("idle");
    expect(Math.abs(companion.x - 10)).toBeLessThanOrEqual(5);
    expect(h.room("DOM1").getGeneration()).toBe(1);

    clear(h);
    send(owner, h.deps, { t: "companion_spawn", profile: "mina" });
    expect(lastSent(owner)).toMatchObject({ t: "companion_error" });
    expect(publishedOf(h, "companion_state")).toHaveLength(0);
  });

  it("rejects spawn when the owner has never sent a valid position", () => {
    const h = harness();
    const owner = join(h, "p1");
    send(owner, h.deps, { t: "companion_spawn", profile: "mina" });
    expect(lastSent(owner)).toMatchObject({ t: "companion_error" });
    expect(h.room("DOM1").getCompanion()).toBeNull();
  });

  it("accepts only owner state updates with a matching id, valid motion, and animation", () => {
    const h = harness();
    const owner = join(h, "p1");
    join(h, "p2");
    pose(owner, h, 10, 50, 10);
    send(owner, h.deps, { t: "companion_spawn", profile: "staszek" });
    const id = h.room("DOM1").getCompanion()!.id;
    clear(h);

    send(owner, h.deps, { t: "companion_state", companion: { id: "forged", profile: "staszek", x: 12, y: 50, z: 10, yaw: 0, anim: "walk" } });
    expect(lastSent(owner)).toMatchObject({ t: "companion_error" });

    h.clock.now += 500;
    send(owner, h.deps, { t: "companion_state", companion: { id, profile: "staszek", x: 10, y: 500, z: 10, yaw: 0, anim: "walk" } });
    expect(lastSent(owner)).toMatchObject({ t: "companion_error" });

    h.clock.now += 500;
    send(owner, h.deps, { t: "companion_state", companion: { id, profile: "staszek", x: 11.5, y: 50, z: 10, yaw: 1, anim: "fly" } });
    expect(lastSent(owner)).toMatchObject({ t: "companion_error" });

    h.clock.now += 500;
    send(owner, h.deps, { t: "companion_state", companion: { id, profile: "staszek", x: 11.5, y: 50, z: 10, yaw: 1, anim: "walk" } });
    const states = publishedOf(h, "companion_state");
    expect(states).toHaveLength(1);
    expect(states[0].companion).toMatchObject({ id, x: 11.5, anim: "walk" });

    clear(h);
    send(owner, h.deps, { t: "companion_remove", id });
    expect(publishedOf(h, "companion_remove")).toEqual([{ t: "companion_remove", id }]);
    expect(h.room("DOM1").getCompanion()).toBeNull();
  });

  it("accepts generation-matched commands from joined players and rejects stale ones", () => {
    const h = harness();
    const owner = join(h, "p1");
    const other = join(h, "p2");
    pose(owner, h, 10, 50, 10);
    send(owner, h.deps, { t: "companion_spawn", profile: "staszek" });
    clear(h);

    send(other, h.deps, { t: "companion_command", task: "follow", expectedGeneration: 99 });
    expect(lastSent(other)).toMatchObject({ t: "companion_error" });
    expect(h.room("DOM1").getGeneration()).toBe(1);

    send(other, h.deps, { t: "companion_command", task: "follow", expectedGeneration: 1 });
    const commands = publishedOf(h, "companion_command");
    expect(commands).toEqual([{ t: "companion_command", task: "follow", by: "p2", generation: 2 }]);
    expect(h.room("DOM1").getGeneration()).toBe(2);
  });

  it("accepts a direct stop from any joined player regardless of generation and cancels reservations", () => {
    const h = harness();
    const owner = join(h, "p1");
    const other = join(h, "p2");
    pose(owner, h, -10, 50, -10);
    send(owner, h.deps, { t: "companion_spawn", profile: "staszek" });
    pose(other, h, -10, 50, -10);
    send(other, h.deps, { t: "build_preview", requestId: "r1", expectedGeneration: 1 });
    const preview = publishedOf(h, "build_preview")[0];
    send(other, h.deps, { t: "build_confirm", planId: preview.planId });
    expect(h.room("DOM1").getBuildPreview()?.reserved).toBe(true);
    clear(h);

    send(other, h.deps, { t: "companion_stop" });
    const commands = publishedOf(h, "companion_command");
    expect(commands[commands.length - 1]).toMatchObject({ t: "companion_command", task: "stop", by: "p2" });
    expect(h.room("DOM1").getBuildPreview()).toBeNull();
    expect(h.room("DOM1").getGeneration()).toBe(4);
  });

  it("removes the companion, cancels reservations, and transfers ownership when the owner disconnects", () => {
    const h = harness();
    const owner = join(h, "p1");
    const other = join(h, "p2");
    const newest = join(h, "p3");
    pose(owner, h, -10, 50, -10);
    send(owner, h.deps, { t: "companion_spawn", profile: "staszek" });
    pose(other, h, -10, 50, -10);
    send(other, h.deps, { t: "build_preview", requestId: "r1", expectedGeneration: 1 });
    clear(h);

    handleWsClose(owner, h.deps);
    expect(publishedOf(h, "companion_remove")).toHaveLength(1);
    const changed = publishedOf(h, "owner_changed");
    expect(changed).toEqual([{ t: "owner_changed", ownerId: "p2" }]);
    expect(h.room("DOM1").getBuildPreview()).toBeNull();
    expect(h.room("DOM1").getOwnerId()).toBe("p2");

    clear(h);
    const reconnected = h.connect("p9");
    send(reconnected, h.deps, { t: "hello", name: "Powrot", room: "DOM1", host: true, seed: 5 });
    expect(firstSent(reconnected)).toMatchObject({ ownerId: "p2", seed: 777 });
    void newest;
  });

  it("subscribes before sending the welcome snapshot and publishes the join", () => {
    const h = harness();
    const owner = join(h, "p1");
    pose(owner, h, 10, 50, 10);
    send(owner, h.deps, { t: "companion_spawn", profile: "staszek" });
    clear(h);

    const ws = h.connect("p2");
    send(ws, h.deps, { t: "hello", name: "Gniewko", room: "DOM1" });
    expect(ws.subscriptions).toEqual(["room:DOM1"]);
    const welcome = firstSent(ws);
    expect((welcome.companion as { id: string }).id).toBe(h.room("DOM1").getCompanion()!.id);
    expect(welcome.ownerId).toBe("p1");
    expect(typeof welcome.generation).toBe("number");
  });
});

describe("room sync paging", () => {
  it("pages preexisting edits after the welcome and waits for acknowledgements", () => {
    const h = harness();
    const room = h.deps.rooms.getOrCreate("DOM1")!;
    for (let i = 0; i < 300; i++) room.setBlock(i % 8, 50 + Math.floor(i / 8), Math.floor(i / 3), i % 4 === 0 ? BLOCK_ID.stone : BLOCK_ID.dirt);
    const joiner = h.connect("p1");
    send(joiner, h.deps, { t: "hello", name: "Z", room: "DOM1" });

    const messages = joiner.sent.map((p) => JSON.parse(p as string));
    const begin = messages.find((m) => m.t === "room_sync_begin");
    const pages = messages.filter((m) => m.t === "room_sync_page");
    expect(begin).toBeDefined();
    expect(pages).toHaveLength(1);
    expect(pages[0].edits.length).toBeLessThanOrEqual(256);
    expect(pages[0].index).toBe(0);
    expect(joiner.sent.filter((p) => (p as string).includes("room_sync_end"))).toHaveLength(0);
    expect(messages[0].t).toBe("welcome");

    const initialPages = findSent(joiner, "room_sync_page").length;
    send(joiner, h.deps, { t: "room_sync_ack", syncId: begin.syncId, index: 0 });
    const second = findSent(joiner, "room_sync_page");
    expect(second).toHaveLength(initialPages + 1);
    expect(second[1].index).toBe(1);
    expect((second[1].edits as unknown[]).length).toBe(300 - 256);

    send(joiner, h.deps, { t: "room_sync_ack", syncId: begin.syncId, index: 1 });
    expect(findSent(joiner, "room_sync_end")).toHaveLength(1);
  });

  it("ignores stale or duplicate acknowledgements and restarts on room_sync_start", () => {
    const h = harness();
    const room = h.deps.rooms.getOrCreate("DOM1")!;
    for (let i = 0; i < 10; i++) room.setBlock(i, 50, 0, BLOCK_ID.stone);
    const joiner = join(h, "p1");
    const begin = findSent(joiner, "room_sync_begin")[0];
    expect(findSent(joiner, "room_sync_page")).toHaveLength(1);

    clear(h);
    joiner.sent.length = 0;
    send(joiner, h.deps, { t: "room_sync_ack", syncId: "wrong", index: 0 });
    send(joiner, h.deps, { t: "room_sync_ack", syncId: begin.syncId, index: 5 });
    expect(h.published).toHaveLength(0);
    expect(findSent(joiner, "room_sync_page")).toHaveLength(0);

    send(joiner, h.deps, { t: "room_sync_ack", syncId: begin.syncId, index: 0 });
    send(joiner, h.deps, { t: "room_sync_ack", syncId: begin.syncId, index: 0 });
    expect(findSent(joiner, "room_sync_end")).toHaveLength(1);

    const rejoined = h.connect("p2");
    send(rejoined, h.deps, { t: "hello", name: "G", room: "DOM1" });
    const begin2 = findSent(rejoined, "room_sync_begin")[0];
    clear(h);
    send(rejoined, h.deps, { t: "room_sync_start" });
    expect(findSent(rejoined, "room_sync_begin").length).toBeGreaterThanOrEqual(1);
    void begin2;
  });

  it("expires a sync session that stops progressing and supports abort", () => {
    const h = harness();
    const room = h.deps.rooms.getOrCreate("DOM1")!;
    for (let i = 0; i < 300; i++) room.setBlock(i % 8, 50 + Math.floor(i / 8), Math.floor(i / 3), BLOCK_ID.stone);
    const joiner = join(h, "p1");
    const begin = findSent(joiner, "room_sync_begin")[0];
    joiner.sent.length = 0;

    h.clock.now += 10_500;
    send(joiner, h.deps, { t: "room_sync_ack", syncId: begin.syncId, index: 0 });
    expect(findSent(joiner, "room_sync_page")).toHaveLength(0);

    const aborter = join(h, "p3");
    const abortSyncId = findSent(aborter, "room_sync_begin")[0].syncId;
    send(aborter, h.deps, { t: "room_sync_abort", syncId: abortSyncId });
    aborter.sent.length = 0;
    send(aborter, h.deps, { t: "room_sync_ack", syncId: abortSyncId, index: 0 });
    expect(findSent(aborter, "room_sync_page")).toHaveLength(0);
  });
});

describe("cooperative construction", () => {
  const setup = () => {
    const h = harness();
    const owner = join(h, "p1");
    const builder = join(h, "p2");
    pose(owner, h, 30, 50, 27);
    send(owner, h.deps, { t: "companion_spawn", profile: "staszek" });
    const companionId = h.room("DOM1").getCompanion()!.id;
    send(builder, h.deps, { t: "input", seq: 1, x: 30, y: 50, z: 35, yaw: 0, pitch: 0, anim: "idle" });
    clear(h);
    return { h, owner, builder, companionId };
  };

  it("generates a preview from the requester pose, requires requester confirmation, and reserves", () => {
    const { h, owner, builder } = setup();
    send(builder, h.deps, { t: "build_preview", requestId: "r1", expectedGeneration: 1 });
    const previews = publishedOf(h, "build_preview");
    expect(previews).toHaveLength(1);
    const preview = previews[0];
    expect(preview.requestId).toBe("r1");
    expect((preview.blocks as BlockRef[]).length).toBeGreaterThan(0);
    expect((preview.blocks as BlockRef[]).length).toBeLessThanOrEqual(150);
    expect(Math.abs((preview.blocks as BlockRef[])[0].x - 30)).toBeLessThanOrEqual(12);
    expect(h.room("DOM1").getBuildPreview()).toMatchObject({ planId: preview.planId, requestedBy: "p2", reserved: false });

    send(owner, h.deps, { t: "build_confirm", planId: preview.planId });
    expect(lastSent(owner)).toMatchObject({ t: "companion_error" });
    expect(h.room("DOM1").getBuildPreview()?.reserved).toBe(false);

    send(builder, h.deps, { t: "build_confirm", planId: preview.planId });
    expect(publishedOf(h, "build_reserved")).toHaveLength(1);
    expect(h.room("DOM1").getBuildPreview()?.reserved).toBe(true);
  });

  it("supersedes an earlier preview with a new one", () => {
    const { h, builder } = setup();
    send(builder, h.deps, { t: "build_preview", requestId: "r1", expectedGeneration: 1 });
    const first = publishedOf(h, "build_preview")[0];
    clear(h);
    send(builder, h.deps, { t: "build_preview", requestId: "r2", expectedGeneration: 2 });
    expect(publishedOf(h, "build_cancelled")).toEqual([{ t: "build_cancelled", planId: first.planId, reason: "superseded" }]);
    expect(h.room("DOM1").getBuildPreview()?.planId).not.toBe(first.planId);
  });

  it("places reserved blocks only through the owner companion within reach and broadcasts one block edit", () => {
    const { h, owner, builder, companionId } = setup();
    send(builder, h.deps, { t: "build_preview", requestId: "r1", expectedGeneration: 1 });
    const preview = publishedOf(h, "build_preview")[0];
    send(builder, h.deps, { t: "build_confirm", planId: preview.planId });
    const companion = h.room("DOM1").getCompanion()!;
    const blockList = preview.blocks as BlockRef[];
    const far = blockList.find((b) => Math.hypot(b.x - companion.x, b.y - companion.y, b.z - companion.z) > 8);
    const near = blockList.find((b) => Math.hypot(b.x - companion.x, b.y - companion.y, b.z - companion.z) <= 8);
    expect(near).toBeDefined();
    if (!near) return;
    clear(h);

    send(builder, h.deps, { t: "companion_place", id: companionId, planId: preview.planId, blockIndex: blockList.indexOf(near) });
    expect(lastSent(builder)).toMatchObject({ t: "companion_error" });

    if (far) {
      send(owner, h.deps, { t: "companion_place", id: companionId, planId: preview.planId, blockIndex: blockList.indexOf(far) });
      expect(lastSent(owner)).toMatchObject({ t: "companion_error" });
    }

    h.clock.now += 500;
    send(owner, h.deps, { t: "companion_state", companion: { ...companion, x: near.x + 1, y: near.y, z: near.z + 1, yaw: 0, anim: "idle" } });
    clear(h);
    send(owner, h.deps, { t: "companion_place", id: companionId, planId: preview.planId, blockIndex: blockList.indexOf(near) });
    const blocks = publishedOf(h, "block");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ x: near.x, y: near.y, z: near.z, id: near.id, by: companionId });
    expect(h.room("DOM1").getWorldBlock(near.x, near.y, near.z)).toBe(near.id);

    clear(h);
    send(owner, h.deps, { t: "companion_place", id: companionId, planId: preview.planId, blockIndex: blockList.indexOf(near) });
    expect(lastSent(owner)).toMatchObject({ t: "companion_error" });
    expect(publishedOf(h, "block")).toHaveLength(0);
  });

  it("cancels the reservation when a human edits a remaining reserved cell and never reverts the edit", () => {
    const { h, builder, owner } = setup();
    send(builder, h.deps, { t: "build_preview", requestId: "r1", expectedGeneration: 1 });
    const preview = publishedOf(h, "build_preview")[0];
    send(builder, h.deps, { t: "build_confirm", planId: preview.planId });
    clear(h);

    send(owner, h.deps, { t: "block", x: (preview.blocks as BlockRef[])[1].x, y: (preview.blocks as BlockRef[])[1].y, z: (preview.blocks as BlockRef[])[1].z, id: BLOCK_ID.stone });
    expect(h.room("DOM1").getWorldBlock((preview.blocks as BlockRef[])[1].x, (preview.blocks as BlockRef[])[1].y, (preview.blocks as BlockRef[])[1].z)).toBe(BLOCK_ID.stone);
    expect(publishedOf(h, "build_cancelled")[0]).toMatchObject({ planId: preview.planId });
    expect(h.room("DOM1").getBuildPreview()).toBeNull();
  });

  it("rejects previews inside protected tycoon plots or near the training dummy", () => {
    const slot = tycoonSlotOrigin(0);
    const { h, owner } = setup();
    pose(owner, h, slot.x + 2, 50, slot.z + 2);
    send(owner, h.deps, { t: "build_preview", requestId: "rz", expectedGeneration: 1 });
    expect(lastSent(owner)).toMatchObject({ t: "companion_error" });

    pose(owner, h, 2, 50, 4);
    send(owner, h.deps, { t: "build_preview", requestId: "rd", expectedGeneration: 1 });
    expect(lastSent(owner)).toMatchObject({ t: "companion_error" });
  });
});
