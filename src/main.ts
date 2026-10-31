import * as THREE from "three";
import "./style.css";
import { AudioManager, MUSIC_PLAYLIST } from "./client/audio/sound";
import { MicController } from "./client/audio/mic";
import { LanClient } from "./client/net/client";
import { PlayerController } from "./client/entities/player";
import { NPCManager } from "./client/entities/npc";
import { ambientNpcChatterEnabled, chatterDelayMs, fallbackSay, reasonNpc, type NpcHistoryEntry } from "./client/entities/npc-brain";
import { fallbackLine } from "./shared/npc-fallbacks";
import { executeNpcClientTool } from "../server/npc-bridge";
import { ItemDropManager } from "./client/entities/drops";
import { TrainingDummy } from "./client/entities/dummy";
import { GameHUD } from "./client/game/hud";
import { GameInventory } from "./client/game/inventory";
import { createHousePlan, placeHousePlan } from "./client/game/house-builder";
import { OBJECTIVE_STEPS, ObjectiveManager } from "./client/game/objectives";
import { TycoonManager } from "./client/game/tycoon";
import { tycoonSlotOrigin, tycoonTheme } from "./shared/tycoon-slots";
import { TouchController } from "./client/input/touch";
import { loadGameState, saveGameState } from "./client/persist/db";
import { attachSplashVideo, type SplashVideoHandle } from "./client/startup/splash-video";
import { MenuStage } from "./client/startup/menu-stage";
import { pushOutOfCylinders } from "./shared/entity-collision";
import { smoothGroundOffset } from "./shared/mesher";
import { collideCamera } from "./shared/camera-collision";
import { pickViewRadius } from "./shared/view-radius";
import { lookGain } from "./shared/look-sensitivity";
import { GameplayVfx } from "./client/effects/gameplay-vfx";
import { hitPulseScale } from "./client/effects/hit-pulse";
import { createRenderer, loadRenderAssets, SkyCycle } from "./client/render/renderer";
import { CascadedShadows, MAX_SHADOW_CASTER_RANGE, shadowDistanceFor } from "./client/render/cascaded-shadows";
import { getSplitViewports, SplitScreenManager } from "./client/render/split-screen";
import { PostFX } from "./client/render/postfx";
import { WorldRenderer } from "./client/render/worldRenderer";
import { probeWebGL } from "./client/render/capabilities";
import { hostBridgeAvailable, postHostDiagnostic, postHostMessage } from "./client/startup/host-bridge";
import { resolveWorldSeed } from "./client/startup/world-seed";
import { LaunchMenuController } from "./client/startup/launch-menu";
import { PauseMenuController } from "./client/game/pause-menu";
import { ConciergeSession } from "./client/concierge/session";
import type { ConciergeHost, ConciergePlayer } from "./client/concierge/actions";
import { BLOCK_BY_ID, BLOCK_ID, type BlockId } from "./shared/blocks";
import { CHUNK_SIZE, chunkKey } from "./shared/chunk";
import { raycastInteract } from "./shared/raycast";
import { makeRng } from "./shared/rng";
import { generateBlock, surfaceHeight } from "./shared/worldgen";

type GameStats = { fps: number; drawCalls: number; chunkCount: number };
type GameBridge = {
  ready: boolean;
  detailedAvatars: { ready: boolean };
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
  remoteTycoons: Map<string, TycoonManager>;
  postfx: PostFX;
  qa?: {
    simTime: number;
    frame: number;
    paused: boolean;
    pauseAt?: number;
    events: { ev: string; id?: string; t: number }[];
  };
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
const splashVideo: SplashVideoHandle = qa
  ? { settle: async () => {}, stop: () => {} }
  : attachSplashVideo(status);
if (!qa) canvas.inert = true;
const ambientChatterEnabled = ambientNpcChatterEnabled(window.location.search);
const INTERACT_REACH = 12;
const capabilities = probeWebGL();
const lowPowerParam = new URLSearchParams(window.location.search).get("lowpower");
const lowPower = lowPowerParam === null ? !qa && capabilities.software : lowPowerParam === "1";
const LOW_POWER_VIEW_RADIUS = 3;
const CHUNK_BATCH = 8;
const VIEW_RADIUS = lowPower
  ? LOW_POWER_VIEW_RADIUS
  : pickViewRadius(navigator.userAgent, (navigator as Navigator & { deviceMemory?: number }).deviceMemory);

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
    statusEl.classList.remove("boot-ready");
    statusEl.classList.add("boot-error");
    msgEl.textContent = "Nie udało się wczytać gry. Sprawdź internet i spróbuj ponownie.";
    if (!statusEl.querySelector(".boot-retry")) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "boot-retry";
      retry.textContent = "↻ Spróbuj ponownie";
      retry.addEventListener("click", () => window.location.reload());
      statusEl.appendChild(retry);
    }
  }
  console.error(error);
}

async function boot(): Promise<void> {
  let gameStarted = qa;
  let paused = false;
  let suppressGamepadJumpUntilRelease = false;
  const audio = new AudioManager();
  void audio.preload(MUSIC_PLAYLIST).catch(() => {});
  const renderer = createRenderer(canvas, {
    antialias: !lowPower,
    shadows: !lowPower,
    pixelRatio: lowPower ? 1 : undefined,
  });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 900);
  const camera2 = new THREE.PerspectiveCamera(68, (window.innerWidth / 2) / window.innerHeight, 0.1, 900);
  const stats: GameStats = { fps: 0, drawCalls: 0, chunkCount: 0 };
  const assetsPromise = loadRenderAssets(renderer, (done, total) => {
    progress.style.width = `${Math.min(100, 6 + (done / total) * 38)}%`;
    message.textContent = `Wczytujemy zasoby: ${done} / ${total}`;
  });
  const saved = await loadGameState();
  const urlHasSeed = new URLSearchParams(window.location.search).has("seed");
  const seed = urlHasSeed ? chooseSeed() : saved?.seed ?? chooseSeed();
  updateSeedUrl(seed);
  const spawnY = surfaceHeight(3, 5, seed) + 1;
  const player = new PlayerController({ id: "p1", spawn: [3, spawnY, 5] });
  const player2 = new PlayerController({ id: "p2", spawn: [4.5, spawnY, 5] });
  const npcManager = new NPCManager();
  const [assets, avatar, avatar2] = await Promise.all([
    assetsPromise,
    player.loadAvatar(),
    player2.loadAvatar(),
    npcManager.spawnInScene(scene, (x: number, z: number) => surfaceHeight(x, z, seed)),
  ]);
  scene.environment = assets.environment;
  scene.add(avatar.object);
  scene.add(avatar2.object);
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
  const gameplayVfx = new GameplayVfx(scene, seed, assets.particles);

  const dummyY = surfaceHeight(1.5, 3, seed);

  const makeTycoon = (slot: number, label?: string): TycoonManager => {
    const at = tycoonSlotOrigin(slot);
    return new TycoonManager({ x: at.x, y: surfaceHeight(at.x, at.z, seed), z: at.z }, scene, {
      surfaceAt: (x, z) => surfaceHeight(x, z, seed),
      blocked: (x, z) => generateBlock(x, surfaceHeight(x, z, seed) + 1, z, seed) !== 0,
      theme: tycoonTheme(slot),
      label,
    });
  };
  let tycoonSlot = 0;
  let tycoon = makeTycoon(0, player.profile.name);
  if (saved?.tycoon) tycoon.restore(saved.tycoon);
  const remoteTycoons = new Map<string, TycoonManager>();

  const splitScreen = new SplitScreenManager(false);
  const inventory = saved?.inventory
    ? GameInventory.fromJSON(saved.inventory)
    : new GameInventory({ creative: true });
  const objectives = new ObjectiveManager();

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
    const hit = raycastInteract(camera.position, dir, INTERACT_REACH, (x, y, z) => world.getBlock(x, y, z), player.getCameraTarget());
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
        gameplayVfx.emit("place", new THREE.Vector3(placeX + 0.5, placeY + 0.5, placeZ + 0.5));
        player.avatar?.playOnce("place");
        if (objectives.recordAction("build_house", 1)) {
          audio.play("objective_done");
          audio.play("celebrate_win");
        }
        hud.updateObjective(objectives);
      }
    }
  };

  const world = new WorldRenderer({
    scene,
    seed,
    atlasTexture: assets.atlas,
    atlasNormal: assets.atlasNormal,
    atlasOrm: assets.atlasOrm,
    waterNormal: assets.waterNormal,
    onProgress: (loaded, total) => {
      progress.style.width = `${Math.min(100, 44 + (loaded / total) * 56)}%`;
      message.textContent = `Ładujemy świat: ${loaded} / ${total}`;
    },
  });

  world.applySavedEdits(saved);

  const camSolid = (x: number, y: number, z: number): boolean => {
    const id = world.getBlock(x, y, z);
    return id !== BLOCK_ID.air && id !== BLOCK_ID.water && id !== BLOCK_ID.oak_leaves;
  };
  const menuStage = new MenuStage({
    radius: 13,
    height: 8.5,
    speed: 0.06,
    startAngle: 0.7,
    solid: camSolid,
    groundAt: (x, z) => surfaceHeight(x, z, seed),
  });

  const loadAreaBatched = async (
    worldX: number,
    worldZ: number,
    radius: number,
    otherCenters?: { worldX: number; worldZ: number }[]
  ): Promise<void> => {
    let remaining = await world.loadArea(worldX, worldZ, radius, otherCenters, CHUNK_BATCH);
    while (remaining > 0) {
      remaining = await world.loadArea(worldX, worldZ, radius, otherCenters, CHUNK_BATCH);
    }
  };

  const trainingDummy = new TrainingDummy(
    { x: 1.5, y: dummyY, z: 3 },
    { planks: world.getTileMaterial("oak_planks"), bark: world.getTileMaterial("oak_log_side") }
  );
  scene.add(trainingDummy.object);

  const sky = new SkyCycle(scene, assets);
  const cascadedShadows = lowPower
    ? null
    : new CascadedShadows(
        scene,
        camera,
        sky.getSunLight(),
        shadowDistanceFor(camera.far, CHUNK_SIZE * VIEW_RADIUS)
      );
  if (cascadedShadows) {
    world.registerShadowMaterials((material) => cascadedShadows.registerMaterial(material));
    tycoon.registerShadowMaterials((material) => cascadedShadows.registerMaterial(material));
    cascadedShadows.registerObject(scene);
  }

  const setOwnTycoonSlot = (slot: number): void => {
    if (slot === tycoonSlot) return;
    const progress = tycoon.toJSON();
    tycoon.dispose();
    tycoonSlot = slot;
    tycoon = makeTycoon(slot, player.profile.name);
    tycoon.restore(progress);
    tycoon.registerShadowMaterials((material) => cascadedShadows?.registerMaterial(material));
    if (window.__GIERA__) window.__GIERA__.tycoon = tycoon;
  };

  const spawnRemoteTycoon = (id: string, name: string, slot: number): void => {
    if (remoteTycoons.has(id)) return;
    const remote = makeTycoon(slot, name);
    remote.registerShadowMaterials((material) => cascadedShadows?.registerMaterial(material));
    remoteTycoons.set(id, remote);
  };

  const clearRemoteTycoons = (): void => {
    for (const remote of remoteTycoons.values()) remote.dispose();
    remoteTycoons.clear();
  };
  const postfx = new PostFX(
    renderer,
    scene,
    camera,
    window.innerWidth,
    window.innerHeight,
    (viewCamera) => cascadedShadows?.prepareView(viewCamera),
    { direct: lowPower }
  );
  const qaState = {
    simTime: 0,
    frame: 0,
    paused: false,
    pauseAt: undefined as number | undefined,
    events: [] as { ev: string; id?: string; t: number }[],
  };
  if (qa) {
    const origPlay = audio.play.bind(audio);
    audio.play = (id: string, options: { volume?: number; rate?: number } = {}) => {
      qaState.events.push({ ev: "play", id, t: qaState.simTime });
      return origPlay(id, options);
    };
  }

  const hud = new GameHUD({
    inventory,
    objectives,
    onCraft: (recipeId) => {
      audio.play("craft_ok");
      gameplayVfx.emit("craft", new THREE.Vector3(player.position.x, player.position.y + 1.6, player.position.z));
      player.avatar?.playOnce("craft");
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
            onWelcome: (welcome) => {
              setOwnTycoonSlot(welcome.slot ?? 0);
              clearRemoteTycoons();
              for (const p of welcome.players) spawnRemoteTycoon(p.id, p.name, p.slot ?? 0);
              resolve(true);
            },
            onJoin: (join) => spawnRemoteTycoon(join.id, join.name, join.slot ?? 0),
            onLeave: (leave) => {
              remoteTycoons.get(leave.id)?.dispose();
              remoteTycoons.delete(leave.id);
            },
            onBlock: (b) => {
              world.setBlock(b.x, b.y, b.z, b.id, false);
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
  });

  const touchAvailable = "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0;
  let touchControlsAttached = false;
  const attachTouchControls = (): void => {
    if (!touchAvailable || touchControlsAttached) return;
    touchControlsAttached = true;
    touch.attachDOM(document.body, () => hud.toggleInventory(inventory), tryPlaceBlock);
  };
  const hudRoot = document.querySelector<HTMLElement>("#hud-root");
  if (!qa && hudRoot) {
    hudRoot.setAttribute("inert", "");
    hudRoot.style.visibility = "hidden";
  }
  else attachTouchControls();
  const launchRoot = document.querySelector<HTMLElement>("#launch-menu");
  const launchStart = document.querySelector<HTMLButtonElement>("#launch-start");
  const launchMode = document.querySelector<HTMLButtonElement>("#launch-mode");
  if (!launchRoot || !launchStart || !launchMode) {
    throw new Error("Giera launch menu elements are missing");
  }
  const launchMenu = new LaunchMenuController({
    root: launchRoot,
    startButton: launchStart,
    modeButton: launchMode,
    onStart: (settings, source) => {
      gameStarted = true;
      suppressGamepadJumpUntilRelease = source === "gamepad";
      splitScreen.setSplitScreen(settings.splitScreen);
      hud.modeBtn.textContent = settings.splitScreen ? "Tryb: 2 Graczy (Ziemek & Gniewko)" : "Tryb: 1 Gracz";
      canvas.inert = false;
      hudRoot?.removeAttribute("inert");
      if (hudRoot) hudRoot.style.visibility = "";
      canvas.focus({ preventScroll: true });
      attachTouchControls();
      void audio.playPlaylist().catch(() => {});
      void conciergeSession.close("menu");
    },
  });

  const pauseRoot = document.querySelector<HTMLElement>("#pause-menu");
  const pauseResume = document.querySelector<HTMLButtonElement>("#pause-resume");
  const pauseMode = document.querySelector<HTMLButtonElement>("#pause-mode");
  const launchConciergeSlot = document.querySelector<HTMLElement>("#launch-concierge-slot");
  const pauseConciergeSlot = document.querySelector<HTMLElement>("#pause-concierge-slot");
  const conciergePanel = document.querySelector<HTMLElement>("#concierge-panel");
  const conciergeCanvas = document.querySelector<HTMLCanvasElement>("#concierge-canvas");
  const conciergeStatus = document.querySelector<HTMLElement>("#concierge-status");
  if (!pauseRoot || !pauseResume || !pauseMode || !launchConciergeSlot || !pauseConciergeSlot || !conciergePanel || !conciergeCanvas || !conciergeStatus) {
    throw new Error("Giera pause menu elements are missing");
  }

  let houseBuildSequence = 0;
  const playerForConcierge = (target: ConciergePlayer): PlayerController => target === "gniewko" ? player2 : player;
  const houseSiteOccupied = (x: number, z: number, radius: number): boolean => {
    const overlaps = (otherX: number, otherZ: number, otherRadius: number): boolean =>
      Math.hypot(x - otherX, z - otherZ) < radius + otherRadius;
    if (overlaps(player.position.x, player.position.z, 0.8) || overlaps(player2.position.x, player2.position.z, 0.8)) return true;
    if (overlaps(trainingDummy.position.x, trainingDummy.position.z, 0.7)) return true;
    for (const npc of npcManager.npcs) {
      if (overlaps(npc.position.x, npc.position.z, npc.def.id === "papuga" ? 0.3 : 0.6)) return true;
    }
    const tycoonOccupied = (plot: TycoonManager): boolean => {
      if (
        overlaps(plot.collectorPadPos.x, plot.collectorPadPos.z, 1.2) ||
        overlaps(plot.upgradePadPos.x, plot.upgradePadPos.z, 1.2) ||
        overlaps(plot.trampolinePos.x, plot.trampolinePos.z, 1.2)
      ) return true;
      for (const body of plot.getCollisionBodies()) {
        if (overlaps(body.x, body.z, body.radius)) return true;
      }
      for (const slot of plot.expansionSlots) {
        if (overlaps(plot.origin.x + slot.x, plot.origin.z + slot.z, 1.2)) return true;
      }
      return false;
    };
    if (tycoonOccupied(tycoon)) return true;
    for (const plot of remoteTycoons.values()) if (tycoonOccupied(plot)) return true;
    return false;
  };

  const conciergeHost: ConciergeHost = {
    status: () => ({
      started: gameStarted,
      splitScreen: splitScreen.isSplitScreen,
      volume: audio.volume,
      coins: tycoon.vaultCoins,
      stars: tycoon.collectedStars,
      tier: tycoon.dropperTier,
    }),
    setSplitScreen: (enabled) => {
      splitScreen.setSplitScreen(enabled);
      hud.modeBtn.textContent = enabled ? "Tryb: 2 Graczy (Ziemek & Gniewko)" : "Tryb: 1 Gracz";
      pauseMenu.sync();
    },
    setVolume: (level) => audio.setVolume(level),
    setJumpHeight: (target, height) => playerForConcierge(target).setJumpHeight(height),
    setFlying: (target, enabled) => playerForConcierge(target).setFlying(enabled),
    buildHouse: (target) => {
      const actor = playerForConcierge(target);
      const houseSeed = seed + houseBuildSequence++;
      const plan = createHousePlan(
        world,
        { x: actor.position.x, z: actor.position.z, yaw: actor.yaw },
        houseSeed,
        houseSiteOccupied
      );
      if (!plan) return null;
      const placed = placeHousePlan(plan, world, inventory);
      if (!placed) return null;
      for (const block of plan.blocks) lanClient?.sendBlockEdit(block.x, block.y, block.z, block.id);
      if (objectives.recordAction("build_house", plan.blocks.length)) {
        audio.play("objective_done");
        audio.play("celebrate_win");
      } else {
        audio.play("craft_ok");
      }
      hud.updateObjective(objectives);
      return { blocks: plan.blocks.length, style: plan.style };
    },
    buyExpansion: () => {
      return tycoon.buyNextExpansionWithPrice();
    },
    teleportToSpawn: () => {
      player.position.set(player.spawn[0], player.spawn[1], player.spawn[2]);
      player.velocity.set(0, 0, 0);
    },
    reload: () => window.location.reload(),
  };

  const pauseMenu = new PauseMenuController({
    root: pauseRoot,
    resumeButton: pauseResume,
    modeButton: pauseMode,
    getSplitScreen: () => splitScreen.isSplitScreen,
    onResume: () => pauseMenu.close(),
    onToggleSplit: () => {
      const isSplit = splitScreen.toggle();
      hud.modeBtn.textContent = isSplit ? "Tryb: 2 Graczy (Ziemek & Gniewko)" : "Tryb: 1 Gracz";
      audio.play("ui_open");
      pauseMenu.sync();
    },
    onOpen: () => {
      paused = true;
      audio.pausePlaylist();
      keys.clear();
      isMining = false;
      if (document.pointerLockElement) document.exitPointerLock();
      hud.setInventoryOpen(false);
      void conciergeSession.open("pause");
    },
    onClose: () => {
      paused = false;
      void audio.playPlaylist().catch(() => {});
      void conciergeSession.close("menu");
      canvas.focus({ preventScroll: true });
    },
  });

  const conciergeSession = new ConciergeSession({
    host: conciergeHost,
    root: conciergePanel,
    canvas: conciergeCanvas,
    statusEl: conciergeStatus,
    slots: { launch: launchConciergeSlot, pause: pauseConciergeSlot },
    onClosed: (reason) => {
      if (reason === "hidden") pauseMenu.close();
    },
  });
  const musicVolumeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-audio-volume="music"]'));
  const speechVolumeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-audio-volume="speech"]'));
  for (const input of musicVolumeInputs) {
    input.value = String(audio.musicVolume);
    input.addEventListener("input", () => {
      const value = audio.setMusicVolume(input.valueAsNumber);
      for (const sibling of musicVolumeInputs) sibling.value = String(value);
    });
  }
  for (const input of speechVolumeInputs) {
    input.value = String(audio.speechVolume);
    input.addEventListener("input", () => {
      const value = audio.setSpeechVolume(input.valueAsNumber);
      conciergeSession.setSpeechVolume(value);
      for (const sibling of speechVolumeInputs) sibling.value = String(value);
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (pauseMenu.isOpen) {
      void conciergeSession.open("pause");
      return;
    }
    if (!launchMenu.isStarted && !launchRoot.hidden) void conciergeSession.open("launch");
  });

  const npcHistory = new Map<string, NpcHistoryEntry[]>();
  const npcThinkTimers = new Map<string, number>();
  const npcFailures = new Map<string, number>();
  const npcThinkPending = new Set<string>();
  const npcThinkRng = makeRng(20261026);
  const npcNextThink = new Map<string, number>(
    npcManager.npcs.map((n) => [n.def.id, 15 + npcThinkRng() * 20])
  );
  const speechProjector = new THREE.Vector3();
  const pickupProjector = new THREE.Vector3();
  const pollenRng = makeRng(seed ^ 0x3b79f2d1);
  let pollenTimer = 0;
  let woodHitEffectTimer = 0;
  let shadowCasterKey = "";
  const shadowCasterRange = MAX_SHADOW_CASTER_RANGE;

  const applyNpcTool = (
    npcId: string,
    tool: string | null,
    args: Record<string, unknown>
  ): string | null => {
    if (!tool) return null;
    if (tool === "give_quest" && objectives.currentStep.id === String(args.step_id ?? "")) return null;
    const result = executeNpcClientTool(npcId, tool, args, inventory, (stepId) => {
      const idx = OBJECTIVE_STEPS.findIndex((s) => s.id === stepId);
      if (idx >= 0) objectives.setStep(idx);
    });
    if (tool === "share_map_hint") return result.hint ?? null;
    if (!result.success) return null;
    if (tool === "give_block") hud.renderHotbar(inventory);
    return result.message ?? null;
  };

  const speakNpc = (npcId: string, name: string, text: string): void => {
    hud.showNpcSpeech(npcId, name, text);
    audio.play("npc_chat_pop", { volume: 0.5 });
    if (qa) return;
    const speaker = npcManager.npcs.find((m) => m.def.id === npcId);
    const distance = speaker ? Math.hypot(speaker.position.x - player.position.x, speaker.position.z - player.position.z) : 0;
    void audio.speak(npcId, text, Math.max(0, 1 - distance / 40)).catch(() => {});
  };

  const rememberNpcExchange = (npcId: string, userText: string, assistantText: string): void => {
    const history = npcHistory.get(npcId) ?? [];
    history.push({ role: "user", content: userText }, { role: "assistant", content: assistantText });
    if (history.length > 6) history.splice(0, history.length - 6);
    npcHistory.set(npcId, history);
  };

  window.__GIERA__ = {
    ready: false,
    detailedAvatars: { ready: true },
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
    remoteTycoons,
    postfx,
    qa: qa ? qaState : undefined,
  };


  await world.loadArea(0, 0, 2);
  await splashVideo.settle();
  splashVideo.stop();
  status.classList.add("boot-ready");
  postHostMessage("boot-ready");
  if (hostBridgeAvailable()) {
    postHostDiagnostic("diag", {
      ua: navigator.userAgent,
      cores: navigator.hardwareConcurrency ?? null,
      memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
      vendor: capabilities.vendor,
      gl: capabilities.renderer,
      webgl2: capabilities.webgl2,
      software: capabilities.software,
      lowPower,
      viewRadius: VIEW_RADIUS,
      batch: CHUNK_BATCH,
    });
    let lastBeat = performance.now();
    window.setInterval(() => {
      const now = performance.now();
      const drift = Math.round(now - lastBeat);
      lastBeat = now;
      postHostDiagnostic("hb", {
        drift,
        chunks: world.loadedChunkCount,
        fps: stats.fps,
        calls: stats.drawCalls,
        started: gameStarted,
      });
    }, 2000);
  }
  if (!qa) {
    launchMenu.show();
    void conciergeSession.open("launch");
    const enablePlaylist = (): void => {
      window.removeEventListener("pointerdown", enablePlaylist);
      window.removeEventListener("keydown", enablePlaylist);
      window.removeEventListener("touchstart", enablePlaylist);
      void audio.playPlaylist().catch(() => {});
    };
    window.addEventListener("pointerdown", enablePlaylist, { once: true });
    window.addEventListener("keydown", enablePlaylist, { once: true });
    window.addEventListener("touchstart", enablePlaylist, { once: true });
  }
  window.__GIERA__.ready = true;
  let streamCx = 0;
  let streamCz = 0;
  let streamBusy = true;
  if (qa) {
    void world.loadArea(0, 0, 8).catch(showBootError).finally(() => { streamBusy = false; });
  } else {
    void loadAreaBatched(0, 0, VIEW_RADIUS).catch(showBootError).finally(() => { streamBusy = false; });
  }

  // Input states
  const keys = new Set<string>();
  let isMining = false;
  let miningBlock: { x: number; y: number; z: number; id: number } | null = null;
  let miningProgress = 0;
  const resetMiningFeedback = (): void => {
    const hasFeedback =
      miningBlock !== null ||
      miningProgress !== 0 ||
      woodHitEffectTimer !== 0 ||
      crackMesh.visible ||
      crackMaterial.opacity !== 0 ||
      crackMesh.scale.x !== 1 ||
      crackMesh.scale.y !== 1 ||
      crackMesh.scale.z !== 1;
    if (!hasFeedback) return;
    miningBlock = null;
    miningProgress = 0;
    woodHitEffectTimer = 0;
    crackMesh.visible = false;
    crackMaterial.opacity = 0;
    crackMesh.scale.setScalar(1);
    hud.updateBreakProgress(0);
  };

  window.addEventListener("keydown", (e) => {
    if (!gameStarted) return;
    if (paused && e.code !== "Escape") return;
    keys.add(e.code);
    if (e.code === "KeyI") {
      const open = hud.toggleInventory(inventory, () => {
        audio.play("craft_ok");
        gameplayVfx.emit("craft", new THREE.Vector3(player.position.x, player.position.y + 1.6, player.position.z));
        player.avatar?.playOnce("craft");
      });
      audio.play(open ? "ui_open" : "ui_click");
    } else if (e.code === "KeyE") {
      const nearest = npcManager.getNearestNPC(player.position.x, player.position.y, player.position.z, 3.0);
      if (nearest && !hud.isNpcDialogOpen()) {
        if (document.pointerLockElement) document.exitPointerLock();
        audio.play("npc_chat_pop");
        hud.openNpcDialog({
          npcName: nearest.def.name,
          role: nearest.def.role,
          quickPrompts: nearest.def.quickPrompts,
          onSend: async (text) => {
            if (qa) return fallbackSay(text);
            try {
              const reply = await reasonNpc(nearest.def.id, text, npcHistory.get(nearest.def.id) ?? []);
              if (reply.walk_to) nearest.walkTo(reply.walk_to.x, reply.walk_to.z);
              const toolNote = applyNpcTool(nearest.def.id, reply.tool, reply.args);
              rememberNpcExchange(nearest.def.id, text, reply.say);
              speakNpc(
                nearest.def.id,
                nearest.def.name,
                toolNote ? `${reply.say} ${toolNote}` : reply.say
              );
              return reply.say;
            } catch {
              return fallbackLine(nearest.def.id, text);
            }
          },
          onMicStart: () => mic.start(),
          onMicStop: () => mic.stop(),
        });
      }
    } else if (e.code === "Escape") {
      if (hud.isNpcDialogOpen()) {
        hud.closeNpcDialog();
        mic.stop();
      } else if (hud.isInventoryOpen()) {
        hud.setInventoryOpen(false);
      } else if (hud.isControlsModalOpen()) {
        hud.setControlsModalOpen(false);
      } else if (hud.isLanModalOpen()) {
        hud.setLanModalOpen(false);
      } else if (!qa) {
        pauseMenu.toggle();
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
    if (!gameStarted) return;
    if (qa) void audio.playPlaylist().catch(() => {});
    if (!document.pointerLockElement) {
      canvas.requestPointerLock().catch(() => {});
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (gameStarted && document.pointerLockElement === canvas) {
      const gain = lookGain(e.movementX, e.movementY);
      player.rotateCamera(e.movementX * gain, e.movementY * gain);
    }
  });
  window.addEventListener("wheel", (e) => {
    if (!gameStarted) return;
    inventory.cycleSlot(Math.sign(e.deltaY));
    hud.renderHotbar(inventory);
  });

  window.addEventListener("mousedown", (e) => {
    if (!gameStarted || paused || hud.isInventoryOpen()) return;
    if (e.button === 0) {
      isMining = true;
    } else if (e.button === 2) {
      e.preventDefault();
      tryPlaceBlock();
    }
  });

  const triggerSave = (): void => {
    if (!gameStarted) return;
    void saveGameState({
      seed,
      tycoon: tycoon.toJSON(),
      inventory: inventory.toJSON(),
      objectives: {
        stepIndex: 0,
        currentProgress: 0,
      },
      edits: world.exportEdits(),
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
    if (gameStarted && e.button === 0) {
      isMining = false;
      resetMiningFeedback();
    }
  });

  window.addEventListener("contextmenu", (e) => {
    if (gameStarted) e.preventDefault();
  });

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

  let pauseButtonHeld = false;
  const pollPauseButton = (): void => {
    if (!gameStarted || qa) {
      pauseButtonHeld = false;
      return;
    }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pressed = false;
    for (const pad of pads) {
      if (pad?.buttons[9]?.pressed) {
        pressed = true;
        break;
      }
    }
    if (pressed && !pauseButtonHeld) pauseMenu.toggle();
    pauseButtonHeld = pressed;
  };

  renderer.setAnimationLoop((now) => {
    const drawCalls = renderer.info.render.calls;
    renderer.info.reset();
    pollPauseButton();
    const realDelta = Math.max(0, (now - previous) / 1000);
    fpsFrames++;
    if (now - fpsStart >= 1000) {
      stats.fps = Math.round((fpsFrames * 1000) / (now - fpsStart));
      stats.drawCalls = drawCalls;
      stats.chunkCount = world.loadedChunkCount;
      fpsFrames = 0;
      fpsStart = now;
    }
    if (!gameStarted) {
      launchMenu.pollGamepad();
      const menuDelta = qa ? 1 / 60 : Math.min(0.05, realDelta);
      tycoon.updateVisuals(menuDelta);
      menuStage.update(menuDelta, camera, tycoon.origin);
      postfx.noteFrame(menuDelta);
      postfx.renderSolo();
      previous = now;
      return;
    }
    if (qa && qaState.pauseAt !== undefined && qaState.frame >= qaState.pauseAt) qaState.paused = true;
    const delta = qa ? (qaState.paused ? 0 : 1 / 60) : Math.min(0.05, Math.max(0, (now - previous) / 1000));
    previous = now;
    if (paused) {
      if (splitScreen.isSplitScreen) postfx.renderSplit(camera, camera2);
      else postfx.renderSolo();
      return;
    }
    if (qa && !qaState.paused) {
      qaState.simTime += delta;
      qaState.frame++;
    }
    elapsed = (elapsed + delta) % 600;

    // P1 Movement and gamepad step (Keyboard + Touch + Xbox Pad 0)
    const tInput = touch.getInput();
    const tLook = touch.consumeLook();
    let p1Pad = splitScreen.pollGamepad(0);
    if (suppressGamepadJumpUntilRelease && p1Pad) {
      if (p1Pad.jump) p1Pad.jump = false;
      else suppressGamepadJumpUntilRelease = false;
    }

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
        const open = hud.toggleInventory(inventory, () => {
          audio.play("craft_ok");
          gameplayVfx.emit("craft", new THREE.Vector3(player.position.x, player.position.y + 1.6, player.position.z));
          player.avatar?.playOnce("craft");
        });
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

    const wasOnGround = player.onGround;
    player.step(delta, (x, y, z) => world.getBlock(x, y, z) !== 0, {
      forward,
      right,
      jump,
      sprint,
    });
    const nearTrampoline = Math.hypot(player.position.x - tycoon.trampolinePos.x, player.position.z - tycoon.trampolinePos.z) < 1.1;
    if (jump && wasOnGround && !player.onGround && player.velocity.y > 0 && !nearTrampoline) {
      audio.play("jump", { rate: 1.15, volume: 0.9 });
    }

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

      const wasOnGround2 = player2.onGround;
      const nearTrampoline2 = Math.hypot(player2.position.x - tycoon.trampolinePos.x, player2.position.z - tycoon.trampolinePos.z) < 1.1;
      player2.step(delta, (x, y, z) => world.getBlock(x, y, z) !== 0, {
        forward: p2Forward,
        right: p2Right,
        jump: p2Jump,
        sprint: p2Sprint,
      });
      if (p2Jump && wasOnGround2 && !player2.onGround && player2.velocity.y > 0 && !nearTrampoline2) {
        audio.play("jump", { rate: 1.15, volume: 0.9 });
      }
      player2.avatar?.update(delta);
    }

    {
      const solid = (x: number, y: number, z: number): boolean => world.getBlock(x, y, z) !== 0;
      const npcBodies = npcManager.npcs.map((n) => ({ x: n.position.x, y: n.position.y, z: n.position.z, radius: n.def.id === "papuga" ? 0.2 : 0.4, height: n.def.id === "papuga" ? 0.6 : 1.8 }));
      const statics = [
        ...npcBodies,
        { x: trainingDummy.position.x, y: trainingDummy.position.y, z: trainingDummy.position.z, radius: 0.4, height: 1.6 },
      ];
      for (const body of tycoon.getCollisionBodies()) statics.push(body);
      for (const remote of remoteTycoons.values()) {
        for (const body of remote.getCollisionBodies()) statics.push(body);
      }
      const resolve = (self: PlayerController, other: PlayerController): void => {
        const bodies = [...statics, { x: other.position.x, y: other.position.y, z: other.position.z, radius: 0.3, height: 1.8 }];
        const r = pushOutOfCylinders(self.position, 0.3, 1.8, bodies);
        if (!r.pushed) return;
        const y0 = Math.floor(self.position.y);
        if (solid(Math.floor(r.x), y0, Math.floor(r.z)) || solid(Math.floor(r.x), y0 + 1, Math.floor(r.z))) return;
        self.position.x = r.x;
        self.position.z = r.z;
        self.syncAvatar();
      };
      if (splitScreen.isSplitScreen) {
        resolve(player, player2);
        resolve(player2, player);
      } else {
        const r = pushOutOfCylinders(player.position, 0.3, 1.8, statics);
        const y0 = Math.floor(player.position.y);
        if (r.pushed && !solid(Math.floor(r.x), y0, Math.floor(r.z)) && !solid(Math.floor(r.x), y0 + 1, Math.floor(r.z))) {
          player.position.x = r.x;
          player.position.z = r.z;
          player.syncAvatar();
        }
      }
    }
    {
      const gb = (x: number, y: number, z: number): number => world.getBlock(x, y, z);
      const follow = (o: THREE.Object3D, x: number, y: number, z: number, grounded: boolean, damp: boolean): void => {
        const target = grounded ? smoothGroundOffset(gb, x, z, y) : 0;
        const prev = (o.userData.groundOffset as number | undefined) ?? target;
        const next = prev + (target - prev) * Math.min(1, delta * 12);
        o.userData.groundOffset = next;
        let baseY = y;
        if (damp) {
          const prevY = (o.userData.baseY as number | undefined) ?? y;
          baseY = Math.abs(y - prevY) > 2 ? y : prevY + (y - prevY) * Math.min(1, delta * 9);
          o.userData.baseY = baseY;
        }
        o.position.y = baseY + next;
      };
      for (const p of [player, player2]) if (p.avatar) follow(p.avatar.object, p.position.x, p.position.y, p.position.z, p.onGround, false);
    }
    player.avatar?.update(delta);
    if (!splitScreen.isSplitScreen) player2.avatar?.update(delta);
    gameplayVfx.updateFootsteps("p1", player.position, player.onGround);
    gameplayVfx.updateFootsteps("p2", player2.position, splitScreen.isSplitScreen && player2.onGround);
    if (qa) {
      player.avatar?.freezePose(0.5);
      player2.avatar?.freezePose(0.5);
      for (const n of npcManager.npcs) n.avatar?.freezePose(0.5);
    }
    if (!qa) {
      const ccx = Math.floor(player.position.x / 16);
      const ccz = Math.floor(player.position.z / 16);
      if (!streamBusy && (ccx !== streamCx || ccz !== streamCz)) {
        streamCx = ccx;
        streamCz = ccz;
        streamBusy = true;
        void loadAreaBatched(
          player.position.x,
          player.position.z,
          VIEW_RADIUS,
          splitScreen.isSplitScreen ? [{ worldX: player2.position.x, worldZ: player2.position.z }] : undefined
        )
          .catch(() => {})
          .finally(() => { streamBusy = false; });
      }
    }
    {
      const split = splitScreen.isSplitScreen;
      const key = `${Math.floor(player.position.x / 16)},${Math.floor(player.position.z / 16)}|${split ? `${Math.floor(player2.position.x / 16)},${Math.floor(player2.position.z / 16)}` : "-"}`;
      if (key !== shadowCasterKey) {
        shadowCasterKey = key;
        world.updateShadowCasters(
          split ? [player.position, player2.position] : [player.position],
          shadowCasterRange
        );
      }
    }
    sky.update(elapsed, player.position);
    world.updateWater(elapsed);

    camera.position.copy(player.getCameraPosition(5.5));
    {
      const t = player.getCameraTarget();
      const c = collideCamera(t, camera.position, camSolid);
      camera.position.set(c.x, c.y, c.z);
    }
    camera.lookAt(player.getCameraTarget());
    if (splitScreen.isSplitScreen) {
      camera2.position.copy(player2.getCameraPosition(5.5));
      const t2 = player2.getCameraTarget();
      const c2 = collideCamera(t2, camera2.position, camSolid);
      camera2.position.set(c2.x, c2.y, c2.z);
      camera2.lookAt(player2.getCameraTarget());
    }

    const nearestNpc = npcManager.getNearestNPC(player.position.x, player.position.y, player.position.z, 3.0);
    const shouldShowPrompt = nearestNpc && !hud.isNpcDialogOpen() && !hud.isInventoryOpen() && !hud.isControlsModalOpen();
    hud.setNpcPrompt(shouldShowPrompt ? nearestNpc.name : null);
    npcManager.updateAll(delta, (x, z) => surfaceHeight(Math.floor(x), Math.floor(z), seed), (x, y, z) => world.getBlock(x, y, z) !== 0);
    {
      const gb2 = (x: number, y: number, z: number): number => world.getBlock(x, y, z);
      for (const n of npcManager.npcs) {
        const o = n.avatar?.object ?? n.customObject;
        if (!o) continue;
        const target = smoothGroundOffset(gb2, n.position.x, n.position.z, n.position.y);
        const prev = (o.userData.groundOffset as number | undefined) ?? target;
        const off = prev + (target - prev) * Math.min(1, delta * 12);
        o.userData.groundOffset = off;
        const prevY = (o.userData.baseY as number | undefined) ?? n.position.y;
        const baseY = Math.abs(n.position.y - prevY) > 2 ? n.position.y : prevY + (n.position.y - prevY) * Math.min(1, delta * 9);
        o.userData.baseY = baseY;
        o.position.y = baseY + off;
      }
    }
    hud.updateNpcSpeech((npcId) => {
      const n = npcManager.npcs.find((m) => m.def.id === npcId);
      if (!n) return null;
      const headY = n.def.id === "papuga" ? 1.2 : 2.2;
      speechProjector.set(n.position.x, n.position.y + headY, n.position.z).project(camera);
      if (speechProjector.z > 1) return null;
      return {
        x: (speechProjector.x * 0.5 + 0.5) * window.innerWidth,
        y: (-speechProjector.y * 0.5 + 0.5) * window.innerHeight,
        visible: true,
      };
    });
    hud.updateResourceGain();
    if (!qa && ambientChatterEnabled && !hud.isNpcDialogOpen()) {
      for (const n of npcManager.npcs) {
        if (npcThinkPending.has(n.def.id)) continue;
        const t = (npcThinkTimers.get(n.def.id) ?? 0) + delta;
        npcThinkTimers.set(n.def.id, t);
        if (t < (npcNextThink.get(n.def.id) ?? 20)) continue;
        npcThinkTimers.set(n.def.id, 0);
        npcThinkPending.add(n.def.id);
        void reasonNpc(
          n.def.id,
          "(Pauza w rozmowie. Powiedz krótko coś zachęcającego do zabawy albo zaproponuj zadanie.)",
          npcHistory.get(n.def.id) ?? []
        )
          .then((reply) => {
            if (reply.walk_to) n.walkTo(reply.walk_to.x, reply.walk_to.z);
            speakNpc(n.def.id, n.def.name, reply.say);
            const failures = reply.fallback ? (npcFailures.get(n.def.id) ?? 0) + 1 : 0;
            npcFailures.set(n.def.id, failures);
            const baseDelay = chatterDelayMs(failures);
            npcNextThink.set(n.def.id, baseDelay * (0.75 + npcThinkRng() * 0.5) / 1000);
          })
          .catch(() => {
            const failures = (npcFailures.get(n.def.id) ?? 0) + 1;
            npcFailures.set(n.def.id, failures);
            npcNextThink.set(n.def.id, chatterDelayMs(failures) / 1000);
          })
          .finally(() => npcThinkPending.delete(n.def.id));
      }
    }
    trainingDummy.update(delta);
    const footX = Math.floor(player.position.x);
    const footY = Math.floor(player.position.y - 0.05);
    const footZ = Math.floor(player.position.z);
    if (world.getBlock(footX, footY, footZ) === BLOCK_ID.grass) {
      pollenTimer += delta;
      if (pollenTimer >= 1.4) {
        pollenTimer %= 1.4;
        gameplayVfx.emit(
          "pollen",
          new THREE.Vector3(
            player.position.x + (pollenRng() - 0.5) * 6,
            player.position.y + 0.8 + pollenRng() * 1.8,
            player.position.z + (pollenRng() - 0.5) * 6
          )
        );
      }
    } else {
      pollenTimer = 0;
    }
    gameplayVfx.update(delta);
    itemDrops.update(delta, player.position, () => {
      audio.play("craft_ok");
      player.avatar?.playOnce("pickup");
    });
    tycoon.update(
      delta,
      player.position,
      () => {
        audio.play("craft_ok", { rate: 1.4 });
        gameplayVfx.emit("collect", new THREE.Vector3(player.position.x, player.position.y + 1.4, player.position.z));
        player.avatar?.playOnce("pickup");
        audio.play("celebrate_collect");
      },
      () => {
        audio.play("celebrate_win");
      },
      () => {
        player.velocity.y = 22.0;
        gameplayVfx.emit("bounce", new THREE.Vector3(player.position.x, player.position.y + 0.2, player.position.z));
        player.onGround = false;
        audio.play("jump", { rate: 1.5, volume: 1.0 });
      },
      player.velocity.y,
      () => {
        audio.play("celebrate_win");
        gameplayVfx.emit("collect", new THREE.Vector3(player.position.x, player.position.y + 0.6, player.position.z));
      }
    );

    if (splitScreen.isSplitScreen) {
      tycoon.updateSecondary(
        delta,
        player2.position,
        () => {
          audio.play("craft_ok", { rate: 1.4 });
          gameplayVfx.emit("collect", new THREE.Vector3(player2.position.x, player2.position.y + 1.4, player2.position.z));
          player2.avatar?.playOnce("pickup");
          audio.play("celebrate_collect");
        },
        () => {
          audio.play("celebrate_win");
        },
        () => {
          gameplayVfx.emit("bounce", new THREE.Vector3(player2.position.x, player2.position.y + 0.2, player2.position.z));
          player2.velocity.y = 22.0;
          player2.onGround = false;
          audio.play("jump", { rate: 1.5, volume: 1.0 });
        },
        player2.velocity.y,
        () => {
          audio.play("celebrate_win");
          gameplayVfx.emit("collect", new THREE.Vector3(player2.position.x, player2.position.y + 0.6, player2.position.z));
        }
      );
    }
    hud.updateTycoon(tycoon.collectedStars, tycoon.vaultCoins, tycoon.dropperTier, tycoon.upgradeCost);
    for (const remote of remoteTycoons.values()) remote.updateVisuals(delta);

    if (isMining && trainingDummy.isHit(player.position, 3.5)) {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const toDummy = trainingDummy.position.clone().sub(player.position).normalize();
      if (dir.dot(toDummy) > 0.6) {
        trainingDummy.hit();
        player.avatar?.playOnce("hit");
        audio.play("dig_wood");
      }
    }
    const activeMining = (isMining || tInput.mine || (p1Pad?.mine ?? false)) && !hud.isInventoryOpen();
    player.isActing = activeMining;
    if (activeMining) {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const hit = raycastInteract(camera.position, dir, INTERACT_REACH, (x, y, z) => world.getBlock(x, y, z), player.getCameraTarget());
      if (hit && hit.distance > 0) {
        const bId = world.getBlock(hit.hit.x, hit.hit.y, hit.hit.z);
        if (bId !== BLOCK_ID.air && bId !== BLOCK_ID.bedrock) {
          if (!miningBlock || miningBlock.x !== hit.hit.x || miningBlock.y !== hit.hit.y || miningBlock.z !== hit.hit.z) {
            miningBlock = { ...hit.hit, id: bId };
            miningProgress = 0;
            woodHitEffectTimer = 0;
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
          if (bId === BLOCK_ID.oak_log || bId === BLOCK_ID.oak_leaves) {
            const pulse = hitPulseScale(elapsed, miningProgress);
            crackMesh.scale.set(pulse.x, pulse.y, pulse.z);
            woodHitEffectTimer += delta;
            if (woodHitEffectTimer >= 0.28) {
              woodHitEffectTimer %= 0.28;
              gameplayVfx.emit(
                bId === BLOCK_ID.oak_log ? "wood" : "leaves",
                new THREE.Vector3(hit.hit.x + 0.5, hit.hit.y + 0.5, hit.hit.z + 0.5)
              );
            }
          } else {
            woodHitEffectTimer = 0;
            crackMesh.scale.setScalar(1);
          }

          if (miningProgress >= 1) {
            world.setBlock(hit.hit.x, hit.hit.y, hit.hit.z, BLOCK_ID.air);
            lanClient?.sendBlockEdit(hit.hit.x, hit.hit.y, hit.hit.z, BLOCK_ID.air);
            crackMesh.visible = false;
            crackMaterial.opacity = 0;
            const blockName = def ? Object.keys(BLOCK_ID).find((k) => (BLOCK_ID as Record<string, number>)[k] === bId) ?? "stone" : "stone";
            inventory.addMinedBlock(blockName, 1);
            const minedPosition = new THREE.Vector3(hit.hit.x + 0.5, hit.hit.y + 0.5, hit.hit.z + 0.5);
            itemDrops.spawn(minedPosition.x, minedPosition.y, minedPosition.z, bId, world.getTileMaterial(def?.tiles.side ?? "stone"));
            gameplayVfx.emit(bId === BLOCK_ID.oak_log ? "wood" : bId === BLOCK_ID.oak_leaves ? "leaves" : "mine", minedPosition);
            if (bId === BLOCK_ID.oak_log) {
              pickupProjector.copy(minedPosition).project(camera);
              if (pickupProjector.z >= -1 && pickupProjector.z <= 1 && Math.abs(pickupProjector.x) <= 1 && Math.abs(pickupProjector.y) <= 1) {
                const viewport = getSplitViewports(window.innerWidth, window.innerHeight, splitScreen.isSplitScreen)[0];
                hud.showResourceGain("oak_log", 1, {
                  x: viewport.x + (pickupProjector.x * 0.5 + 0.5) * viewport.width,
                  y: viewport.y + (-pickupProjector.y * 0.5 + 0.5) * viewport.height,
                });
              }
            }
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
        } else {
          resetMiningFeedback();
        }
      } else {
        resetMiningFeedback();
      }
    } else {
      resetMiningFeedback();
    }

    postfx.noteFrame(realDelta);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const viewports = getSplitViewports(width, height, splitScreen.isSplitScreen);
    camera.aspect = viewports[0].aspect;
    camera.updateProjectionMatrix();
    if (splitScreen.isSplitScreen && viewports.length > 1) {
      camera2.aspect = viewports[1].aspect;
      camera2.updateProjectionMatrix();
      postfx.renderSplit(camera, camera2);
    } else {
      postfx.renderSolo();
    }
  });

  window.addEventListener("resize", () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    postfx.setSize(width, height);
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
