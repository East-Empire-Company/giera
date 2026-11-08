// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { ConciergeAvatar, computeConciergePose, extractVoiceBands, TATA_TEMPLE_LOCAL_NORMAL, TATA_TEMPLE_LOCAL_POS, TATA_TEMPLE_SCALE } from "../../src/client/concierge/avatar";

describe("ConciergeAvatar pose and lip-sync", () => {
  it("separates low-vowel and high-sibilant voice bands from output spectrum", () => {
    const lowHeavy = new Uint8Array(32);
    for (let i = 0; i < 5; i++) lowHeavy[i] = 210;
    const highHeavy = new Uint8Array(32);
    for (let i = 16; i < 32; i++) highHeavy[i] = 210;

    const lowBands = extractVoiceBands(lowHeavy, 0.5);
    const highBands = extractVoiceBands(highHeavy, 0.5);

    expect(lowBands.low).toBeGreaterThan(0.8);
    expect(lowBands.high).toBe(0);
    expect(highBands.high).toBeGreaterThan(0.8);
    expect(highBands.low).toBe(0);
  });

  it("drives open-vowel mouth morphs on low-formant speech and sibilants on high-frequency speech", () => {
    const silent = extractVoiceBands(null, 0);
    const vowelSpectrum = new Uint8Array(32);
    for (let i = 0; i < 6; i++) vowelSpectrum[i] = 220;
    const sibilantSpectrum = new Uint8Array(32);
    for (let i = 16; i < 32; i++) sibilantSpectrum[i] = 220;

    const idlePose = computeConciergePose({
      state: "idle",
      elapsed: 1.0,
      blinkWeight: 0,
      motionBoost: 0,
      bands: silent,
    });
    const vowelPose = computeConciergePose({
      state: "speaking",
      elapsed: 0.22,
      blinkWeight: 0,
      motionBoost: 0,
      bands: extractVoiceBands(vowelSpectrum, 0.75),
    });
    const sibilantPose = computeConciergePose({
      state: "speaking",
      elapsed: 0.22,
      blinkWeight: 0,
      motionBoost: 0,
      bands: extractVoiceBands(sibilantSpectrum, 0.45),
    });

    expect(idlePose.morphs.aa).toBe(0);
    expect(idlePose.morphs.open).toBe(0);
    const totalVowelJaw =
      vowelPose.morphs.aa +
      vowelPose.morphs.ao +
      vowelPose.morphs.ee +
      vowelPose.morphs.ih +
      vowelPose.morphs.oo +
      vowelPose.morphs.uu +
      vowelPose.morphs.open;
    expect(vowelPose.morphs.aa).toBeGreaterThan(0.18);
    expect(totalVowelJaw).toBeGreaterThan(0.25);
    expect(totalVowelJaw).toBeLessThanOrEqual(0.5);
    expect(sibilantPose.morphs.ss).toBeGreaterThan(vowelPose.morphs.ss);
  });

  it("switches CyberLife temple LED color and gaze across listening, thinking, and speaking states", () => {
    const bands = extractVoiceBands(null, 0);
    const listening = computeConciergePose({ state: "listening", elapsed: 0.7, blinkWeight: 0, motionBoost: 0, bands });
    const thinking = computeConciergePose({ state: "thinking", elapsed: 0.7, blinkWeight: 0.85, motionBoost: 0, bands });

    expect(listening.ledColor).toBe(0x4df0ff);
    expect(thinking.ledColor).toBe(0xffb02e);
    expect(thinking.eyePitch).toBeLessThan(listening.eyePitch);
    expect(thinking.morphs.browOuterLeft).toBeGreaterThan(listening.morphs.browOuterLeft);
    expect(thinking.morphs.blink).toBeCloseTo(0.85, 5);
  });

  it("toggles visibility cleanly in headless DOM without WebGL", () => {
    const canvas = document.createElement("canvas");
    const avatar = new ConciergeAvatar(canvas);
    expect(avatar.isVisible).toBe(false);

    avatar.show("listening");
    expect(avatar.isVisible).toBe(true);

    avatar.setState("speaking");
    avatar.play("nod");
    avatar.hide();
    expect(avatar.isVisible).toBe(false);
    avatar.dispose();
  });

  it("anchors the Tata temple LED on the forehead, clear of the hairline", () => {
    const temple = TATA_TEMPLE_LOCAL_POS;
    expect(temple.y).toBeGreaterThan(0.05);
    expect(temple.y).toBeLessThan(0.12);
    expect(temple.z).toBeGreaterThan(0.05);
    expect(TATA_TEMPLE_LOCAL_NORMAL.z).toBeGreaterThan(0.8);
    expect(TATA_TEMPLE_SCALE).toBeGreaterThan(0.005);
    expect(TATA_TEMPLE_SCALE).toBeLessThan(0.02);
  });
});
