import { parse } from "@openavatar/core";
import { OpenAvatarStage } from "@openavatar/three";
import robotDoc from "./giera-robot.openavatar.json";

export type ConciergeAvatarState = "idle" | "listening" | "thinking" | "speaking";

export class ConciergeAvatar {
  private stage: OpenAvatarStage | null = null;
  private pendingState: ConciergeAvatarState = "idle";

  constructor(private readonly canvas: HTMLCanvasElement) {}

  get isVisible(): boolean {
    return this.stage !== null;
  }

  show(state: ConciergeAvatarState = "idle"): void {
    if (!this.stage) {
      const stage = new OpenAvatarStage(this.canvas, { quality: "medium", pixelRatio: Math.min(2, window.devicePixelRatio || 1) });
      stage.load(parse(JSON.stringify(robotDoc)).document);
      stage.setInput({ state: this.pendingState });
      this.stage = stage;
      this.resize();
    }
    this.setState(state);
    this.stage.start();
  }

  hide(): void {
    this.stage?.stop();
  }

  setState(state: ConciergeAvatarState): void {
    this.pendingState = state;
    this.stage?.setInput({ state });
  }

  play(motion: string): void {
    this.stage?.play(motion);
  }

  resize(): void {
    this.stage?.resize();
  }

  dispose(): void {
    this.stage?.dispose();
    this.stage = null;
  }
}