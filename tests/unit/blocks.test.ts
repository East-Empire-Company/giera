import { describe, expect, it } from "vitest";
import { BLOCKS, BlockId, getBlockDef } from "../../src/shared/blocks";

describe("block registry", () => {
  it("keeps stable unique IDs and an unbreakable bedrock floor", () => {
    expect(new Set(BLOCKS.map((block) => block.id)).size).toBe(BLOCKS.length);
    expect(getBlockDef(0).name).toBe("Powietrze");
    expect(getBlockDef(1).hardness).toBe(Infinity);
    expect(getBlockDef(1).solid).toBe(true);
  });

  it("keeps water non-solid and rejects unknown IDs", () => {
    expect(getBlockDef(11).liquid).toBe(true);
    expect(getBlockDef(11).solid).toBe(false);
    expect(() => getBlockDef(99 as BlockId)).toThrow(RangeError);
  });

  it("defines TNT as id 20 with city ids 15-19 untouched", () => {
    expect(getBlockDef(20).name).toBe("TNT");
    expect(getBlockDef(20).tiles.side).toBe("tnt");
    expect(getBlockDef(20).hardness).toBe(0.1);
    expect(getBlockDef(20).solid).toBe(true);
    expect(getBlockDef(15).name).toBe("Asfalt");
    expect(getBlockDef(19).name).toBe("Dachówka");
  });
});
