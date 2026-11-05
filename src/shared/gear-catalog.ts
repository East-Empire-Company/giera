export type GearBonus = {
  material: "wood" | "stone" | "iron" | "combat";
  speedMultiplier: number;
};

export type GearDefinition = {
  item: string;
  name: string;
  type: "Narzędzie" | "Broń";
  bonus: GearBonus;
};

export const GEAR_CATALOG: readonly GearDefinition[] = [
  { item: "wooden_pickaxe", name: "Drewniany Kilof", type: "Narzędzie", bonus: { material: "stone", speedMultiplier: 1.8 } },
  { item: "wooden_sword", name: "Drewniany Miecz", type: "Broń", bonus: { material: "combat", speedMultiplier: 2 } },
  { item: "stone_pickaxe", name: "Kamienny Kilof", type: "Narzędzie", bonus: { material: "stone", speedMultiplier: 2.5 } },
  { item: "stone_axe", name: "Kamienny Toporek", type: "Narzędzie", bonus: { material: "wood", speedMultiplier: 3 } },
  { item: "iron_pickaxe", name: "Żelazny Kilof", type: "Narzędzie", bonus: { material: "stone", speedMultiplier: 3.5 } },
  { item: "iron_axe", name: "Żelazny Topór", type: "Narzędzie", bonus: { material: "wood", speedMultiplier: 4 } },
  { item: "iron_sword", name: "Żelazny Miecz", type: "Broń", bonus: { material: "combat", speedMultiplier: 3.5 } },
  { item: "star_pickaxe", name: "Gwiezdny Kilof", type: "Narzędzie", bonus: { material: "stone", speedMultiplier: 5 } },
  { item: "star_axe", name: "Gwiezdny Topór", type: "Narzędzie", bonus: { material: "wood", speedMultiplier: 5 } },
  { item: "pulse_sword", name: "Miecz Pulsujący", type: "Broń", bonus: { material: "combat", speedMultiplier: 4.5 } },
];

export function gearBonus(item: string): GearBonus | undefined {
  return GEAR_CATALOG.find((gear) => gear.item === item)?.bonus;
}
