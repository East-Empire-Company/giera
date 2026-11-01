export class BeatTracker {
  private analyser: AnalyserNode | null = null;
  private freqData = new Uint8Array(0);
  beatPulse = 0;
  bassLevel = 0;

  attach(bus: GainNode, ctx: AudioContext): void {
    if (this.analyser) return;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    bus.connect(this.analyser);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
  }

  update(): void {
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.freqData);
    let sum = 0;
    for (let i = 0; i < 5; i++) sum += this.freqData[i];
    const bass = sum / (5 * 255);
    this.bassLevel = this.bassLevel * 0.9 + bass * 0.1;
    const threshold = this.bassLevel * 1.4 + 0.05;
    if (bass > threshold && bass > 0.15) {
      this.beatPulse = Math.min(1, this.beatPulse + (bass - threshold) * 2);
    }
    this.beatPulse *= 0.88;
  }
}
