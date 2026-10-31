import { CONCIERGE_TOOLS, type ConciergeToolName } from "../../shared/concierge-tools";
import { createBackup, readBackups, restoreBackup, clearProgress, summarize, type BackupSummary } from "./backups";

export type ConciergeStatus = {
  started: boolean;
  splitScreen: boolean;
  volume: number;
  coins: number;
  stars: number;
  tier: number;
};

export type ConciergePlayer = "ziemek" | "gniewko";
export type ConciergeHouse = { blocks: number; style: "wood" | "stone" };
export type ConciergeExpansion = { bought: boolean; stars: number; cost: number };

export type ConciergeHost = {
  status(): ConciergeStatus;
  setSplitScreen(enabled: boolean): void;
  setVolume(level: number): number;
  setJumpHeight(player: ConciergePlayer, height: number): number;
  setFlying(player: ConciergePlayer, enabled: boolean): boolean;
  buildHouse(player: ConciergePlayer): ConciergeHouse | null;
  buyExpansion(): ConciergeExpansion;
  teleportToSpawn(): void;
  reload(): void;
};

export type ConciergeToolHandler = (params: Record<string, unknown>) => Promise<string>;

const clampVolume = (value: unknown): number => {
  const level = typeof value === "number" && Number.isFinite(value) ? value : 0.8;
  return Math.min(1, Math.max(0, level));
};

const describeBackup = (backup: BackupSummary): string => `${backup.label} (${backup.id})`;

const resolveCheatPlayer = (params: Record<string, unknown>, splitScreen: boolean): ConciergePlayer | null => {
  if (params.player === "ziemek") return "ziemek";
  if (params.player === "gniewko") return splitScreen ? "gniewko" : null;
  return splitScreen ? null : "ziemek";
};
export function createConciergeTools(host: ConciergeHost): Record<ConciergeToolName, ConciergeToolHandler> {
  return {
    async get_status() {
      const status = host.status();
      return JSON.stringify(status);
    },
    async set_jump_height(params) {
      const target = resolveCheatPlayer(params, host.status().splitScreen);
      if (!target) return "Zapytaj, czy chodzi o Ziemka czy Gniewka.";
      const height = params.height_blocks;
      if (typeof height !== "number" || !Number.isFinite(height)) return "Zapytaj, jak wysoko ma skakać.";
      host.setJumpHeight(target, height);
      return target === "ziemek" ? "Ziemek skacze teraz wyżej!" : "Gniewko skacze teraz wyżej!";
    },

    async set_flight(params) {
      const target = resolveCheatPlayer(params, host.status().splitScreen);
      if (!target) return "Zapytaj, czy chodzi o Ziemka czy Gniewka.";
      if (typeof params.enabled !== "boolean") return "Zapytaj, czy włączyć latanie.";
      const enabled = host.setFlying(target, params.enabled);
      return enabled ? "Latanie włączone! Spacja w górę, Shift w dół." : "Latanie wyłączone.";
    },

    async build_house(params) {
      const target = resolveCheatPlayer(params, host.status().splitScreen);
      if (!target) return "Zapytaj, czy domek zbudować dla Ziemka czy Gniewka.";
      const house = host.buildHouse(target);
      return house ? "Domek z klocków już stoi!" : "Nie ma bezpiecznego miejsca na domek.";
    },

    async set_split_screen(params) {
      const enabled = params.enabled === true;
      host.setSplitScreen(enabled);
      return enabled ? "Włączony tryb dwóch graczy." : "Włączony tryb jednego gracza.";
    },

    async set_volume(params) {
      const level = host.setVolume(clampVolume(params.level));
      return `Głośność ustawiona na ${Math.round(level * 100)}%.`;
    },

    async teleport_to_spawn() {
      host.teleportToSpawn();
      return "Gracz jest na punkcie startowym.";
    },

    async make_backup(params) {
      const label = typeof params.label === "string" ? params.label : "kopia";
      const backup = await createBackup(label);
      return backup ? `Zapisana kopia: ${describeBackup(backup)}` : "Nie ma jeszcze postępów do zapisania.";
    },

    async list_backups() {
      const backups = readBackups().map(summarize);
      return backups.length ? backups.map(describeBackup).join("; ") : "Nie ma żadnych kopii zapasowych.";
    },

    async restore_backup(params) {
      const id = typeof params.backup_id === "string" ? params.backup_id : "";
      const restored = await restoreBackup(id);
      if (!restored) return "Nie znalazłem takiej kopii.";
      host.reload();
      return "Przywracam postępy. Gra wczyta się od nowa.";
    },

    async reset_progress(params) {
      if (params.confirmed !== true) {
        return "Najpierw zapytaj dziecko, czy na pewno chce zacząć od nowa. Potem wywołaj to narzędzie z confirmed=true.";
      }
      await createBackup("przed resetem");
      await clearProgress();
      host.reload();
      return "Postępy skasowane. Zrobiłem kopię zapasową na wszelki wypadek.";
    },

    async buy_expansion() {
      const result = host.buyExpansion();
      if (result.bought) return `Fabryka rośnie! Nowe pole kosztowało ${result.cost} gwiazdek.`;
      if (result.cost <= 0) return "Fabryka jest już rozbudowana do końca!";
      return `Potrzebujesz ${result.cost} gwiazdek na kolejne pole fabryki.`;
    },
  };
}

export const CONCIERGE_TOOL_NAMES: readonly string[] = CONCIERGE_TOOLS.map((tool) => tool.name);