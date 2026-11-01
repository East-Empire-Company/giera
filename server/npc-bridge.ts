export type ToolExecutionResult = {
  success: boolean;
  message?: string;
  hint?: string;
};

export const ALLOWED_NPC_BLOCKS = ["planks", "cobblestone", "glass", "iron_block"] as const;

export const NPC_ALLOWED_TOOLS: Record<string, string[]> = {
  tata: ["give_block", "give_quest", "share_map_hint"],
  mama: ["give_block", "share_map_hint"],
  ciocia: ["give_block"],
};

export function executeNpcClientTool(
  npcId: string,
  toolName: string,
  params: Record<string, unknown>,
  inventory?: { blocks: Record<string, number>; items: Record<string, number> },
  onQuestUpdate?: (stepId: string) => void
): ToolExecutionResult {
  if (!Object.hasOwn(NPC_ALLOWED_TOOLS, npcId) || !NPC_ALLOWED_TOOLS[npcId].includes(toolName)) {
    return { success: false, message: `NPC ${npcId} nie może użyć narzędzia: ${toolName}` };
  }

  if (toolName === "give_block") {
    const { block_type: blockType, count } = params;

    if (typeof blockType !== "string" || !(ALLOWED_NPC_BLOCKS as readonly string[]).includes(blockType)) {
      return { success: false, message: `Nieznany lub niedozwolony blok: ${String(blockType)}` };
    }
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 16) {
      return { success: false, message: `Niepoprawna liczba bloków: ${String(count)}` };
    }

    if (inventory) {
      inventory.blocks[blockType] = (inventory.blocks[blockType] ?? 0) + count;
    }
    return { success: true, message: `Przekazano ${count}x ${blockType}` };
  }

  if (toolName === "give_quest") {
    const stepId = params.step_id;
    const validSteps = ["gather_wood", "craft_planks", "craft_sticks", "find_stone", "craft_tool", "build_house"];
    if (typeof stepId !== "string" || !validSteps.includes(stepId)) {
      return { success: false, message: `Nieznany krok zadania: ${String(stepId)}` };
    }
    onQuestUpdate?.(stepId);
    return { success: true, message: `Ustawiono zadanie: ${stepId}` };
  }

  if (toolName === "share_map_hint") {
    const topic = String(params.topic ?? "").toLowerCase();
    let hint = "Rozejrzyj się wokół polany — las jest pełen przydatnych surowców!";
    if (topic.includes("drzew") || topic.includes("drewn")) {
      hint = "Wysokie drzewa i dęby rosną tuż obok polany, na północ od miejsca startu.";
    } else if (topic.includes("kamie") || topic.includes("rud")) {
      hint = "Szare skały i złoża węgla znajdziesz na pobliskim skalistym zboczu.";
    } else if (topic.includes("wod") || topic.includes("staw")) {
      hint = "Czysta woda znajduje się w małym stawie na wschód od polany.";
    } else if (topic.includes("dom")) {
      hint = "Płaska polana z miękką trawą to idealne miejsce na Wasz pierwszy wspólny dom!";
    }
    return { success: true, hint };
  }

  return { success: false, message: `Nieobsługiwane narzędzie: ${toolName}` };
}

export async function getElevenLabsSignedUrl(agentId: string, apiKey: string): Promise<string> {
  const url = `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`;
  const res = await fetch(url, {
    headers: { "xi-api-key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs signed URL request failed with status ${res.status}`);
  }
  const data = (await res.json()) as { signed_url: string };
  return data.signed_url;
}
