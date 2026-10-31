import { describe, expect, it } from "vitest";
import { PlayerController } from "../../src/client/entities/player";

describe("PlayerController camera orientation", () => {
  it("rotates camera right on positive deltaYaw and looks down on positive deltaPitch", () => {
    const player = new PlayerController({ id: "p1", spawn: [0, 50, 0], yaw: 0 });
    const initCam = player.getCameraPosition(5.0);
    // Facing north (-Z), camera is at +Z
    expect(initCam.z).toBeGreaterThan(0);

    // Turning right with positive deltaYaw
    player.rotateCamera(Math.PI / 2, 0);
    const rightCam = player.getCameraPosition(5.0);
    // Facing east (+X), camera is behind at -X
    expect(rightCam.x).toBeLessThan(0);

    // Looking down with positive deltaPitch (mouse moved down)
    player.rotateCamera(0, 0.5);
    const downCam = player.getCameraPosition(5.0);
    // Camera rises higher than target to look down at player
    expect(downCam.y).toBeGreaterThan(player.getCameraTarget().y);

    // Looking up with negative deltaPitch (mouse moved up)
    player.rotateCamera(0, -1.0);
    const upCam = player.getCameraPosition(5.0);
    // Camera drops lower than target to look up at sky
    expect(upCam.y).toBeLessThan(player.getCameraTarget().y);
  });
});
