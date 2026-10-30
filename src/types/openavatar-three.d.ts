declare module "@openavatar/three" {
  import type { Activity, Expression, Motion, OpenAvatarDocument, State, UserActivity } from "@openavatar/core";

  export type StageOptions = {
    quality?: "low" | "medium" | "high";
    background?: number | string | null;
    pixelRatio?: number;
    shadow?: boolean;
    preserveDrawingBuffer?: boolean;
    margin?: number;
    roomForEffects?: boolean;
  };

  export type AvatarInput = {
    state?: State;
    activity?: Activity;
    userActivity?: UserActivity;
    expression?: Expression | null;
    outfit?: string | null;
    voice?: number;
    pointer?: { x: number; y: number } | null;
  };

  export class OpenAvatarStage {
    constructor(canvas: HTMLCanvasElement, options?: StageOptions);
    load(document: OpenAvatarDocument): unknown;
    turn(degrees: number): void;
    frame(): void;
    resize(width?: number, height?: number): void;
    setInput(input: AvatarInput): void;
    play(id: Motion | string, options?: { loop?: boolean }): number;
    render(dt?: number): void;
    retire(): void;
    start(): void;
    stop(): void;
    dispose(): void;
  }

  export const SUPPORTED_MOTIONS: readonly string[];
}