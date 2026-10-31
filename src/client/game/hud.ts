import { BLOCK_BY_ID, type BlockId } from "../../shared/blocks";
import type { GameInventory } from "./inventory";
import type { ObjectiveManager } from "./objectives";
import { RECIPES, canCraft, craftRecipe } from "./recipes";

export function getItemIcon(key: string): string {
  const icons: Record<string, string> = {
    stone: "/assets/textures/tiles/stone.png",
    cobblestone: "/assets/textures/tiles/cobblestone.png",
    dirt: "/assets/textures/tiles/dirt.png",
    grass: "/assets/textures/tiles/grass_top.png",
    sand: "/assets/textures/tiles/sand.png",
    oak_log: "/assets/textures/tiles/oak_log_side.png",
    oak_leaves: "/assets/textures/tiles/ginkgo_leaves.png",
    planks: "/assets/textures/tiles/oak_planks.png",
    glass: "/assets/textures/tiles/glass.png",
    water: "/assets/textures/tiles/water.png",
    coal_ore: "/assets/textures/tiles/default_mineral_coal.png",
    iron_ore: "/assets/textures/tiles/default_mineral_iron.png",
    gold_ore: "/assets/textures/tiles/default_mineral_gold.png",
    stick: "/assets/textures/tiles/oak_planks.png",
    stone_axe: "/assets/ui/icons/axe_iron.png",
    iron_pickaxe: "/assets/ui/icons/pick_iron.png",
    iron_sword: "/assets/ui/icons/axe_iron.png",
  };
  return icons[key] ?? "/assets/ui/kenney/star.png";
}

export class GameHUD {
  private readonly container: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly breakBar: HTMLElement;
  private readonly breakFill: HTMLElement;
  private readonly hotbar: HTMLElement;
  private readonly objectiveRibbon: HTMLElement;
  private readonly tycoonChip: HTMLElement;
  private readonly tycoonStars: HTMLElement;
  private readonly tycoonVault: HTMLElement;
  private readonly tycoonUpgradeCost: HTMLElement;
  private readonly tycoonTier: HTMLElement;
  private readonly inventoryModal: HTMLElement;
  private readonly inventoryGrid: HTMLElement;
  private readonly recipeList: HTMLElement;
  private inventoryOpen = false;
  readonly modeBtn: HTMLButtonElement;
  readonly inventoryBtn: HTMLButtonElement;
  readonly lanBtn: HTMLButtonElement;
  readonly controlsBtn: HTMLButtonElement;
  private readonly lanModal: HTMLElement;
  private readonly controlsModal: HTMLElement;
  private readonly npcPrompt: HTMLElement;
  private readonly npcModal: HTMLElement;
  private readonly speechLayer: HTMLElement;
  private readonly speechBubbles = new Map<
    string,
    { el: HTMLElement; nameEl: HTMLElement; textEl: HTMLElement; until: number }
  >();
  private readonly resourceGain: HTMLElement;
  private readonly resourceGainIcon: HTMLImageElement;
  private readonly resourceGainCount: HTMLElement;
  private resourceGainUntil = 0;
  private npcDialogOpen = false;
  private lanModalOpen = false;
  private controlsModalOpen = false;
  constructor(options: {
    inventory: GameInventory;
    objectives: ObjectiveManager;
    onCraft?: (recipeId: string) => void;
    onToggleSplitScreen?: () => boolean;
    onConnectLan?: (url: string, room: string) => Promise<boolean>;
  }) {
    let root = document.querySelector<HTMLElement>("#hud-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "hud-root";
      root.className = "game-hud";
      document.body.appendChild(root);
    }
    this.container = root;
    root.addEventListener("click", (event) => {
      (event.target as HTMLElement | null)?.closest("button")?.blur();
    });

    // Crosshair
    this.crosshair = document.createElement("div");
    this.crosshair.className = "hud-crosshair";
    this.container.appendChild(this.crosshair);

    // Break progress bar
    this.breakBar = document.createElement("div");
    this.breakBar.className = "hud-break-bar";
    this.breakFill = document.createElement("div");
    this.breakFill.className = "hud-break-fill";
    this.breakBar.appendChild(this.breakFill);
    this.container.appendChild(this.breakBar);

    // Objective Ribbon
    this.objectiveRibbon = document.createElement("div");
    this.objectiveRibbon.className = "hud-objective-ribbon";
    this.container.appendChild(this.objectiveRibbon);

    this.tycoonChip = document.createElement("div");
    this.tycoonChip.className = "hud-tycoon-chip";
    const createMetric = (iconPath: string, iconClass: string, valueClass: string) => {
      const group = document.createElement("span");
      group.setAttribute("role", "group");
      group.style.display = "inline-flex";
      group.style.alignItems = "center";
      group.style.gap = "4px";
      const icon = document.createElement("img");
      icon.className = iconClass;
      icon.src = iconPath;
      icon.alt = "";
      const value = document.createElement("span");
      value.className = valueClass;
      group.append(icon, value);
      return { group, value };
    };
    const stars = createMetric("/assets/ui/kenney/star.png", "hud-tycoon-stars-icon", "hud-tycoon-stars");
    const vault = createMetric("/assets/ui/icons/ore_gold.png", "hud-tycoon-vault-icon", "hud-tycoon-vault");
    const upgradeCost = createMetric(
      "/assets/ui/kenney/star.png",
      "hud-tycoon-upgrade-icon",
      "hud-tycoon-upgrade-cost"
    );
    const upgradeMark = document.createElement("span");
    upgradeMark.className = "hud-tycoon-upgrade-mark";
    upgradeMark.textContent = "↑";
    upgradeMark.setAttribute("aria-hidden", "true");
    upgradeCost.group.prepend(upgradeMark);
    this.tycoonStars = stars.value;
    this.tycoonVault = vault.value;
    this.tycoonUpgradeCost = upgradeCost.value;
    this.tycoonTier = document.createElement("span");
    this.tycoonTier.className = "hud-tycoon-tier";
    this.tycoonChip.append(stars.group, vault.group, upgradeCost.group, this.tycoonTier);
    this.container.appendChild(this.tycoonChip);

    // NPC speech bubbles (world-anchored)
    this.speechLayer = document.createElement("div");
    this.speechLayer.className = "hud-npc-speech-layer";
    this.container.appendChild(this.speechLayer);
    this.resourceGain = document.createElement("div");
    this.resourceGain.className = "hud-resource-gain";
    this.resourceGain.setAttribute("role", "status");
    this.resourceGain.setAttribute("aria-live", "polite");
    this.resourceGainIcon = document.createElement("img");
    this.resourceGainIcon.alt = "";
    this.resourceGainCount = document.createElement("span");
    this.resourceGainCount.className = "hud-resource-count";
    this.resourceGain.append(this.resourceGainIcon, this.resourceGainCount);
    this.container.appendChild(this.resourceGain);

    // Hotbar
    this.hotbar = document.createElement("div");
    this.hotbar.className = "hud-hotbar";
    this.container.appendChild(this.hotbar);
    // Split-screen mode toggle button
    this.modeBtn = document.createElement("button");
    this.modeBtn.className = "hud-mode-btn";
    this.modeBtn.textContent = "Tryb: 1 Gracz";
    this.modeBtn.addEventListener("click", () => {
      const isSplit = options.onToggleSplitScreen?.() ?? false;
      this.modeBtn.textContent = isSplit ? "Tryb: 2 Graczy (Ziemek & Gniewko)" : "Tryb: 1 Gracz";
    });
    // LAN button
    this.lanBtn = document.createElement("button");
    this.lanBtn.className = "hud-lan-btn";
    this.lanBtn.textContent = "🌐 LAN";
    this.lanBtn.addEventListener("click", () => this.toggleLanModal(options.onConnectLan));
    this.container.appendChild(this.lanBtn);

    // LAN Modal
    this.lanModal = document.createElement("div");
    this.lanModal.className = "hud-lan-modal";
    this.lanModal.innerHTML = `
      <div class="hud-modal-card hud-lan-card">
        <header class="hud-modal-header">
          <h2>Dołącz przez LAN</h2>
          <button class="hud-modal-close" aria-label="Zamknij [Esc]">✕</button>
        </header>
        <div class="hud-modal-body">
          <p>Graj wspólnie na dwóch komputerach w domowej sieci Wi-Fi.</p>
          <form class="hud-lan-form" id="lan-form">
            <label>
              Adres serwera:
              <input type="text" id="lan-url" value="ws://${typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1'}:8080/ws" />
            </label>
            <label>
              Kod pokoju:
              <input type="text" id="lan-room" value="DOM1" />
            </label>
            <div class="hud-lan-status" id="lan-status">Wpisz adres serwera uruchomionego na drugim Macu.</div>
            <button type="submit" class="hud-craft-btn">Połącz z grą</button>
          </form>
        </div>
      </div>
    `;
    this.container.appendChild(this.lanModal);

    const lanClose = this.lanModal.querySelector(".hud-modal-close");
    lanClose?.addEventListener("click", () => this.setLanModalOpen(false));
    this.container.appendChild(this.modeBtn);
    // Controls button (Xbox / Pad map)
    this.controlsBtn = document.createElement("button");
    this.controlsBtn.className = "hud-controls-btn";
    this.controlsBtn.textContent = "🎮 Pad / Xbox";
    this.controlsBtn.addEventListener("click", () => this.toggleControlsModal());
    this.container.appendChild(this.controlsBtn);
    this.inventoryBtn = document.createElement("button");
    this.inventoryBtn.type = "button";
    this.inventoryBtn.className = "hud-inventory-btn";
    this.inventoryBtn.textContent = "🎒";
    this.inventoryBtn.setAttribute("aria-label", "Ekwipunek i rzemiosło");
    this.inventoryBtn.addEventListener("mousedown", (event) => event.stopPropagation());
    this.inventoryBtn.addEventListener("touchstart", (event) => event.stopPropagation());
    this.inventoryBtn.addEventListener("click", () => this.toggleInventory(options.inventory, options.onCraft));
    this.container.appendChild(this.inventoryBtn);

    // Controls Modal
    this.controlsModal = document.createElement("div");
    this.controlsModal.className = "hud-controls-modal";
    this.controlsModal.innerHTML = `
      <div class="hud-modal-card hud-controls-card">
        <header class="hud-modal-header">
          <h2>Xbox Controller Map</h2>
          <button class="hud-modal-close" aria-label="Zamknij [Esc]">✕</button>
        </header>
        <div class="hud-modal-body">
          <div class="hud-controls-list">
            <div class="hud-control-row"><span class="hud-control-key key-rt">RT</span><span class="hud-control-val">⛏️ Mine block (with crack overlay)</span></div>
            <div class="hud-control-row"><span class="hud-control-key key-lt">LT</span><span class="hud-control-val">🧱 Place block</span></div>
            <div class="hud-control-row"><span class="hud-control-key key-a">A</span><span class="hud-control-val">🏃 Jump</span></div>
            <div class="hud-control-row"><span class="hud-control-key key-x">X</span><span class="hud-control-val">🎒 Inventory and Crafting</span></div>
            <div class="hud-control-row"><span class="hud-control-key key-y">Y / Menu</span><span class="hud-control-val">👦👦 Toggle 2-player split screen</span></div>
            <div class="hud-control-row"><span class="hud-control-key key-bump">LB / RB</span><span class="hud-control-val">⬅️ ➡️ Cycle hotbar slots</span></div>
            <div class="hud-control-row"><span class="hud-control-key key-stick">Left Stick</span><span class="hud-control-val">🕹️ Move</span></div>
            <div class="hud-control-row"><span class="hud-control-key key-stick">Right Stick</span><span class="hud-control-val">👁️ Look</span></div>
          </div>
          <div class="hud-controls-note">
            <p><strong>Xbox Series X|S:</strong> Uruchom w Microsoft Edge, naciśnij przycisk <em>View</em> (dwa kwadraciki), aby włączyć sterowanie padem.</p>
          </div>
        </div>
      </div>
    `;
    this.container.appendChild(this.controlsModal);

    const controlsClose = this.controlsModal.querySelector(".hud-modal-close");
    controlsClose?.addEventListener("click", () => this.setControlsModalOpen(false));

    // Inventory Modal
    this.inventoryModal = document.createElement("div");
    this.inventoryModal.className = "hud-inventory-modal";
    this.inventoryModal.innerHTML = `
      <div class="hud-modal-card">
        <header class="hud-modal-header">
          <h2>Ekwipunek i Rzemiosło</h2>
          <button class="hud-modal-close" aria-label="Zamknij [Esc]">✕</button>
        </header>
        <div class="hud-modal-body">
          <div class="hud-section">
            <h3>Zasoby</h3>
            <div class="hud-resources-grid"></div>
          </div>
          <div class="hud-section">
            <h3>Receptury</h3>
            <div class="hud-recipes-list"></div>
          </div>
        </div>
      </div>
    `;
    this.container.appendChild(this.inventoryModal);
    // NPC proximity prompt
    this.npcPrompt = document.createElement("div");
    this.npcPrompt.className = "hud-npc-prompt";
    this.container.appendChild(this.npcPrompt);

    // NPC Dialog Modal
    this.npcModal = document.createElement("div");
    this.npcModal.className = "hud-npc-modal";
    this.container.appendChild(this.npcModal);

    this.inventoryGrid = this.inventoryModal.querySelector(".hud-resources-grid")!;
    this.recipeList = this.inventoryModal.querySelector(".hud-recipes-list")!;

    const closeBtn = this.inventoryModal.querySelector(".hud-modal-close");
    closeBtn?.addEventListener("click", () => this.setInventoryOpen(false));

    this.renderHotbar(options.inventory);
    this.updateObjective(options.objectives);
  }
  isInventoryOpen(): boolean {
    return this.inventoryOpen;
  }

  toggleInventory(inventory: GameInventory, onCraft?: (recipeId: string) => void): boolean {
    this.setInventoryOpen(!this.inventoryOpen, inventory, onCraft);
    return this.inventoryOpen;
  }

  setInventoryOpen(open: boolean, inventory?: GameInventory, onCraft?: (recipeId: string) => void): void {
    this.inventoryOpen = open;
    this.inventoryModal.classList.toggle("hud-modal-open", open);
    if (open && inventory) {
      this.renderInventoryModal(inventory, onCraft);
    }
  }
  toggleLanModal(onConnect?: (url: string, room: string) => Promise<boolean>): void {
    this.setLanModalOpen(!this.lanModalOpen, onConnect);
  }

  setLanModalOpen(open: boolean, onConnect?: (url: string, room: string) => Promise<boolean>): void {
    this.lanModalOpen = open;
    this.lanModal.classList.toggle("hud-modal-open", open);
    if (open && onConnect) {
      const form = this.lanModal.querySelector<HTMLFormElement>("#lan-form");
      const urlInput = this.lanModal.querySelector<HTMLInputElement>("#lan-url");
      const roomInput = this.lanModal.querySelector<HTMLInputElement>("#lan-room");
      const statusEl = this.lanModal.querySelector<HTMLElement>("#lan-status");
      if (form && urlInput && roomInput && statusEl) {
        form.onsubmit = async (e) => {
          e.preventDefault();
          statusEl.textContent = "Łączenie z serwerem LAN...";
          try {
            const ok = await onConnect(urlInput.value.trim(), roomInput.value.trim());
            if (ok) {
              statusEl.textContent = "Połączono! Świat zsynchronizowany.";
              setTimeout(() => this.setLanModalOpen(false), 800);
            } else {
              statusEl.textContent = "Nie udało się połączyć. Upewnij się, że serwer działa.";
            }
          } catch {
            statusEl.textContent = "Błąd połączenia z serwerem LAN.";
          }
        };
      }
    }
  }
  toggleControlsModal(): void {
    this.setControlsModalOpen(!this.controlsModalOpen);
  }

  setControlsModalOpen(open: boolean): void {
    this.controlsModalOpen = open;
    this.controlsModal.classList.toggle("hud-modal-open", open);
  }

  isControlsModalOpen(): boolean {
    return this.controlsModalOpen;
  }

  isLanModalOpen(): boolean {
    return this.lanModalOpen;
  }
  isNpcDialogOpen(): boolean {
    return this.npcDialogOpen;
  }

  setNpcPrompt(npcName: string | null): void {
    if (!npcName) {
      this.npcPrompt.style.display = "none";
    } else {
      this.npcPrompt.style.display = "block";
      this.npcPrompt.innerHTML = `Naciśnij <kbd>[E]</kbd>, aby porozmawiać z <strong>${npcName}</strong> (mikrofon / tekst)`;
    }
  }

  openNpcDialog(options: {
    npcName: string;
    role: string;
    quickPrompts: string[];
    onSend: (text: string) => Promise<string>;
    onMicStart?: () => Promise<boolean>;
    onMicStop?: () => void;
  }): void {
    this.npcDialogOpen = true;
    this.npcModal.classList.add("hud-modal-open");

    this.npcModal.innerHTML = `
      <div class="hud-modal-card hud-npc-card">
        <header class="hud-modal-header">
          <div>
            <h2>${options.npcName}</h2>
            <span class="hud-npc-role">${options.role}</span>
          </div>
          <button class="hud-modal-close" aria-label="Zamknij [Esc]">✕</button>
        </header>
        <div class="hud-modal-body">
          <div class="hud-npc-dialog-area">
            <div class="hud-npc-bubble" id="npc-reply-bubble">Cześć! W czym mogę Ci pomóc?</div>
          </div>
          <div class="hud-npc-mic-row">
            <button class="hud-mic-btn" id="npc-mic-btn">🎙️ Mów teraz przez mikrofon</button>
            <span class="hud-mic-status" id="npc-mic-status">Gotowy do słuchania</span>
          </div>
          <div class="hud-npc-quick-prompts">
            ${options.quickPrompts.map((p) => `<button class="hud-quick-btn">${p}</button>`).join("")}
          </div>
          <form class="hud-npc-input-form" id="npc-form">
            <input type="text" class="hud-npc-input" id="npc-input" placeholder="Wpisz wiadomość lub użyj mikrofonu..." />
            <button type="submit" class="hud-craft-btn">Wyślij</button>
          </form>
          <p class="hud-npc-notice">Rozmowa z asystentem AI. Nie podawaj danych osobowych.</p>
        </div>
      </div>
    `;

    const closeBtn = this.npcModal.querySelector(".hud-modal-close");

    const replyBubble = this.npcModal.querySelector<HTMLElement>("#npc-reply-bubble")!;
    const input = this.npcModal.querySelector<HTMLInputElement>("#npc-input")!;
    const form = this.npcModal.querySelector<HTMLFormElement>("#npc-form")!;
    const micBtn = this.npcModal.querySelector<HTMLButtonElement>("#npc-mic-btn")!;
    const micStatus = this.npcModal.querySelector<HTMLElement>("#npc-mic-status")!;

    let isRecording = false;
    const updateMic = (recording: boolean, status: string): void => {
      isRecording = recording;
      micBtn.classList.toggle("recording", recording);
      micBtn.textContent = recording ? "🛑 Zatrzymaj mikrofon" : "🎙️ Mów teraz przez mikrofon";
      micStatus.textContent = status;
    };
    const startMic = async (): Promise<void> => {
      if (isRecording) return;
      const started = (await options.onMicStart?.()) ?? false;
      if (started) updateMic(true, "Słucham... Mów teraz do mikrofonu!");
      else micStatus.textContent = "Mikrofon niedostępny";
    };
    const stopMic = (): void => {
      if (!isRecording) return;
      options.onMicStop?.();
      updateMic(false, "Mikrofon zatrzymany");
    };

    closeBtn?.addEventListener("click", () => {
      stopMic();
      this.closeNpcDialog();
    });
    micBtn.addEventListener("click", () => {
      if (isRecording) stopMic();
      else void startMic();
    });
    if (options.onMicStart) {
      void startMic().then(() => {
        if (isRecording && !this.npcDialogOpen) stopMic();
      });
    }

    const send = async (text: string) => {
      if (!text.trim()) return;
      replyBubble.textContent = "Mina myśli...";
      try {
        const answer = await options.onSend(text);
        replyBubble.textContent = answer;
      } catch {
        replyBubble.textContent = "Mina chwilowo nie może odpowiedzieć. Spróbuj za chwilę!";
      }
    };

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      input.value = "";
      void send(text);
    });

    this.npcModal.querySelectorAll(".hud-quick-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        void send(btn.textContent ?? "");
      });
    });
  }

  closeNpcDialog(): void {
    this.npcDialogOpen = false;
    this.npcModal.classList.remove("hud-modal-open");
  }

  updateBreakProgress(progress: number): void {
    if (progress <= 0 || progress >= 1) {
      this.breakBar.style.display = "none";
    } else {
      this.breakBar.style.display = "block";
      this.breakFill.style.width = `${Math.min(100, Math.round(progress * 100))}%`;
    }
  }

  updateTycoon(stars: number, vaultCoins: number, tier: number, upgradeCost: number): void {
    const starText = String(stars);
    if (this.tycoonStars.textContent !== starText) {
      this.tycoonStars.textContent = starText;
      this.tycoonStars.parentElement?.setAttribute("aria-label", `Gwiazdy: ${starText}`);
    }
    const vaultText = String(vaultCoins);
    if (this.tycoonVault.textContent !== vaultText) {
      this.tycoonVault.textContent = vaultText;
      this.tycoonVault.parentElement?.setAttribute("aria-label", `Skarbiec: ${vaultText}`);
    }
    const upgradeCostText = String(upgradeCost);
    if (this.tycoonUpgradeCost.textContent !== upgradeCostText) {
      this.tycoonUpgradeCost.textContent = upgradeCostText;
      this.tycoonUpgradeCost.parentElement?.setAttribute("aria-label", `Koszt ulepszenia: ${upgradeCostText}`);
    }
    const tierText = `Poziom ${tier}`;
    if (this.tycoonTier.textContent !== tierText) this.tycoonTier.textContent = tierText;
  }

  updateObjective(objectives: ObjectiveManager): void {
    const step = objectives.currentStep;
    let starsHtml = "";
    for (let i = 0; i < step.target; i++) {
      starsHtml += `<span class="hud-star ${i < step.progress ? "active" : ""}">★</span>`;
    }
    const iconMap: Record<string, string> = {
      gather_wood: "/assets/textures/tiles/oak_log_side.png",
      craft_planks: "/assets/textures/tiles/oak_planks.png",
      craft_sticks: "/assets/textures/tiles/oak_planks.png",
      find_stone: "/assets/textures/tiles/cobblestone.png",
      craft_tool: "/assets/ui/icons/pick_iron.png",
      build_house: "/assets/textures/tiles/oak_planks.png",
      all_complete: "/assets/ui/kenney/star.png",
    };
    const icon = iconMap[step.id] ?? "/assets/ui/kenney/star.png";
    this.objectiveRibbon.innerHTML = `
      <img class="hud-objective-icon" src="${icon}" alt="" />
      <div class="hud-ribbon-stars">${starsHtml}</div>
    `;
  }

  renderHotbar(inventory: GameInventory): void {
    this.hotbar.innerHTML = "";
    inventory.hotbar.forEach((blockId, index) => {
      const slot = document.createElement("div");
      slot.className = `hud-hotbar-slot ${index === inventory.activeSlot ? "active" : ""}`;
      const def = BLOCK_BY_ID[blockId as BlockId];
      const tileName = def?.tiles.top ?? def?.tiles.side ?? "dirt";
      slot.innerHTML = `
        <span class="hud-slot-num">${index + 1}</span>
        <img class="hud-slot-icon" src="/assets/textures/tiles/${tileName}.png" alt="" />
        <span class="hud-slot-name">${def?.name ?? "Blok"}</span>
      `;
      slot.addEventListener("click", () => {
        inventory.selectSlot(index);
        this.renderHotbar(inventory);
      });
      this.hotbar.appendChild(slot);
    });
  }

  renderInventoryModal(inventory: GameInventory, onCraft?: (recipeId: string) => void): void {
    const state = inventory.toState();

    // Resources
    this.inventoryGrid.innerHTML = "";
    const allEntries = [
      ...Object.entries(state.blocks).map(([k, v]) => ({ key: k, count: v, type: "block" })),
      ...Object.entries(state.items).map(([k, v]) => ({ key: k, count: v, type: "item" })),
    ].filter((e) => e.count > 0);

    if (allEntries.length === 0) {
      this.inventoryGrid.innerHTML = `<p class="hud-empty">Brak zebranych zasobów. Pokop trochę drzew lub kamienia!</p>`;
    } else {
      allEntries.forEach((entry) => {
        const itemEl = document.createElement("div");
        itemEl.className = "hud-inv-item";
        itemEl.innerHTML = `
          <img class="hud-inv-item-icon" src="${getItemIcon(entry.key)}" alt="" />
          <span class="hud-inv-val">×${entry.count}</span>
        `;
        this.inventoryGrid.appendChild(itemEl);
      });
    }

    // Recipes
    this.recipeList.innerHTML = "";
    RECIPES.forEach((recipe) => {
      const recipeEl = document.createElement("div");
      recipeEl.className = "hud-recipe-row";

      const costIcons = Object.entries(recipe.cost)
        .map(([mat, count]) => `
          <div class="hud-cost-item">
            <img class="hud-recipe-icon" src="${getItemIcon(mat)}" alt="" />
            <span class="hud-cost-count">×${count}</span>
          </div>
        `)
        .join('<span class="hud-op">+</span>');

      const affordable = canCraft(state, recipe.id);

      recipeEl.innerHTML = `
        <div class="hud-recipe-visual-equation">
          <div class="hud-recipe-cost-group">${costIcons}</div>
          <span class="hud-arrow">➔</span>
          <div class="hud-recipe-output-group">
            <img class="hud-recipe-icon" src="${getItemIcon(recipe.output.item)}" alt="" />
            <span class="hud-output-count">×${recipe.output.count}</span>
          </div>
        </div>
        <button class="hud-craft-btn ${affordable ? "can-craft" : "disabled"}" data-id="${recipe.id}">
          🔨 Rób
        </button>
      `;

      const btn = recipeEl.querySelector<HTMLButtonElement>(".hud-craft-btn")!;
      btn.addEventListener("click", () => {
        const ok = craftRecipe(state, recipe.id);
        if (ok) {
          inventory.applyState(state);
          onCraft?.(recipe.id);
          this.renderInventoryModal(inventory, onCraft);
          this.renderHotbar(inventory);
        }
      });

      this.recipeList.appendChild(recipeEl);
    });
  }

  showNpcSpeech(npcId: string, name: string, text: string, durationSec = 5): void {
    let bubble = this.speechBubbles.get(npcId);
    if (!bubble) {
      const el = document.createElement("div");
      el.className = "hud-npc-speech";
      const nameEl = document.createElement("span");
      nameEl.className = "hud-npc-speech-name";
      const textEl = document.createElement("span");
      textEl.className = "hud-npc-speech-text";
      el.append(nameEl, textEl);
      this.speechLayer.appendChild(el);
      bubble = { el, nameEl, textEl, until: 0 };
      this.speechBubbles.set(npcId, bubble);
    }
    bubble.nameEl.textContent = `${name}:`;
    bubble.textEl.textContent = text;
    bubble.until = performance.now() / 1000 + durationSec;
  }

  updateNpcSpeech(
    project: (npcId: string) => { x: number; y: number; visible: boolean } | null
  ): void {
    const now = performance.now() / 1000;
    for (const [npcId, bubble] of this.speechBubbles) {
      if (now >= bubble.until) {
        bubble.el.classList.remove("visible");
        continue;
      }
      const pos = project(npcId);
      if (!pos || !pos.visible) {
        bubble.el.classList.remove("visible");
        continue;
      }
      bubble.el.style.left = `${pos.x}px`;
      bubble.el.style.top = `${pos.y}px`;
      bubble.el.classList.add("visible");
    }
  }
  showResourceGain(itemKey: string, count: number, position: { x: number; y: number }, durationSec = 1.2): void {
    if (!Number.isInteger(count) || count <= 0) return;
    this.resourceGainIcon.src = getItemIcon(itemKey);
    this.resourceGainCount.textContent = `+${count}`;
    this.resourceGain.style.left = `${position.x}px`;
    this.resourceGain.style.top = `${position.y}px`;
    this.resourceGainUntil = performance.now() / 1000 + durationSec;
    this.resourceGain.classList.remove("visible");
    void this.resourceGain.offsetWidth;
    this.resourceGain.classList.add("visible");
  }

  updateResourceGain(): void {
    if (this.resourceGainUntil && performance.now() / 1000 >= this.resourceGainUntil) {
      this.resourceGainUntil = 0;
      this.resourceGain.classList.remove("visible");
    }
  }
}
