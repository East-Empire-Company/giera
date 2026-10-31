export const NPC_FALLBACK_LINES: Record<string, readonly string[]> = {
  mina: [
    "Chętnie pokażę Ci drogę!",
    "Zbierz trochę drewna, to dobry początek.",
    "Na północy rośnie więcej drzew.",
    "Polana to najlepsze miejsce na start.",
    "Papuga wie, gdzie szukać skarbów!",
    "Rozbij blok, a zobaczysz, co w środku.",
    "Spokojnie, mamy dużo czasu.",
    "Tańce i przygody? Jedno i drugie!",
    "Staszek pokaże Ci, co zrobić z deskami.",
    "Woda jest na wschodzie, blisko stawu.",
  ],
  staszek: [
    "Hmmm... najlepsze deski robi się z drewna.",
    "Zrób kilof, to porządne narzędzie.",
    "Hmmm... potrzebujesz kijka i kamienia.",
    "Rzemiosło to cierpliwość i dobre drewno.",
    "Najpierw drewno, potem narzędzia.",
    "Hmmm... leśne drewno jest najlepsze.",
    "Zanim zbudujesz domek, zbierz kamień.",
    "Solidna robota zaczyna się od porządnych desek.",
    "Młotek? Najpierw musisz go mieć!",
    "Deski z lasu? Proszę bardzo!",
  ],
  papuga: [
    "Rrrrr! Świeżo, świeżo!",
    "Papuga mówi: hej!",
    "Rrrr! Lećmy!",
    "Co tam, Ziemku?",
    "Papuga wie, gdzie drzewa!",
    "Rrrrr, świeży skarb!",
    "Ptaszek już wie!",
    "Grrr! Ładnie tu!",
  ],
  default: [
    "Słyszę Cię! Wspaniale, że jesteś!",
    "Zawsze miło Cię widzieć!",
    "Razem damy radę!",
    "Chętnie pomogę!",
  ],
};

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function fallbackLine(npcId: string, seedText: string): string {
  const lines = NPC_FALLBACK_LINES[npcId] ?? NPC_FALLBACK_LINES.default;
  return lines[hash(`${npcId}:${seedText}`) % lines.length];
}

export function fallbackReplyContent(npcId: string, seedText: string): string {
  return JSON.stringify({ say: fallbackLine(npcId, seedText), tool: null, walk_to: null });
}
