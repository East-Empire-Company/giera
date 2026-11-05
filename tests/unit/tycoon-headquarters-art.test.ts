import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createHeadquartersArt } from "../../src/client/game/tycoon-headquarters-art";

describe("headquarters art", () => {
  it("reveals six stable stages without duplicating their roots", () => {
    const art = createHeadquartersArt();
    expect(art.root.children).toHaveLength(6);
    expect(art.root.getObjectByName("hq-stage-3")!.visible).toBe(false);

    art.setOwned([0, 2, 3, 5]);
    art.setOwned([0, 2, 3, 5]);

    expect(art.root.children).toHaveLength(6);
    expect(art.root.getObjectByName("hq-stage-0")!.visible).toBe(true);
    expect(art.root.getObjectByName("hq-stage-1")!.visible).toBe(false);
    expect(art.root.getObjectByName("hq-stage-2")!.visible).toBe(true);
    expect(art.root.getObjectByName("hq-command-room")).toBeDefined();
    expect(art.root.getObjectByName("hq-block-lab")).toBeDefined();
    expect(art.root.getObjectByName("hq-gadget-lab")).toBeDefined();
    expect(art.root.getObjectByName("hq-rooftop-antenna")).toBeDefined();
    art.dispose();
  });

  it("moves the elevator and animates displays from accumulated simulation time", () => {
    const art = createHeadquartersArt();
    art.setOwned([0, 2, 4, 5]);
    art.setElevatorHeight(3.5);
    expect(art.root.getObjectByName("hq-elevator-platform")!.position.y).toBe(3.5);
    expect(art.root.getObjectByName("hq-elevator-platform-light")!.position.y).toBe(3.6);

    const antenna = art.root.getObjectByName("hq-rooftop-antenna")!;
    const display = art.root.getObjectByName("hq-block-display-0")!;
    art.update(0.5);
    const antennaAngle = antenna.rotation.y;
    const displayAngle = display.rotation.y;
    expect(antennaAngle).toBeGreaterThan(0);
    expect(displayAngle).toBeGreaterThan(0);
    art.update(0.25);
    expect(antenna.rotation.y).toBeGreaterThan(antennaAngle);
    expect(display.rotation.y).toBeGreaterThan(displayAngle);
    art.dispose();
  });

  it("detaches its root and disposes shared GPU resources once", () => {
    const parent = new THREE.Group();
    const art = createHeadquartersArt();
    parent.add(art.root);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    art.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    const geometrySpies = [...geometries].map((geometry) => ({ geometry, dispose: vi.spyOn(geometry, "dispose") }));
    const materialSpies = [...materials].map((material) => ({ material, dispose: vi.spyOn(material, "dispose") }));

    art.dispose();
    art.dispose();

    expect(art.root.parent).toBeNull();
    for (const { dispose } of geometrySpies) expect(dispose).toHaveBeenCalledTimes(1);
    for (const { dispose } of materialSpies) expect(dispose).toHaveBeenCalledTimes(1);
  });
});
