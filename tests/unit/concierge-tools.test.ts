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
    expect(names).toEqual(expect.arrayContaining(["set_jump_height", "set_flight", "build_house", "buy_expansion"]));
  });
});
describe("Iskra world editing tools", () => {
  it("offers fixed mine bounds and safe target selection", () => {
    const mine = CONCIERGE_TOOLS.find((tool) => tool.name === "dig_mine")!;
    const house = CONCIERGE_TOOLS.find((tool) => tool.name === "build_house")!;
    expect(mine.parameters.properties.player).toMatchObject({ enum: ["ziemek", "gniewko"] });
    expect(mine.description).toContain("8 na 2 na 2");
    expect(house.parameters.properties.archetype).toMatchObject({ enum: ["cabin", "lookout_tower"] });
  });
});

describe("concierge cheat actions", () => {
  const create = (splitScreen: boolean) => {
    const players = {
      ziemek: new PlayerController({ id: "p1", spawn: [0, 40, 0] }),
      gniewko: new PlayerController({ id: "p2", spawn: [5, 40, 0] }),
    };
    const mineTargets: ConciergePlayer[] = [];
    const houseRequests: { player: ConciergePlayer; archetype?: "cabin" | "lookout_tower" }[] = [];
    const host: ConciergeHost = {
      status: () => ({ started: true, splitScreen, volume: 0.8, coins: 0, stars: 0, tier: 1 }),
      setSplitScreen: () => {},
      setVolume: (level) => level,
      teleportToSpawn: () => {},
      reload: () => {},
      setJumpHeight: (player: ConciergePlayer, height) => players[player].setJumpHeight(height),
      setFlying: (player: ConciergePlayer, enabled) => players[player].setFlying(enabled),
      buildHouse: (player, archetype) => {
        houseRequests.push({ player, archetype });
        return { blocks: 60, style: "wood", archetype: archetype ?? "cabin" };
      },
      digMine: (player) => {
        mineTargets.push(player);
        return 16;
      },
      buyExpansion: () => ({ bought: true, stars: 0, cost: 20 }),
    };
    return { players, tools: createConciergeTools(host), mineTargets, houseRequests };
  };

  it("routes a requested tower to the named player", async () => {
    const { tools, houseRequests } = create(true);
    const response = await tools.build_house({ player: "gniewko", archetype: "lookout_tower" });

    expect(response).toContain("Wieża");
    expect(houseRequests).toEqual([{ player: "gniewko", archetype: "lookout_tower" }]);
  });

  it("asks which player before digging in split screen", async () => {
    const { tools, mineTargets } = create(true);
    const response = await tools.dig_mine({});

    expect(response).toContain("Ziemka czy Gniewka");
    expect(mineTargets).toEqual([]);
  });

  it("routes a bounded mine request to the named player", async () => {
    const { tools, mineTargets } = create(true);
    const response = await tools.dig_mine({ player: "gniewko" });

    expect(response).toContain("16 bloków");
    expect(mineTargets).toEqual(["gniewko"]);
  });

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

  it("expands the factory on request", async () => {
    const { tools } = create(false);
    const response = await tools.buy_expansion({});

    expect(response).toContain("Fabryka rośnie");
  });

  it("keeps the deployed agent tool configuration in sync with CONCIERGE_TOOLS", async () => {
    const agentConfig = (await import("../../src/shared/concierge-agent.json")).default;
    expect(agentConfig.tools.length).toBe(CONCIERGE_TOOLS.length);
  });
});
