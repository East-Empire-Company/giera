import { BLOCK_ID } from "../../shared/blocks";

export type RecipeCost = Record<string, number>;

export type RecipeDef = {
  id: string;
  name: string;
  description: string;
  cost: RecipeCost;
  output: {
    item: string;
    count: number;
  };
  toolBonus?: {
    material: "wood" | "stone" | "iron" | "combat";
    speedMultiplier: number;
  };
};

export type InventoryState = {
  blocks: Record<string, number>;
  items: Record<string, number>;
};

export const RECIPES: RecipeDef[] = [
  {
    id: "stick",
    name: "Patyk",
    description: "Podstawowy materiał rzemieślniczy do narzędzi",
    cost: { oak_log: 3 },
    output: { item: "stick", count: 4 },
  },
  {
    id: "planks",
    name: "Deska",
    description: "Gładkie deski budowlane",
    cost: { oak_log: 4 },
    output: { item: "planks", count: 4 },
  },
  {
    id: "wooden_pickaxe",
    name: "Drewniany Kilof",
    description: "Podstawowy kilof do wydobywania kamienia",
    cost: { stick: 2, planks: 3 },
    output: { item: "wooden_pickaxe", count: 1 },
    toolBonus: { material: "stone", speedMultiplier: 1.8 },
  },
  {
    id: "wooden_sword",
    name: "Drewniany Miecz",
    description: "Lekka broń do ćwiczeń na kukle (2x mocniejszy cios)",
    cost: { stick: 1, planks: 2 },
    output: { item: "wooden_sword", count: 1 },
    toolBonus: { material: "combat", speedMultiplier: 2 },
  },
  {
    id: "stone_pickaxe",
    name: "Kamienny Kilof",
    description: "Kopanie kamienia i węgla szybciej",
    cost: { stick: 2, cobblestone: 3 },
    output: { item: "stone_pickaxe", count: 1 },
    toolBonus: { material: "stone", speedMultiplier: 2.5 },
  },
  {
    id: "stone_axe",
    name: "Kamienny Toporek",
    description: "Kopanie drewna 3x szybciej",
    cost: { stick: 2, cobblestone: 3 },
    output: { item: "stone_axe", count: 1 },
    toolBonus: { material: "wood", speedMultiplier: 3 },
  },
  {
    id: "iron_pickaxe",
    name: "Żelazny Kilof",
    description: "Kopanie kamienia i rudy 3x szybciej",
    cost: { stick: 2, iron_ore: 3 },
    output: { item: "iron_pickaxe", count: 1 },
    toolBonus: { material: "stone", speedMultiplier: 3.5 },
  },
  {
    id: "iron_axe",
    name: "Żelazny Topór",
    description: "Ścinanie drzew 4x szybciej",
    cost: { stick: 2, iron_ore: 3 },
    output: { item: "iron_axe", count: 1 },
    toolBonus: { material: "wood", speedMultiplier: 4 },
  },
  {
    id: "iron_sword",
    name: "Żelazny Miecz",
    description: "Mocny miecz do zabawy i pojedynków z kukłą (3.5x mocniejszy cios)",
    cost: { stick: 1, iron_ore: 2 },
    output: { item: "iron_sword", count: 1 },
    toolBonus: { material: "combat", speedMultiplier: 3.5 },
  },
  {
    id: "tnt",
    name: "TNT",
    description: "Ładunek wybuchowy: postaw i podpal lewym przyciskiem",
    cost: { planks: 4, coal_ore: 1 },
    output: { item: "tnt", count: 3 },
  },
];

export function getResourceCount(inv: InventoryState, key: string): number {
  return (inv.blocks[key] ?? 0) + (inv.items[key] ?? 0);
}

export function canCraft(inv: InventoryState, recipeId: string): boolean {
  const recipe = RECIPES.find((r) => r.id === recipeId);
  if (!recipe) return false;
  for (const [key, needed] of Object.entries(recipe.cost)) {
    if (getResourceCount(inv, key) < needed) return false;
  }
  return true;
}

export function craftRecipe(inv: InventoryState, recipeId: string): boolean {
  if (!canCraft(inv, recipeId)) return false;
  const recipe = RECIPES.find((r) => r.id === recipeId)!;
  for (const [key, needed] of Object.entries(recipe.cost)) {
    let remaining = needed;
    const fromBlocks = Math.min(inv.blocks[key] ?? 0, remaining);
    if (fromBlocks > 0) {
      inv.blocks[key] -= fromBlocks;
      remaining -= fromBlocks;
    }
    if (remaining > 0) {
      inv.items[key] = (inv.items[key] ?? 0) - remaining;
    }
  }

  const { item, count } = recipe.output;
  if (Object.hasOwn(BLOCK_ID, item)) {
    inv.blocks[item] = (inv.blocks[item] ?? 0) + count;
  } else {
    inv.items[item] = (inv.items[item] ?? 0) + count;
  }
  return true;
}
