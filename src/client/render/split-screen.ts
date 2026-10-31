export type ViewportRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  aspect: number;
};

export function getSplitViewports(width: number, height: number, isSplitScreen: boolean): ViewportRect[] {
  if (!isSplitScreen) {
    return [
      {
        x: 0,
        y: 0,
        width,
        height,
        aspect: width / height,
      },
    ];
  }

  const halfWidth = Math.floor(width / 2);
  return [
    {
      x: 0,
      y: 0,
      width: halfWidth,
      height,
      aspect: halfWidth / height,
    },
    {
      x: halfWidth,
      y: 0,
      width: width - halfWidth,
      height,
      aspect: (width - halfWidth) / height,
    },
  ];
}

export type GamepadInput = {
  forward: number;
  right: number;
  lookX: number;
  lookY: number;
  jump: boolean;
  sprint: boolean;
  mine: boolean;
  place: boolean;
  toggleInventory: boolean;
  toggleSplit: boolean;
  prevSlot: boolean;
  nextSlot: boolean;
};

export class SplitScreenManager {
  private splitScreen = false;
  private p2GamepadIndex: number | null = null;

  constructor(initialSplit = false) {
    this.splitScreen = initialSplit;
  }

  get isSplitScreen(): boolean {
    return this.splitScreen;
  }

  setSplitScreen(value: boolean): void {
    this.splitScreen = value;
  }

  toggle(): boolean {
    this.splitScreen = !this.splitScreen;
    return this.splitScreen;
  }

  setGamepadIndex(index: number | null): void {
    this.p2GamepadIndex = index;
  }

  pollGamepad(playerIndex: 0 | 1 = 1, customGetGamepads?: () => (Gamepad | null)[]): GamepadInput | null {
    const getPads = customGetGamepads ?? (typeof navigator !== "undefined" && navigator.getGamepads ? () => navigator.getGamepads() : undefined);
    if (!getPads) return null;
    const rawPads = getPads();
    const connectedPads: Gamepad[] = [];
    for (let i = 0; i < rawPads.length; i++) {
      const g = rawPads[i];
      if (g && g.connected) connectedPads.push(g);
    }
    if (connectedPads.length === 0) return null;

    let pad: Gamepad | null = null;
    if (connectedPads.length >= 2) {
      pad = connectedPads[playerIndex] ?? null;
    } else {
      pad = connectedPads[0] ?? null;
    }
    if (!pad) return null;

    const deadzone = (val: number, threshold = 0.15): number => {
      return Math.abs(val) > threshold ? val : 0;
    };

    const leftX = deadzone(pad.axes[0] ?? 0);
    const leftY = deadzone(pad.axes[1] ?? 0);
    const rightX = deadzone(pad.axes[2] ?? 0);
    const rightY = deadzone(pad.axes[3] ?? 0);

    return {
      forward: -leftY,
      right: leftX,
      lookX: rightX * 2.5,
      lookY: rightY * 2.0,
      jump: pad.buttons[0]?.pressed ?? false, // A
      place: pad.buttons[6]?.pressed ?? false, // LT
      mine: pad.buttons[7]?.pressed ?? false, // RT
      sprint: pad.buttons[10]?.pressed ?? false, // LS
      toggleInventory: pad.buttons[2]?.pressed ?? false, // X
      toggleSplit: (pad.buttons[9]?.pressed || pad.buttons[3]?.pressed) ?? false, // Menu or Y
      prevSlot: pad.buttons[4]?.pressed ?? false, // LB
      nextSlot: pad.buttons[5]?.pressed ?? false, // RB
    };
  }
}
