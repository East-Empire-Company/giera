import type { LanServerSummary } from "../../shared/lan-protocol";

export type LanMenuCallbacks = {
  onHost: (roomName: string, seed: number) => Promise<boolean>;
  onJoin: (url: string, room: string, seed: number) => Promise<boolean>;
  onScan: () => Promise<LanServerSummary[]>;
  onClose: () => void;
};

export class LanMenuController {
  private readonly root: HTMLElement;
  private readonly callbacks: LanMenuCallbacks;
  private open = false;
  private statusRevision = 0;

  constructor(options: { root: HTMLElement } & LanMenuCallbacks) {
    this.root = options.root;
    this.callbacks = {
      onHost: options.onHost,
      onJoin: options.onJoin,
      onScan: options.onScan,
      onClose: options.onClose,
    };
  }

  get isOpen(): boolean {
    return this.open;
  }

  openMenu(): void {
    if (this.open) return;
    this.open = true;
    this.root.hidden = false;
    this.showChoice();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    this.root.innerHTML = "";
    this.callbacks.onClose();
  }

  showChoice(): void {
    this.root.innerHTML = "";

    const card = document.createElement("div");
    card.className = "lan-panel-card";

    const header = document.createElement("h2");
    header.textContent = "🌐 Gra przez LAN";
    card.appendChild(header);

    const hostBtn = document.createElement("button");
    hostBtn.type = "button";
    hostBtn.className = "launch-mode";
    hostBtn.textContent = "🏠 Załóż nową grę";
    hostBtn.addEventListener("click", () => this.showHost());
    card.appendChild(hostBtn);

    const joinBtn = document.createElement("button");
    joinBtn.type = "button";
    joinBtn.className = "launch-mode";
    joinBtn.textContent = "🔍 Dołącz do gry";
    joinBtn.addEventListener("click", () => this.showJoin());
    card.appendChild(joinBtn);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "launch-mode";
    closeBtn.textContent = "✕ Zamknij";
    closeBtn.addEventListener("click", () => this.close());
    card.appendChild(closeBtn);

    this.root.appendChild(card);
  }

  showHost(): void {
    this.root.innerHTML = "";

    const card = document.createElement("div");
    card.className = "lan-panel-card";

    const header = document.createElement("h2");
    header.textContent = "🏠 Załóż grę";
    card.appendChild(header);

    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Nazwa pokoju:";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.id = "lan-host-name";
    nameInput.maxLength = 32;
    nameInput.value = "Dom";
    nameLabel.appendChild(nameInput);
    card.appendChild(nameLabel);

    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.className = "launch-mode";
    createBtn.textContent = "✅ Utwórz";
    createBtn.addEventListener("click", async () => {
      const roomName = nameInput.value.trim() || "Dom";
      this.setStatus("Tworzenie pokoju...");
      const seed = this.readLocalSeed();
      const ok = await this.callbacks.onHost(roomName, seed);
      if (ok) {
        this.setStatus("Połączono! Pokój utworzony.");
      } else {
        this.setStatus("Nie udało się utworzyć pokoju.");
      }
    });
    card.appendChild(createBtn);

    const status = document.createElement("div");
    status.className = "lan-status";
    status.id = "lan-status";
    card.appendChild(status);

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "launch-mode";
    backBtn.textContent = "← Wróć";
    backBtn.addEventListener("click", () => this.showChoice());
    card.appendChild(backBtn);

    this.root.appendChild(card);
  }

  showJoin(): void {
    this.root.innerHTML = "";

    const card = document.createElement("div");
    card.className = "lan-panel-card";

    const header = document.createElement("h2");
    header.textContent = "🔍 Dołącz do gry";
    card.appendChild(header);

    const scanBtn = document.createElement("button");
    scanBtn.type = "button";
    scanBtn.className = "launch-mode";
    scanBtn.textContent = "🔄 Szukaj serwerów";
    scanBtn.addEventListener("click", () => this.runScan());
    card.appendChild(scanBtn);

    const list = document.createElement("div");
    list.className = "lan-server-list";
    list.id = "lan-server-list";
    card.appendChild(list);

    const status = document.createElement("div");
    status.className = "lan-status";
    status.id = "lan-status";
    card.appendChild(status);

    const manualHeader = document.createElement("p");
    manualHeader.textContent = "Lub wpisz adres ręcznie:";
    manualHeader.style.color = "#654b32";
    card.appendChild(manualHeader);

    const manualForm = document.createElement("div");
    manualForm.className = "lan-manual-form";

    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.id = "lan-manual-url";
    urlInput.placeholder = "ws://adres:port/ws";
    manualForm.appendChild(urlInput);

    const roomInput = document.createElement("input");
    roomInput.type = "text";
    roomInput.id = "lan-manual-room";
    roomInput.placeholder = "KOD POKOJU";
    roomInput.value = "DOM1";
    manualForm.appendChild(roomInput);

    const connectBtn = document.createElement("button");
    connectBtn.type = "button";
    connectBtn.className = "launch-mode";
    connectBtn.textContent = "✅ Połącz";
    connectBtn.addEventListener("click", async () => {
      const url = urlInput.value.trim();
      const room = roomInput.value.trim() || "DOM1";
      if (!url) {
        this.setStatus("Wpisz adres serwera.");
        return;
      }
      this.setStatus("Łączenie...");
      const ok = await this.callbacks.onJoin(url, room, 0);
      if (ok) {
        this.setStatus("Połączono");
      } else {
        this.setStatus("Nie udało się połączyć.");
      }
    });
    manualForm.appendChild(connectBtn);

    card.appendChild(manualForm);

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "launch-mode";
    backBtn.textContent = "← Wróć";
    backBtn.addEventListener("click", () => this.showChoice());
    card.appendChild(backBtn);

    this.root.appendChild(card);

    this.runScan();
  }

  renderServers(servers: LanServerSummary[]): void {
    const list = this.root.querySelector<HTMLElement>("#lan-server-list");
    if (!list) return;
    list.innerHTML = "";

    if (servers.length === 0) {
      list.textContent = "Brak serwerów. Spróbuj wpisać adres ręcznie.";
      return;
    }

    for (const server of servers) {
      for (const room of server.rooms) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "lan-room-card";

        const nameEl = document.createElement("div");
        nameEl.className = "lan-room-card-name";
        nameEl.textContent = room.name || room.code;
        card.appendChild(nameEl);

        const metaEl = document.createElement("div");
        metaEl.className = "lan-room-card-meta";
        metaEl.textContent = `${server.host} · ${room.players} gracz(y)`;
        card.appendChild(metaEl);

        card.addEventListener("click", async () => {
          const url = `ws://${server.ip}:${server.port}/ws`;
          this.setStatus("Łączenie...");
          const ok = await this.callbacks.onJoin(url, room.code, room.seed);
          if (ok) {
            this.setStatus("Połączono");
          } else {
            this.setStatus("Nie udało się połączyć.");
          }
        });

        list.appendChild(card);
      }
    }
  }

  setStatus(text: string): void {
    this.statusRevision++;
    const el = this.root.querySelector<HTMLElement>("#lan-status");
    if (el) el.textContent = text;
  }

  private async runScan(): Promise<void> {
    this.setStatus("Skanowanie sieci...");
    const revision = this.statusRevision;
    try {
      const servers = await this.callbacks.onScan();
      this.renderServers(servers);
      if (revision === this.statusRevision) this.setStatus(servers.length > 0 ? "" : "Brak serwerów w sieci LAN.");
    } catch {
      if (revision === this.statusRevision) this.setStatus("Błąd skanowania sieci.");
    }
  }

  private readLocalSeed(): number {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("seed");
    if (raw) {
      const n = Number(raw);
      if (Number.isInteger(n)) return n;
    }
    return 0;
  }
}
