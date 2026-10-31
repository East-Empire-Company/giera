import { describe, expect, it } from "vitest";
import { CONCIERGE_TOOLS } from "../../src/shared/concierge-tools";
import { createConciergeTools, type ConciergeHost, type ConciergePlayer } from "../../src/client/concierge/actions";
import { PlayerController } from "../../src/client/entities/player";

describe("concierge audio controls", () => {
  it("does not expose music track selection", () => {
    expect(CONCIERGE_TOOLS.map(({ name }) => name)).not.toContain("set_music_track");
  });
});

describe("concierge world cheats", () => {
  it("exposes bounded jump, flight, and house actions", () => {
    const names = CONCIERGE_TOOLS.map(({ name }) => name);
    expect(names).toEqual(expect.arrayContaining(["set_jump_height", "set_flight", "build_house"]));
  });
});

describe("concierge cheat actions", () => {
  const create = (splitScreen: boolean) => {
    const players = {
      ziemek: new PlayerController({ id: "p1", spawn: [0, 40, 0] }),
      gniewko: new PlayerController({ id: "p2", spawn: [5, 40, 0] }),
    };
    const host: ConciergeHost = {
      status: () => ({ started: true, splitScreen, volume: 0.8, coins: 0, tier: 1 }),
      setSplitScreen: () => {},
      setVolume: (level) => level,
      teleportToSpawn: () => {},
      reload: () => {},
      setJumpHeight: (player: ConciergePlayer, height) => players[player].setJumpHeight(height),
      setFlying: (player: ConciergePlayer, enabled) => players[player].setFlying(enabled),
      buildHouse: () => ({ blocks: 60, style: "wood" }),
    };
    return { players, tools: createConciergeTools(host) };
  };

  it("changes the named player's jump and flight state", async () => {
    const { players, tools } = create(true);
    await tools.set_jump_height({ player: "gniewko", height_blocks: 4 });
    await tools.set_flight({ player: "gniewko", enabled: true });

    expect(players.gniewko.jumpHeight).toBe(4);
    expect(players.gniewko.flying).toBe(true);
    expect(players.ziemek.flying).toBe(false);
  });

  it("asks which child should get a cheat in split screen", async () => {
    const { players, tools } = create(true);
    const response = await tools.set_flight({ enabled: true });

    expect(response).toContain("Ziemka");
    expect(players.gniewko.flying).toBe(false);
  });
});
