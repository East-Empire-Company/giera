export type ConciergeToolName =
  | "get_status"
  | "set_jump_height"
  | "set_flight"
  | "build_house"
  | "set_split_screen"
  | "set_volume"
  | "teleport_to_spawn"
  | "make_backup"
  | "list_backups"
  | "restore_backup"
  | "reset_progress";

export type ConciergeToolSpec = {
  name: ConciergeToolName;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export const CONCIERGE_TOOLS: readonly ConciergeToolSpec[] = [
  {
    name: "get_status",
    description:
      "Odczytaj aktualny stan gry: czy gra trwa, czy jest podzielony ekran, głośność, monety i poziom. Użyj tego, zanim odpowiesz na pytanie o stan gry.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "set_jump_height",
    description: "Ustaw skok gracza. W trybie dwóch graczy zapytaj, czy chodzi o Ziemka czy Gniewka.",
    parameters: {
      type: "object",
      properties: {
        height_blocks: { type: "number", minimum: 1, maximum: 12, description: "Wysokość skoku w blokach, od 1 do 12" },
        player: { type: "string", enum: ["ziemek", "gniewko"], description: "Gracz; wymagany w trybie dwóch graczy" },
      },
      required: ["height_blocks"],
    },
  },
  {
    name: "set_flight",
    description: "Włącz albo wyłącz latanie gracza. W trybie dwóch graczy zapytaj, kto chce latać.",
    parameters: {
      type: "object",
      properties: {
        enabled: { type: "boolean", description: "true = latanie włączone, false = wyłączone" },
        player: { type: "string", enum: ["ziemek", "gniewko"], description: "Gracz; wymagany w trybie dwóch graczy" },
      },
      required: ["enabled"],
    },
  },
  {
    name: "build_house",
    description: "Zbuduj mały losowy domek z bloków na wolnym miejscu. Nie niszcz istniejących bloków.",
    parameters: {
      type: "object",
      properties: { player: { type: "string", enum: ["ziemek", "gniewko"], description: "Gracz, w pobliżu którego powstanie domek" } },
    },
  },
  {
    name: "set_split_screen",
    description: "Włącz lub wyłącz tryb dwóch graczy (podzielony ekran).",
    parameters: {
      type: "object",
      properties: { enabled: { type: "boolean", description: "true = dwóch graczy, false = jeden gracz" } },
      required: ["enabled"],
    },
  },
  {
    name: "set_volume",
    description: "Ustaw głośność dźwięku w grze od 0 do 1.",
    parameters: {
      type: "object",
      properties: { level: { type: "number", description: "Głośność 0..1" } },
      required: ["level"],
    },
  },
  {
    name: "teleport_to_spawn",
    description: "Przenieś gracza na punkt startowy, jeśli gdzieś utknął.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "make_backup",
    description: "Zapisz kopię zapasową postępów graczy. Zrób to przed resetem albo przed dużą zmianą.",
    parameters: {
      type: "object",
      properties: { label: { type: "string", description: "Krótka nazwa kopii, np. 'przed resetem'" } },
    },
  },
  {
    name: "list_backups",
    description: "Wypisz zapisane kopie zapasowe postępów.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "restore_backup",
    description: "Przywróć postępy z kopii zapasowej. Gra wczyta zapis od nowa.",
    parameters: {
      type: "object",
      properties: { backup_id: { type: "string", description: "Identyfikator kopii z list_backups" } },
      required: ["backup_id"],
    },
  },
  {
    name: "reset_progress",
    description:
      "Skasuj postępy i zacznij od nowa. Wymaga potwierdzenia przez dziecko. Przed resetem zawsze zrób kopię zapasową.",
    parameters: {
      type: "object",
      properties: {
        confirmed: { type: "boolean", description: "true tylko wtedy, gdy dziecko wprost potwierdziło reset" },
      },
      required: ["confirmed"],
    },
  },
] as const;