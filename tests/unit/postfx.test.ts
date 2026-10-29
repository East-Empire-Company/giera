import { describe, expect, it } from "vitest";
import type { WebGLRenderTarget, WebGLRenderer } from "three";
import { AdaptiveBloomEffect, nextLadderState, postWindowAdvance, type LadderState } from "../../src/client/render/postfx";
import { paletteColor, variationColor } from "../../src/client/render/ground-decor";

describe("adaptive bloom", () => {
  it("skips bloom rendering when disabled and restores its blend opacity", () => {
    const bloom = new AdaptiveBloomEffect();
    let rendererAccesses = 0;
    const renderer = new Proxy(
      {},
      {
        get() {
          rendererAccesses++;
          return () => undefined;
        },
      }
    ) as WebGLRenderer;

    bloom.setActive(false);
    bloom.update(renderer, {} as WebGLRenderTarget);

    expect(rendererAccesses).toBe(0);
    expect(bloom.blendMode.opacity.value).toBe(0);

    bloom.setActive(true);
    expect(bloom.blendMode.opacity.value).toBe(1);
  });
});

describe("postfx auto-degrade ladder", () => {
  const on: LadderState = { quality: { ao: true, bloom: true }, restoreCooldown: 0, failedRestores: 0 };
  const off: LadderState = { quality: { ao: false, bloom: false }, restoreCooldown: 0, failedRestores: 0 };

  it("keeps AO and bloom at 50 fps or higher", () => {
    expect(nextLadderState(on, 55).quality).toEqual(on.quality);
    expect(nextLadderState(on, 50).quality).toEqual(on.quality);
  });

  it("drops AO and bloom below 50 fps", () => {
    expect(nextLadderState(on, 49).quality).toEqual({ ao: false, bloom: false });
    expect(nextLadderState(on, 1).quality).toEqual({ ao: false, bloom: false });
  });

  it("restores AO and bloom only above 55 fps once the cooldown is spent", () => {
    expect(nextLadderState(off, 54).quality).toEqual(off.quality);
    expect(nextLadderState(off, 55).quality).toEqual(off.quality);
    expect(nextLadderState(off, 56).quality).toEqual({ ao: true, bloom: true });
  });

  it("closes the fps window at 5 seconds and resets it", () => {
    expect(postWindowAdvance(0, 1)).toEqual({ total: 1, due: false });
    expect(postWindowAdvance(4.5, 0.5)).toEqual({ total: 5, due: true });
  });
});

describe("postfx ladder back-off", () => {
  const fresh: LadderState = { quality: { ao: true, bloom: true }, restoreCooldown: 0, failedRestores: 0 };

  it("degrades immediately when the frame rate is poor", () => {
    const after = nextLadderState(fresh, 40);
    expect(after.quality).toEqual({ ao: false, bloom: false });
  });

  it("restores once the cooldown has elapsed and the frame rate has headroom", () => {
    let state = nextLadderState(fresh, 40);
    for (let window = 0; window < 6; window++) state = nextLadderState(state, 60);
    expect(state.quality).toEqual({ ao: true, bloom: true });
  });

  it("does not flip effects back on every window when restoring keeps failing", () => {
    let state = nextLadderState(fresh, 40);
    const history: boolean[] = [];
    for (let window = 0; window < 60; window++) {
      const fps = state.quality.ao ? 27 : 59;
      state = nextLadderState(state, fps);
      history.push(state.quality.ao);
    }
    const flips = history.filter((on, i) => i > 0 && on !== history[i - 1]).length;
    expect(flips).toBeLessThanOrEqual(8);
  });

  it("backs off for longer after each failed restore", () => {
    const base = nextLadderState(fresh, 40);
    const afterOne = nextLadderState({ ...nextLadderState(base, 59), quality: { ao: true, bloom: true } }, 27);
    const afterTwo = nextLadderState(
      { ...nextLadderState({ ...afterOne, restoreCooldown: 0 }, 59), quality: { ao: true, bloom: true } },
      27
    );
    expect(afterTwo.restoreCooldown).toBeGreaterThan(afterOne.restoreCooldown);
  });

  it("never leaves effects disabled forever: a long run of good frames restores them", () => {
    let state: LadderState = { quality: { ao: false, bloom: false }, restoreCooldown: 0, failedRestores: 5 };
    for (let window = 0; window < 200; window++) state = nextLadderState(state, 60);
    expect(state.quality).toEqual({ ao: true, bloom: true });
  });
});

describe("decor tint helpers", () => {
  const item = { x: 12, y: 0, z: -4, kind: "tuft" as const, scale: 1, rotation: 0 };
  it("derives deterministic grayscale variation from position and seed", () => {
    const a = variationColor(4242, item);
    const b = variationColor(4242, item);
    expect(a.getHex()).toBe(b.getHex());
    expect(a.r).toBe(a.g);
    expect(a.g).toBe(a.b);
    const other = variationColor(987654, item);
    expect(other.getHex()).not.toBe(a.getHex());
  });

  it("picks palette entries deterministically", () => {
    const palette = [0x8d8d8d, 0x9b9b8f];
    expect(paletteColor(item, palette, 7)).toBe(paletteColor(item, palette, 7));
    expect([0x8d8d8d, 0x9b9b8f]).toContain(paletteColor(item, palette, 7));
  });
});
