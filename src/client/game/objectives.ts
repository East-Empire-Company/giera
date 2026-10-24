export type ObjectiveStepDef = {
  id: string;
  name: string;
  targetCount: number;
  formatTitle: (current: number, target: number) => string;
};

export const OBJECTIVE_STEPS: ObjectiveStepDef[] = [
  {
    id: "gather_wood",
    name: "Zbierz drewno",
    targetCount: 4,
    formatTitle: (c, t) => `Zbierz drewno (${c}/${t})`,
  },
  {
    id: "craft_planks",
    name: "Zrób deski w ekwipunku [I]",
    targetCount: 4,
    formatTitle: (c, t) => `Zrób deski w ekwipunku [I] (${c}/${t})`,
  },
  {
    id: "craft_sticks",
    name: "Zrób patyki",
    targetCount: 4,
    formatTitle: (c, t) => `Zrób patyki (${c}/${t})`,
  },
  {
    id: "find_stone",
    name: "Zbierz kamień lub rudę",
    targetCount: 3,
    formatTitle: (c, t) => `Zbierz kamień lub rudę (${c}/${t})`,
  },
  {
    id: "craft_tool",
    name: "Zrób pierwsze narzędzie",
    targetCount: 1,
    formatTitle: (c, t) => `Zrób pierwsze narzędzie (${c}/${t})`,
  },
  {
    id: "build_house",
    name: "Zbuduj swój pierwszy domek!",
    targetCount: 10,
    formatTitle: (c, t) => `Zbuduj swój pierwszy domek! (${c}/${t})`,
  },
];

export class ObjectiveManager {
  private stepIndex = 0;
  private currentProgress = 0;

  constructor(initialStep = 0, initialProgress = 0) {
    this.stepIndex = Math.min(initialStep, OBJECTIVE_STEPS.length);
    this.currentProgress = initialProgress;
  }

  get isComplete(): boolean {
    return this.stepIndex >= OBJECTIVE_STEPS.length;
  }

  get currentStep(): { id: string; name: string; title: string; progress: number; target: number } {
    if (this.isComplete) {
      return {
        id: "all_complete",
        name: "Wszystkie zadania wykonane!",
        title: "Wspaniale! Świat należy do Was!",
        progress: 1,
        target: 1,
      };
    }
    const def = OBJECTIVE_STEPS[this.stepIndex];
    return {
      id: def.id,
      name: def.name,
      title: def.formatTitle(this.currentProgress, def.targetCount),
      progress: this.currentProgress,
      target: def.targetCount,
    };
  }

  recordAction(actionId: string, count = 1): boolean {
    if (this.isComplete) return false;
    const def = OBJECTIVE_STEPS[this.stepIndex];
    if (def.id !== actionId) return false;

    this.currentProgress += count;
    if (this.currentProgress >= def.targetCount) {
      this.stepIndex++;
      this.currentProgress = 0;
      return true; // Advanced to next milestone
    }
    return false;
  }

  setStep(index: number): void {
    this.stepIndex = Math.max(0, Math.min(index, OBJECTIVE_STEPS.length));
    this.currentProgress = 0;
  }
}
