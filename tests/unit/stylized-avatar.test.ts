import { describe, expect, it } from "vitest";
import { createStylizedCharacter } from "../../src/client/entities/stylized-avatar";

describe("createStylizedCharacter", () => {
  it("builds stylized Ziemek character with backpack, shaggy hair, and concept colors", () => {
    const ziemek = createStylizedCharacter("ziemek");
    expect(ziemek.object).toBeDefined();
    expect(ziemek.backpack).toBeDefined();
    expect(ziemek.hair).toBeDefined();
    expect(ziemek.leftArmPivot).toBeDefined();
    expect(ziemek.rightArmPivot).toBeDefined();
    expect(ziemek.leftLegPivot).toBeDefined();
    expect(ziemek.rightLegPivot).toBeDefined();
  });

  it("builds stylized Gniewko character with polo, neat hair, and navy trousers", () => {
    const gniewko = createStylizedCharacter("gniewko");
    expect(gniewko.object).toBeDefined();
    expect(gniewko.hair).toBeDefined();
    expect(gniewko.torso).toBeDefined();
    expect(gniewko.leftLegPivot).toBeDefined();
  });

  it("updates running animation cycle over time", () => {
    const ziemek = createStylizedCharacter("ziemek");
    ziemek.setMotion("walk");
    const initLeftArmRot = ziemek.leftArmPivot.rotation.x;
    ziemek.update(0.1);
    expect(ziemek.leftArmPivot.rotation.x).not.toBe(initLeftArmRot);
  });
});
