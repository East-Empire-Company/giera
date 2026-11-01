# Three.js Beat Pattern Examples — Research for Giera

## Source: https://threejs.org/examples/

## 1. webaudio_visualizer (official example)

**What it does:** FFT frequency analysis of a playing audio track, rendered as a shader-driven bar visualizer.

**Key technique:**
```js
const fftSize = 128;
const analyser = new THREE.AudioAnalyser(audio, fftSize);
// Each frame:
analyser.getFrequencyData();
uniforms.tAudioData.value.needsUpdate = true;
// Fragment shader reads frequency data as a DataTexture:
// float f = texture2D(tAudioData, vec2(vUv.x, 0.0)).r;
```

**Relevance to Giera:** HIGH. Giera already has a WebAudio `AudioManager` with a `musicBus` GainNode. Tapping an `AnalyserNode` into the music bus is trivial — no new audio pipeline needed. The `DataTexture` approach is GPU-cheap and could drive shader uniforms (bloom intensity, fog color shift, particle emission rate) without touching JS per-particle.

## 2. Audio-reactive patterns applicable to Giera

### 2a. Beat-driven bloom pulse (postfx.ts)
Giera's `AdaptiveBloomEffect` already modulates intensity by FPS. Adding a beat signal:
- Tap `AnalyserNode` on `musicBus` (fftSize 256, ~5ms cost)
- Compute low-band energy (bins 0-4) each frame
- Smooth with exponential moving average: `level = level * 0.92 + band * 0.08`
- On beat (level > threshold), pulse bloom intensity: `bloom.intensity = 0.14 + beatPulse * 0.3`
- Decay `beatPulse *= 0.88` each frame

**Cost:** Negligible. One analyser read + one uniform update per frame. No extra draw calls.

### 2b. Beat-synced particle emission (gameplayVfx)
Giera's `GameplayVfx` already has a 64-particle pool with priority. On beat:
- Emit ambient pollen/dust particles in sync with music
- Increase emission rate on bass hits, decrease on quiet sections
- Kids see the world "breathe" with the music — no reading required, pure visual feedback

**Cost:** Reuses existing particle pool. Zero new allocations.

### 2c. Sky/fog color shift on beat (SkyCycle)
Giera's `SkyCycle` controls hemisphere light, fog, sun intensity. On strong beats:
- Nudge fog density or hemisphere light intensity up 2-5% for 200ms
- Creates a subtle "thump" feeling without being distracting
- Keep amplitude small — this is a kids' sandbox, not a nightclub

**Cost:** One uniform update per frame. Free.

### 2d. NPC idle animation sync
NPCs (tata, mama, ciocia) could bob/sway on the beat during ambient idle. The `avatar.ts` system already supports `playOnce` and looping animations. A beat signal could:
- Trigger a subtle head-bob or weight shift on strong beats
- Mama's salsa dance animation is already music-driven by design — sync it to the actual BPM instead of fixed speed

**Cost:** One bone offset update per NPC per frame. Negligible.

## 3. Implementation sketch

```ts
// src/client/audio/beat-tracker.ts
export class BeatTracker {
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array = new Uint8Array(0);
  private ema = 0;
  beatPulse = 0;  // 0..1, decays each frame
  bassLevel = 0;  // smoothed low-band energy

  attach(musicBus: GainNode, context: AudioContext): void {
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    musicBus.connect(this.analyser);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
  }

  update(): void {
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.freqData);
    // Low band: bins 0-4 (~0-86Hz at 44.1kHz/256)
    let sum = 0;
    for (let i = 0; i < 5; i++) sum += this.freqData[i];
    const bass = sum / (5 * 255);
    this.bassLevel = this.bassLevel * 0.9 + bass * 0.1;
    // Beat detection: compare instant bass to EMA
    const threshold = this.bassLevel * 1.4 + 0.05;
    if (bass > threshold && bass > 0.15) {
      this.beatPulse = Math.min(1, this.beatPulse + (bass - threshold) * 2);
    }
    this.beatPulse *= 0.88;
  }
}
```

Wire into main loop:
```ts
// After audio.playPlaylist():
beatTracker.attach(audio.musicBus, audio.context);
// In render loop, before postfx.render():
beatTracker.update();
postfx.setBeatPulse(beatTracker.beatPulse);
gameplayVfx.setBeatPulse(beatTracker.beatPulse);
```

## 4. What NOT to do

- **Full-screen shader visualizer** (like the example): wrong for a 3D voxel game. The visualizer replaces the entire scene. Giera needs the world visible.
- **Frequency bar overlay**: distracting for non-reading kids. The beat should be felt, not shown as a UI element.
- **Strong screen shake on beat**: nausea risk for children. Keep amplitude subtle (2-5% changes).
- **Beat detection on SFX/voice**: only analyze the music bus, not master. Voice lines and SFX would false-trigger beats.

## 5. Priority ranking

| Pattern | Value | Cost | Risk |
|---|---|---|---|
| Beat-driven bloom pulse | High | Negligible | Low |
| Beat-synced particle emission | Medium | Zero (reuses pool) | Low |
| Sky/fog color shift | Medium | Negligible | Low (keep subtle) |
| NPC idle bob on beat | Low-medium | Negligible | Low |
| Mama salsa dance sync | Medium | Small (animation speed mod) | Low |

## 6. Recommendation

Start with **beat-driven bloom pulse** — highest visual impact per line of code, zero risk, reuses existing `AdaptiveBloomEffect`. Add `BeatTracker` (30 lines), wire to `musicBus`, modulate bloom intensity. If it feels good, add particle emission sync next.

Total estimated work: ~80 lines across 2 files (`beat-tracker.ts` new, `postfx.ts` +5 lines, `main.ts` +3 lines). No asset changes. No pipeline changes. Determinism-safe (beat tracker is presentation-only, does not touch simulation).
