import * as THREE from "three";
import "./style.css";
import { AudioManager } from "./client/audio/sound";
import { MicController } from "./client/audio/mic";
import { LanClient } from "./client/net/client";
import { PlayerController } from "./client/entities/player";
import { NPCManager } from "./client/entities/npc";
import { ItemDropManager } from "./client/entities/drops";
import { TrainingDummy } from "./client/entities/dummy";
import { applyHeroDetails } from "./client/entities/hero-details";
import { GameHUD } from "./client/game/hud";
import { GameInventory } from "./client/game/inventory";
import { ObjectiveManager } from "./client/game/objectives";
import { TycoonManager } from "./client/game/tycoon";
import { TouchController } from "./client/input/touch";
import { loadGameState, saveGameState } from "./client/persist/db";
import { createRenderer, loadRenderAssets, SkyCycle } from "./client/render/renderer";
import { getSplitViewports, SplitScreenManager } from "./client/render/split-screen";
import { WorldRenderer } from "./client/render/worldRenderer";
import { resolveWorldSeed } from "./client/startup/world-seed";
import { BLOCK_BY_ID, BLOCK_ID, type BlockId } from "./shared/blocks";
import { chunkKey } from "./shared/chunk";
import { raycastVoxels } from "./shared/raycast";
import { makeRng } from "./shared/rng";
import { surfaceHeight } from "./shared/worldgen";

type GameStats = { fps: number; drawCalls: number; chunkCount: number };
type GameBridge = {
  ready: boolean;
  seed: number;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  camera2?: THREE.PerspectiveCamera;
  world: WorldRenderer;
  player: PlayerController;
  player2?: PlayerController;
  inventory: GameInventory;
  objectives: ObjectiveManager;
  splitScreen: SplitScreenManager;
  npcManager: NPCManager;
  mic: MicController;
  audio: AudioManager;
  stats: GameStats;
  tycoon: TycoonManager;
  detailedAvatars: { ready: boolean; p1: boolean; p2: boolean };
  qa?: { simTime: number; frame: number; events: { ev: string; id?: string; t: number }[] };
};
declare global {
  interface Window {
    __GIERA__?: GameBridge;
  }
}

const canvasElement = document.querySelector<HTMLCanvasElement>("#game");
const statusElement = document.querySelector<HTMLElement>("#boot-status");
const messageElement = document.querySelector<HTMLElement>("#boot-message");
const progressElement = document.querySelector<HTMLElement>("#boot-progress");
if (!canvasElement || !statusElement || !messageElement || !progressElement) {
  throw new Error("Giera startup elements are missing");
}
const canvas: HTMLCanvasElement = canvasElement;
const status: HTMLElement = statusElement;
const message: HTMLElement = messageElement;
const progress: HTMLElement = progressElement;
const qa = new URLSearchParams(window.location.search).get("qa") === "1";
const INTERACT_REACH = 12;

function chooseSeed(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return resolveWorldSeed(window.location.search, value[0] & 0x7fffffff);
}

function updateSeedUrl(seed: number): void {
  const url = new URL(window.location.href);
  if (url.searchParams.has("seed")) return;
  url.searchParams.set("seed", String(seed));
  history.replaceState(null, "", url);
}

function showBootError(error: unknown): void {
  const statusEl = document.querySelector<HTMLElement>("#boot-status");
  const msgEl = document.querySelector<HTMLElement>("#boot-message");
  if (statusEl && msgEl) {
    statusEl.classList.add("boot-error");
    msgEl.textContent = "Nie udało się przygotować świata. Odśwież stronę, aby spróbować ponownie.";
  }
  console.error(error);
}

async function boot(): Promise<void> {
  const saved = await loadGameState();
  const seed = new URLSearchParams(window.location.search).has("seed")
    ? chooseSeed()
    : saved?.seed ?? chooseSeed();
  updateSeedUrl(seed);
  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 256);
  const camera2 = new THREE.PerspectiveCamera(68, (window.innerWidth / 2) / window.innerHeight, 0.1, 256);
  const stats: GameStats = { fps: 0, drawCalls: 0, chunkCount: 0 };
  const assets = await loadRenderAssets();
  let lanClient: LanClient | null = null;
  const crackTexture = new THREE.TextureLoader().load("/assets/textures/crackover.png");
  crackTexture.magFilter = THREE.NearestFilter;
  const crackMaterial = new THREE.MeshBasicMaterial({
    map: crackTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), crackMaterial);
  crackMesh.visible = false;
  scene.add(crackMesh);
  const itemDrops = new ItemDropManager({ scene, rng: makeRng(1337) });

  // Sunny clearing spawn away from tree trunks
  const spawnY = surfaceHeight(3, 5, seed) + 1;
  const player = new PlayerController({ id: "p1", spawn: [3, spawnY, 5] });
  const avatar = player.loadAvatar();
  scene.add(avatar.object);

  const player2 = new PlayerController({ id: "p2", spawn: [4.5, spawnY, 5] });
  const avatar2 = player2.loadAvatar();
  scene.add(avatar2.object);

  const detailedAvatars = { ready: false, p1: false, p2: false };
  void Promise.all([
    player.loadDetailedAvatar().then((avatar) => {
      if (avatar) {
        applyHeroDetails(avatar.object, "ziemek");
        scene.add(avatar.object);
        detailedAvatars.p1 = true;
      }
    }),
    player2.loadDetailedAvatar().then((avatar) => {
      if (avatar) {
        applyHeroDetails(avatar.object, "gniewko");
        scene.add(avatar.object);
        detailedAvatars.p2 = true;
      }
    }),
  ]).finally(() => {
    detailedAvatars.ready = true;
  });

  const dummyY = surfaceHeight(1.5, 3, seed);
  const trainingDummy = new TrainingDummy({ x: 1.5, y: dummyY, z: 3 });
  scene.add(trainingDummy.object);

  const tycoonY = surfaceHeight(-3, 7, seed);
  const tycoon = new TycoonManager({ x: -3, y: tycoonY, z: 7 }, scene);

  const playlist = [
    { id: "drift_phonk", name: "Drift Phonk" },
    { id: "sigma_protocol", name: "Sigma Phonk" },
    { id: "combat_phonk", name: "Combat Phonk" },
    { id: "adventure_island", name: "Adventure" },
    { id: "little_farm", name: "Little Farm" },
  ];
  let currentTrackIndex = 0;
  const splitScreen = new SplitScreenManager(false);
  const inventory = saved?.inventory
    ? GameInventory.fromJSON(saved.inventory)
    : new GameInventory({ creative: true });
  const objectives = new ObjectiveManager();
  const npcManager = new NPCManager();
  await npcManager.spawnInScene(scene, (x: number, z: number) => surfaceHeight(x, z, seed));

  const mic = new MicController({
    lang: "pl-PL",
    onSpeech: (text) => {
      const inputEl = document.querySelector<HTMLInputElement>("#npc-input");
      if (inputEl) inputEl.value = text;
      const formEl = document.querySelector<HTMLFormElement>("#npc-form");
      formEl?.dispatchEvent(new Event("submit", { cancelable: true }));
    },
  });

  const touch = new TouchController();

  const tryPlaceBlock = (): void => {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const hit = raycastVoxels(camera.position, dir, INTERACT_REACH, (x, y, z) => world.getBlock(x, y, z));
    if (hit && hit.distance > 0) {
      const placeX = hit.hit.x + hit.normal.x;
      const placeY = hit.hit.y + hit.normal.y;
      const placeZ = hit.hit.z + hit.normal.z;

      const pBox = player.getBoundingBox();
      const blockCollides =
        placeX + 1 > pBox.minX &&
        placeX < pBox.maxX &&
        placeY + 1 > pBox.minY &&
        placeY < pBox.maxY &&
        placeZ + 1 > pBox.minZ &&
        placeZ < pBox.maxZ;

      const activeBlock = inventory.activeBlockId;
      const cx = Math.floor(placeX / 16);
      const cz = Math.floor(placeZ / 16);
      const cKey = chunkKey(cx, 0, cz);

      if (!blockCollides && inventory.canEditChunk(cKey)) {
        world.setBlock(placeX, placeY, placeZ, activeBlock);
        inventory.recordChunkEdit(cKey);
        lanClient?.sendBlockEdit(placeX, placeY, placeZ, activeBlock);
        audio.play("place_block");
        if (objectives.recordAction("build_house", 1)) {
          audio.play("objective_done");
          audio.play("celebrate_win");
        }
        hud.updateObjective(objectives);
      }
    }
  };

  if (typeof window !== "undefined" && ("ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0)) {
    touch.attachDOM(document.body, () => hud.toggleInventory(inventory), tryPlaceBlock);
  }
  const world = new WorldRenderer({
    scene,
    seed,
    atlasTexture: assets.atlas,
    waterNormal: assets.waterNormal,
    onProgress: (loaded, total) => {
      progress.style.width = `${Math.min(100, (loaded / total) * 100)}%`;
      message.textContent = `Ładujemy świat: ${loaded} / ${total}`;
    },
  });

  const sky = new SkyCycle(scene, assets);
  const audio = new AudioManager();
  const qaState = { simTime: 0, frame: 0, events: [] as { ev: string; id?: string; t: number }[] };
  if (qa) {
    const origPlay = audio.play.bind(audio);
    const origPlayMusic = audio.playMusic.bind(audio);
    audio.play = (id: string, options: { volume?: number; rate?: number } = {}) => {
      qaState.events.push({ ev: "play", id, t: qaState.simTime });
      return origPlay(id, options);
    };
    audio.playMusic = (id: string) => {
      qaState.events.push({ ev: "playMusic", id, t: qaState.simTime });
      return origPlayMusic(id);
    };
  }

  const hud = new GameHUD({
    inventory,
    objectives,
    onCraft: (recipeId) => {
      audio.play("craft_ok");
      if (recipeId === "planks") {
        if (objectives.recordAction("craft_planks", 4)) {
          audio.play("objective_done");
          audio.play("celebrate_collect");
        }
      } else if (recipeId === "stick") {
        if (objectives.recordAction("craft_sticks", 4)) {
          audio.play("objective_done");
          audio.play("celebrate_collect");
        }
      } else if (recipeId === "stone_axe" || recipeId === "iron_pickaxe" || recipeId === "iron_sword") {
        if (objectives.recordAction("craft_tool", 1)) {
          audio.play("objective_done");
          audio.play("celebrate_win");
        }
      }
      hud.updateObjective(objectives);
    },
    onToggleSplitScreen: () => {
      const isSplit = splitScreen.toggle();
      audio.play("ui_open");
      if (isSplit) {
        audio.play("cinematic_ziemek_ready");
        setTimeout(() => audio.play("cinematic_gniewko_ready"), 1200);
      }
      return isSplit;
    },
    onConnectLan: async (url, room) => {
      lanClient?.disconnect();
      return new Promise<boolean>((resolve) => {
        lanClient = new LanClient({
          url,
          room,
          playerName: player.profile.name,
          callbacks: {
            onWelcome: () => resolve(true),
            onBlock: (b) => {
              world.setBlock(b.x, b.y, b.z, b.id);
            },
            onPlayer: (p) => {
              player2.position.set(p.x, p.y, p.z);
              player2.yaw = p.yaw;
              player2.pitch = p.pitch;
              player2.syncAvatar();
            },
          },
        });
        lanClient.connect();
        setTimeout(() => resolve(false), 4000);
      });
    },
    onCycleMusic: () => {
      currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
      const track = playlist[currentTrackIndex];
      audio.playMusic(track.id).catch(() => {});
      return track.name;
    },
  });

  window.__GIERA__ = {
    ready: false,
    seed,
    renderer,
    scene,
    camera,
    camera2,
    world,
    player,
    player2,
    inventory,
    objectives,
    splitScreen,
    npcManager,
    mic,
    audio,
    stats,
    tycoon,
    detailedAvatars,
    qa: qa ? qaState : undefined,
  };

  await world.loadArea(0, 0, 2);
  status.classList.add("boot-ready");
  window.__GIERA__.ready = true;
  void world.loadArea(0, 0, 8).catch(showBootError);

  // Input states
  const keys = new Set<string>();
  let isMining = false;
  let miningBlock: { x: number; y: number; z: number; id: number } | null = null;
  let miningProgress = 0;

  window.addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (e.code === "KeyI") {
      const open = hud.toggleInventory(inventory, (recId) => {
        audio.play("craft_ok");
      });
      audio.play(open ? "ui_open" : "ui_click");
    } else if (e.code === "KeyE") {
      const nearest = npcManager.getNearestNPC(player.position.x, player.position.y, player.position.z, 3.0);
      if (nearest && !hud.isNpcDialogOpen()) {
        audio.play("npc_chat_pop");
        hud.openNpcDialog({
          npcName: nearest.def.name,
          role: nearest.def.role,
          quickPrompts: nearest.def.quickPrompts,
          onSend: async (text) => {
            return `${nearest.def.name}: Słyszę Cię! "${text}". Wspaniale, że jesteś!`;
          },
          onMicStart: () => mic.start(),
          onMicStop: () => mic.stop(),
        });
      }
    } else if (e.code === "Escape") {
      if (hud.isNpcDialogOpen()) {
        hud.closeNpcDialog();
        mic.stop();
      } else {
        hud.setInventoryOpen(false);
      }
      audio.play("ui_click");
    } else if (e.code.startsWith("Digit")) {
      const num = Number(e.code.replace("Digit", ""));
      if (num >= 1 && num <= 9) {
        inventory.selectSlot(num - 1);
        hud.renderHotbar(inventory);
        audio.play("ui_click", { volume: 0.4 });
      }
    }
  });

  window.addEventListener("keyup", (e) => {
    keys.delete(e.code);
  });

  canvas.addEventListener("click", () => {
    audio.playMusic(playlist[currentTrackIndex].id).catch(() => {});
    if (!document.pointerLockElement) {
      canvas.requestPointerLock().catch(() => {});
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === canvas) {
      player.rotateCamera(e.movementX * 0.0025, e.movementY * 0.0025);
    }
  });
  window.addEventListener("wheel", (e) => {
    inventory.cycleSlot(Math.sign(e.deltaY));
    hud.renderHotbar(inventory);
  });

  window.addEventListener("mousedown", (e) => {
    if (hud.isInventoryOpen()) return;
    if (e.button === 0) {
      isMining = true;
    } else if (e.button === 2) {
      e.preventDefault();
      tryPlaceBlock();
    }
  });

  const triggerSave = (): void => {
    void saveGameState({
      seed,
      inventory: inventory.toJSON(),
      objectives: {
        stepIndex: 0,
        currentProgress: 0,
      },
      edits: {},
      savedAt: new Date().toISOString(),
    });
  };
  setInterval(triggerSave, 30_000);
  window.addEventListener("visibilitychange", () => {
    if (document.hidden) triggerSave();
  });
  window.addEventListener("pagehide", triggerSave);

  if ("serviceWorker" in navigator && !window.location.hostname.includes("localhost")) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) {
      isMining = false;
      miningBlock = null;
      miningProgress = 0;
      hud.updateBreakProgress(0);
    }
  });

  window.addEventListener("contextmenu", (e) => e.preventDefault());

  let previous = performance.now();
  let elapsed = 150;
  let fpsFrames = 0;
  let fpsStart = previous;
  let prevP1Buttons = {
    toggleInventory: false,
    toggleSplit: false,
    prevSlot: false,
    nextSlot: false,
    place: false,
  };

  renderer.setAnimationLoop((now) => {
    const delta = qa ? 1 / 60 : Math.min(0.05, Math.max(0, (now - previous) / 1000));
    previous = now;
    if (qa) {
      qaState.simTime += delta;
      qaState.frame++;
    }
    elapsed = (elapsed + delta) % 600;

    // P1 Movement and gamepad step (Keyboard + Touch + Xbox Pad 0)
    const tInput = touch.getInput();
    const tLook = touch.consumeLook();
    const p1Pad = splitScreen.pollGamepad(0);

    if (tLook.lookX !== 0 || tLook.lookY !== 0) {
      player.rotateCamera(tLook.lookX * 0.005, tLook.lookY * 0.005);
    } else if (p1Pad) {
      player.rotateCamera(p1Pad.lookX * delta, p1Pad.lookY * delta);
      if (p1Pad.prevSlot && !prevP1Buttons.prevSlot) {
        inventory.cycleSlot(-1);
        hud.renderHotbar(inventory);
        audio.play("ui_click", { volume: 0.4 });
      }
      if (p1Pad.nextSlot && !prevP1Buttons.nextSlot) {
        inventory.cycleSlot(1);
        hud.renderHotbar(inventory);
        audio.play("ui_click", { volume: 0.4 });
      }
      if (p1Pad.place && !prevP1Buttons.place) {
        tryPlaceBlock();
      }
      if (p1Pad.toggleInventory && !prevP1Buttons.toggleInventory) {
        const open = hud.toggleInventory(inventory, (recId) => audio.play("craft_ok"));
        audio.play(open ? "ui_open" : "ui_click");
      }
      if (p1Pad.toggleSplit && !prevP1Buttons.toggleSplit) {
        const isSplit = splitScreen.toggle();
        hud.modeBtn.textContent = isSplit ? "Tryb: 2 Graczy (Ziemek & Gniewko)" : "Tryb: 1 Gracz";
        audio.play("ui_open");
        if (isSplit) {
          audio.play("cinematic_ziemek_ready");
          setTimeout(() => audio.play("cinematic_gniewko_ready"), 1200);
        }
      }
      prevP1Buttons = {
        toggleInventory: p1Pad.toggleInventory,
        toggleSplit: p1Pad.toggleSplit,
        prevSlot: p1Pad.prevSlot,
        nextSlot: p1Pad.nextSlot,
        place: p1Pad.place,
      };
    } else {
      prevP1Buttons = {
        toggleInventory: false,
        toggleSplit: false,
        prevSlot: false,
        nextSlot: false,
        place: false,
      };
    }

    const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0) + tInput.forward + (p1Pad ? p1Pad.forward : 0);
    const right = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0) + tInput.right + (p1Pad ? p1Pad.right : 0);
    const jump = keys.has("Space") || tInput.jump || (p1Pad?.jump ?? false);
    const sprint = keys.has("ShiftLeft") || (p1Pad?.sprint ?? false);

    player.step(delta, (x, y, z) => world.getBlock(x, y, z) !== 0, {
      forward,
      right,
      jump,
      sprint,
    });

    if (lanClient) {
      lanClient.sendInput(player.position, player.yaw, player.pitch, "idle");
    }

    // P2 Input and movement step (if split screen: Keyboard Arrows/IJKL or Xbox Pad 1)
    if (splitScreen.isSplitScreen) {
      const pad = splitScreen.pollGamepad(1);
      let p2Forward = 0;
      let p2Right = 0;
      let p2Jump = false;
      let p2Sprint = false;

      if (pad) {
        p2Forward = pad.forward;
        p2Right = pad.right;
        p2Jump = pad.jump;
        p2Sprint = pad.sprint;
        player2.rotateCamera(pad.lookX * delta, pad.lookY * delta);
      } else {
        p2Forward = (keys.has("ArrowUp") ? 1 : 0) - (keys.has("ArrowDown") ? 1 : 0);
        p2Right = (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
        p2Jump = keys.has("Enter") || keys.has("Numpad0");
        p2Sprint = keys.has("ControlRight");
        const lookYaw = (keys.has("Numpad6") || keys.has("KeyO") ? 1 : 0) - (keys.has("Numpad4") || keys.has("KeyU") ? 1 : 0);
        const lookPitch = (keys.has("Numpad2") || keys.has("Semicolon") ? 1 : 0) - (keys.has("Numpad8") || keys.has("KeyP") ? 1 : 0);
        player2.rotateCamera(lookYaw * 2.0 * delta, lookPitch * 1.5 * delta);
      }

      player2.step(delta, (x, y, z) => world.getBlock(x, y, z) !== 0, {
        forward: p2Forward,
        right: p2Right,
        jump: p2Jump,
        sprint: p2Sprint,
      });
      player2.avatar?.update(delta);
    }

    player.avatar?.update(delta);
    if (qa) {
      player.avatar?.freezePose(0.5);
      player2.avatar?.freezePose(0.5);
    }
    sky.update(elapsed, player.position);
    hud.updateTycoon(tycoon.collectedStars, tycoon.dropperTier);

    const camPos = player.getCameraPosition(5.5);
    camera.position.copy(camPos);
    camera.lookAt(player.getCameraTarget());
    if (splitScreen.isSplitScreen) {
      const camPos2 = player2.getCameraPosition(5.5);
      camera2.position.copy(camPos2);
      camera2.lookAt(player2.getCameraTarget());
    }

    const nearestNpc = npcManager.getNearestNPC(player.position.x, player.position.y, player.position.z, 3.0);
    const shouldShowPrompt = nearestNpc && !hud.isNpcDialogOpen() && !hud.isInventoryOpen() && !hud.isControlsModalOpen();
    hud.setNpcPrompt(shouldShowPrompt ? nearestNpc.name : null);
    npcManager.npcs.forEach((n) => n.update(delta));
    trainingDummy.update(delta);
    itemDrops.update(delta, player.position, () => {
      audio.play("craft_ok");
    });
    tycoon.update(
      delta,
      player.position,
      () => {
        audio.play("craft_ok", { rate: 1.4 });
        audio.play("celebrate_collect");
      },
      () => {
        audio.play("celebrate_win");
      },
      () => {
        player.velocity.y = 22.0;
        player.onGround = false;
        audio.play("jump", { rate: 1.5, volume: 1.0 });
      }
    );

    if (splitScreen.isSplitScreen) {
      const distP2Tramp = Math.hypot(player2.position.x - tycoon.trampolinePos.x, player2.position.z - tycoon.trampolinePos.z);
      if (distP2Tramp < 1.1) {
        player2.velocity.y = 22.0;
        player2.onGround = false;
        audio.play("jump", { rate: 1.5, volume: 1.0 });
      }
    }

    if (isMining && trainingDummy.isHit(player.position, 3.5)) {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const toDummy = trainingDummy.position.clone().sub(player.position).normalize();
      if (dir.dot(toDummy) > 0.6) {
        trainingDummy.hit();
        audio.play("dig_wood");
      }
    }
    const activeMining = (isMining || tInput.mine || (p1Pad?.mine ?? false)) && !hud.isInventoryOpen();
    if (activeMining) {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const hit = raycastVoxels(camera.position, dir, INTERACT_REACH, (x, y, z) => world.getBlock(x, y, z));
      if (hit && hit.distance > 0) {
        const bId = world.getBlock(hit.hit.x, hit.hit.y, hit.hit.z);
        if (bId !== BLOCK_ID.air && bId !== BLOCK_ID.bedrock) {
          if (!miningBlock || miningBlock.x !== hit.hit.x || miningBlock.y !== hit.hit.y || miningBlock.z !== hit.hit.z) {
            miningBlock = { ...hit.hit, id: bId };
            miningProgress = 0;
          }

          const def = BLOCK_BY_ID[bId as BlockId];
          const hardness = def?.hardness ?? 1.0;
          let toolSpeed = 1.0;
          if ((bId === BLOCK_ID.oak_log || bId === BLOCK_ID.oak_leaves) && inventory.getItemCount("stone_axe") > 0) {
            toolSpeed = 3.0;
          } else if ((bId === BLOCK_ID.stone || bId === BLOCK_ID.cobblestone || bId >= BLOCK_ID.coal_ore) && inventory.getItemCount("iron_pickaxe") > 0) {
            toolSpeed = 3.0;
          }

          miningProgress += (delta / Math.max(0.2, hardness)) * 1.5 * toolSpeed;
          hud.updateBreakProgress(miningProgress);

          crackMesh.position.set(hit.hit.x + 0.5, hit.hit.y + 0.5, hit.hit.z + 0.5);
          crackMesh.visible = true;
          crackMaterial.opacity = Math.min(1, miningProgress);

          if (miningProgress >= 1) {
            world.setBlock(hit.hit.x, hit.hit.y, hit.hit.z, BLOCK_ID.air);
            lanClient?.sendBlockEdit(hit.hit.x, hit.hit.y, hit.hit.z, BLOCK_ID.air);
            crackMesh.visible = false;
            crackMaterial.opacity = 0;
            const blockName = def ? Object.keys(BLOCK_ID).find((k) => (BLOCK_ID as Record<string, number>)[k] === bId) ?? "stone" : "stone";
            inventory.addMinedBlock(blockName, 1);
            itemDrops.spawn(hit.hit.x + 0.5, hit.hit.y + 0.5, hit.hit.z + 0.5, bId);
            if (bId === BLOCK_ID.oak_log) {
              audio.play("dig_wood");
              if (objectives.recordAction("gather_wood", 1)) {
                audio.play("objective_done");
                audio.play("celebrate_collect");
              }
            } else if (bId === BLOCK_ID.stone || bId === BLOCK_ID.cobblestone || bId >= BLOCK_ID.coal_ore) {
              audio.play("dig_stone");
              if (objectives.recordAction("find_stone", 1)) {
                audio.play("objective_done");
                audio.play("celebrate_collect");
              }
            } else {
              audio.play("dig_grass");
            }

            hud.updateObjective(objectives);
            miningBlock = null;
            miningProgress = 0;
            hud.updateBreakProgress(0);
          }
        }
      } else {
        miningBlock = null;
        miningProgress = 0;
        hud.updateBreakProgress(0);
      }
    }

    const width = window.innerWidth;
    const height = window.innerHeight;
    const viewports = getSplitViewports(width, height, splitScreen.isSplitScreen);
    renderer.clear();

    // P1 Viewport
    const vp1 = viewports[0];
    renderer.setViewport(vp1.x, vp1.y, vp1.width, vp1.height);
    renderer.setScissor(vp1.x, vp1.y, vp1.width, vp1.height);
    renderer.setScissorTest(true);
    camera.aspect = vp1.aspect;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);

    // P2 Viewport
    if (splitScreen.isSplitScreen && viewports.length > 1) {
      const vp2 = viewports[1];
      renderer.setViewport(vp2.x, vp2.y, vp2.width, vp2.height);
      renderer.setScissor(vp2.x, vp2.y, vp2.width, vp2.height);
      renderer.setScissorTest(true);
      camera2.aspect = vp2.aspect;
      camera2.updateProjectionMatrix();
      renderer.render(scene, camera2);
    }
    renderer.setScissorTest(false);
    if (now - fpsStart >= 1000) {
      stats.fps = Math.round((fpsFrames * 1000) / (now - fpsStart));
      stats.drawCalls = renderer.info.render.calls;
      stats.chunkCount = world.loadedChunkCount;
      fpsFrames = 0;
      fpsStart = now;
    }
  });

  window.addEventListener("resize", () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    const viewports = getSplitViewports(width, height, splitScreen.isSplitScreen);
    camera.aspect = viewports[0].aspect;
    camera.updateProjectionMatrix();
    if (viewports.length > 1) {
      camera2.aspect = viewports[1].aspect;
      camera2.updateProjectionMatrix();
    }
  });
}

void boot().catch(showBootError);
