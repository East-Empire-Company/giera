import * as THREE from "three";
import "./style.css";
import { AudioManager, MUSIC_PLAYLIST } from "./client/audio/sound";
import { BeatTracker } from "./client/audio/beat-tracker";
import { MicController } from "./client/audio/mic";
import { createMicController } from "./client/input/mic";
import { LanClient } from "./client/net/client";
import { scanLanServers } from "./client/net/discovery";
import { DEFAULT_LAN_PORT, type BuildBlock, type BuildTask, type CompanionState, type PlayerProfile } from "./shared/lan-protocol";
import { PlayerController } from "./client/entities/player";
import { Avatar } from "./client/entities/avatar";
import { NPCManager } from "./client/entities/npc";
import { ambientNpcChatterEnabled, chatterDelayMs, fallbackSay, reasonNpc, type NpcHistoryEntry } from "./client/entities/npc-brain";
import { fallbackLine } from "./shared/npc-fallbacks";
import { executeNpcClientTool } from "../server/npc-bridge";
import { ItemDropManager } from "./client/entities/drops";
import { TrainingDummy } from "./client/entities/dummy";
import { GameHUD } from "./client/game/hud";
import { GameInventory } from "./client/game/inventory";
import { createCompanionController, type VisibleCompanionBlock } from "./client/game/companion-controller";
import { createRoomSyncBuffer } from "./client/game/room-sync-buffer";
import { createCompanionPanel } from "./client/ui/companion-panel";
import { createHousePlan } from "./shared/house-plan";
import { smoothGroundOffset } from "./shared/mesher";
import { placeHousePlan } from "./client/game/house-builder";
import { applyMinePlan, createMinePlan } from "./client/game/terrain-cheats";
import { OBJECTIVE_STEPS, ObjectiveManager } from "./client/game/objectives";
import { TycoonManager } from "./client/game/tycoon";
import { tycoonSlotOrigin, tycoonTheme } from "./shared/tycoon-slots";
import { COMPANION_PROFILES, MISSING_COMPANION_ASSET_MESSAGE, type CompanionProfileId } from "./shared/companion";
import { COMPANION_LINES, interpretCompanionUtterance, type CompanionLineId } from "./shared/companion-speech";
import { TouchController } from "./client/input/touch";
import { loadGameState, saveGameState, type SavedGameState } from "./client/persist/db";
import { attachSplashVideo, type SplashVideoHandle } from "./client/startup/splash-video";
import { MenuStage } from "./client/startup/menu-stage";
import {
  ACTIVE_LAN_ROOM_KEY,
  OFFLINE_SAVE_KEY,
  activeSaveKey as saveKeyForSession,
  getActiveSaveKey,
  parseLanRoomSession,
  serializeLanRoomSession,
  switchSaveKey,
  type LanRoomSession,
} from "./client/game/save-session";
import { pushOutOfCylinders, blockedByCylinders, type Cylinder } from "./shared/entity-collision";
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
import { LanMenuController } from "./client/game/lan-menu";
import { ConciergeSession } from "./client/concierge/session";
import type { ConciergeHost, ConciergePlayer } from "./client/concierge/actions";
import { BLOCK_BY_ID, BLOCK_ID, isStoneFamily, type BlockId } from "./shared/blocks";
import { CHUNK_SIZE, chunkKey } from "./shared/chunk";
import { raycastInteract } from "./shared/raycast";
import { makeRng } from "./shared/rng";
import { generateBlock, surfaceHeight } from "./shared/worldgen";
import { TntFuseQueue, TNT_CHAIN_FUSE_SECONDS, TNT_FUSE_SECONDS, TNT_RADIUS, TNT_KNOCKBACK_RANGE, TNT_KNOCKBACK_STRENGTH, planBlast } from "./client/game/tnt";

const PLAYER_GROUNDED_LOCOMOTION_LIFT: Record<PlayerProfile, number> = {
  ziemek: 0.06,
  gniewko: 0.05,
};
const GROUNDING_PROBES = [
  [-0.45, -0.45],
  [-0.45, 0.45],
  [0.45, -0.45],
  [0.45, 0.45],
] as const;

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
  const __GIERA_TEST_WS_URL__: string;
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
const query = new URLSearchParams(window.location.search);
const qa = query.get("qa") === "1";
const qaLivePlayerPose = qa && query.get("qaLivePlayerPose") === "1";
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

function updateSeedUrl(seed: number, replace = false): void {
  const url = new URL(window.location.href);
  if (url.searchParams.has("seed") && !replace) return;
  if (url.searchParams.get("seed") === String(seed)) return;
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
  const beatTracker = new BeatTracker();
  void audio.preload(MUSIC_PLAYLIST).then(() => {
    if (qa) return;
    const tap = audio.tapMusicBus();
    if (tap) beatTracker.attach(tap.bus, tap.ctx);
  }).catch(() => {});
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
  let activeRoomSession: LanRoomSession | null = null;
  try {
    activeRoomSession = parseLanRoomSession(sessionStorage.getItem(ACTIVE_LAN_ROOM_KEY));
  } catch {
    activeRoomSession = null;
  }
  let currentSaveKey = getActiveSaveKey();
  const saved = await loadGameState(currentSaveKey);
  const urlHasSeed = new URLSearchParams(window.location.search).has("seed");
  const seed = activeRoomSession
    ? activeRoomSession.seed ?? saved?.seed ?? chooseSeed()
    : urlHasSeed ? chooseSeed() : saved?.seed ?? chooseSeed();
  updateSeedUrl(seed, Boolean(activeRoomSession));
  const spawnY = surfaceHeight(3, 5, seed) + 1;
  const savedProfile = (localStorage.getItem("giera.profile") as PlayerProfile | null) || "ziemek";
  const player = new PlayerController({ id: "p1", spawn: [3, spawnY, 5], profile: savedProfile });
  const player2Profile = savedProfile === "ziemek" ? "gniewko" : "ziemek";
  const player2 = new PlayerController({ id: "p2", spawn: [4.5, spawnY, 5], profile: player2Profile });
  const npcManager = new NPCManager(seed);
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
  let ownId: string | null = null;
  const remotePlayers = new Map<string, { x: number; y: number; z: number }>();
  let roomReady = false;
  const remoteTarget = new THREE.Vector3();
  let remoteYaw = 0;
  let remotePitch = 0;
  let remoteActive = false;
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
      if (!activeBlock || (activeBlock as number) === 0) return;
      const cx = Math.floor(placeX / 16);
      const cz = Math.floor(placeZ / 16);
      const cKey = chunkKey(cx, 0, cz);

      if (!blockCollides && inventory.canEditChunk(cKey)) {
        world.setBlock(placeX, placeY, placeZ, activeBlock);
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
    speed: 0.035,
    startAngle: 0.7,
    focusOffset: { x: -1.5, z: -1.5 },
    lookHeight: 1.4,
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
  });

  const tycoonFeedback = (
    actingPlayer: PlayerController,
    actingCamera: THREE.PerspectiveCamera,
    secondary: boolean,
    kind: "collect" | "upgrade" | "expand",
    amount = 3
  ): void => {
    const position = new THREE.Vector3(
      actingPlayer.position.x,
      actingPlayer.position.y + (kind === "collect" ? 1.4 : 0.8),
      actingPlayer.position.z
    );
    gameplayVfx.emit("collect", position);
    audio.play(kind === "collect" ? "celebrate_collect" : "celebrate_win");
    if (kind === "collect") {
      audio.play("craft_ok", { rate: 1.4 });
      actingPlayer.avatar?.playOnce("pickup");
    }
    const viewport = getSplitViewports(window.innerWidth, window.innerHeight, splitScreen.isSplitScreen)[secondary ? 1 : 0];
    position.project(actingCamera);
    hud.flyTycoonStars({
      x: viewport.x + (position.x * 0.5 + 0.5) * viewport.width,
      y: viewport.y + (-position.y * 0.5 + 0.5) * viewport.height,
    }, amount);
    hud.pulseTycoon(kind);
  };

  let saveQueue: Promise<boolean> = Promise.resolve(true);
  const savedStateFor = (key: string): SavedGameState => ({
    seed,
    tycoon: tycoon.toJSON(),
    inventory: inventory.toJSON(),
    objectives: { stepIndex: 0, currentProgress: 0 },
    edits: key === OFFLINE_SAVE_KEY ? world.exportEdits() : {},
    savedAt: new Date().toISOString(),
  });
  const persistCurrentState = (key: string): Promise<boolean> => {
    const state = savedStateFor(key);
    const pending = saveQueue.then(
      () => saveGameState(state, key),
      () => saveGameState(state, key),
    ).catch(() => false);
    saveQueue = pending;
    return pending;
  };
  const activateRoomSession = async (url: string, room: string, roomSeed: number): Promise<boolean> => {
    const nextSession = { url, room, seed: roomSeed };
    const nextKey = saveKeyForSession(nextSession);
    if (!await persistCurrentState(currentSaveKey)) {
      showCompanionNotice("Nie udało się zapisać bieżącego świata.");
      return false;
    }
    const selectedKey = await switchSaveKey(currentSaveKey, nextKey, async () => true);
    if (selectedKey !== nextKey) return false;
    try {
      sessionStorage.setItem(ACTIVE_LAN_ROOM_KEY, serializeLanRoomSession(nextSession));
    } catch {
      showCompanionNotice("Nie udało się zapamiętać pokoju.");
      return false;
    }
    const changed = currentSaveKey !== nextKey ||
      activeRoomSession?.url !== nextSession.url ||
      activeRoomSession?.room !== nextSession.room ||
      activeRoomSession?.seed !== nextSession.seed ||
      seed !== roomSeed;
    currentSaveKey = nextKey;
    activeRoomSession = nextSession;
    if (changed) {
      const target = new URL(window.location.href);
      target.searchParams.set("seed", String(roomSeed));
      window.location.replace(target.href);
      return true;
    }
    roomReady = true;
    return true;
  };
  const leaveRoom = async (): Promise<boolean> => {
    if (!activeRoomSession || !roomReady) return false;
    if (!window.confirm("Zapisać stan gry i opuścić pokój?")) return false;
    if (!await persistCurrentState(currentSaveKey)) {
      showCompanionNotice("Nie udało się zapisać pokoju. Nadal grasz w nim.");
      return false;
    }
    try {
      sessionStorage.removeItem(ACTIVE_LAN_ROOM_KEY);
    } catch {
      showCompanionNotice("Nie udało się zamknąć zapisanego pokoju.");
      return false;
    }
    roomReady = false;
    lanClient?.disconnect();
    lanClient = null;
    activeRoomSession = null;
    currentSaveKey = OFFLINE_SAVE_KEY;
    roomSyncBuffer.abort();
    activeSyncId = null;
    companionController.stop();
    companionController.applyServerRemove();
    removeCompanionAvatar();
    clearBuildPreview();
    activeBuildPlan = null;
    pendingBuildPreview = null;
    const offline = await loadGameState(OFFLINE_SAVE_KEY);
    const target = new URL(window.location.href);
    if (offline?.seed !== undefined) target.searchParams.set("seed", String(offline.seed));
    else target.searchParams.delete("seed");
    window.location.replace(target.href);
    return true;
  };

  function connectLan(url: string, room: string, opts: { host?: boolean; roomName?: string; seed?: number; onConnected?: (welcomeSeed: number) => void } = {}): Promise<boolean> {
    lanClient?.disconnect();
    return new Promise<boolean>((resolve) => {
      lanClient = new LanClient({
        url,
        room,
        playerName: player.profile.name,
        profile: player.characterProfile,
        host: opts.host,
        roomName: opts.roomName,
        seed: opts.seed,
        callbacks: {
          onWelcome: async (welcome) => {
            ownId = welcome.id;
            splitScreen.setSplitScreen(false);
            hud.modeBtn.textContent = "Tryb: 1 Gracz";
            setOwnTycoonSlot(welcome.slot ?? 0);
            clearRemoteTycoons();
            for (const p of welcome.players) spawnRemoteTycoon(p.id, p.name, p.slot ?? 0);
            roomOwnerId = welcome.ownerId;
            observedGeneration = welcome.generation;
            companionController.setOwner(roomOwnerId === ownId);
            companionController.setGeneration(welcome.generation);
            if (welcome.companion) {
              companionController.applyServerState(welcome.companion);
              void displayCompanionState(welcome.companion);
            } else {
              companionController.applyServerRemove();
              removeCompanionAvatar();
            }
            roomSyncBuffer.start();
            activeSyncId = null;
            const activated = await activateRoomSession(url, room, welcome.seed);
            if (!activated && !roomReady) {
              showCompanionNotice("Nie udało się przełączyć zapisu pokoju.");
              resolve(false);
              return;
            }
            opts.onConnected?.(welcome.seed);
            resolve(true);
          },
          onJoin: (join) => {
            if (join.id !== ownId) spawnRemoteTycoon(join.id, join.name, join.slot ?? 0);
          },
          onLeave: (leave) => {
            const remote = remoteTycoons.get(leave.id);
            if (remote) {
              remote.dispose();
              remoteTycoons.delete(leave.id);
            }
          },
          onStatusChange: (status) => {
            if (status === "disconnected") remoteActive = false;
          },
          onBlock: (b) => {
            const routed = roomSyncBuffer.buffer(b);
            if (routed === "apply") {
              world.setBlock(b.x, b.y, b.z, b.id, false);
              companionController.blockPlaced(b);
            } else if (routed === "overflow") {
              if (activeSyncId) lanClient?.roomSyncAbort(activeSyncId);
              roomSyncBuffer.abort();
              activeSyncId = null;
              showCompanionNotice("Synchronizacja przerwana. Spróbuj ponownie.");
              lanClient?.roomSyncStart();
            }
          },
          onPlayer: (p) => {
            if (ownId && p.id === ownId) return;
            if (p.profile && player2.characterProfile !== p.profile) {
              player2.setCharacterProfile(p.profile);
              const oldObject = player2.avatar?.object;
              if (oldObject) scene.remove(oldObject);
              player2.loadAvatar().then((avatar) => {
                scene.add(avatar.object);
                player2.syncAvatar();
              });
            }
            remoteTarget.set(p.x, p.y, p.z);
            remoteYaw = p.yaw;
            remotePitch = p.pitch;
            remoteActive = true;
          },
          onCompanionState: (m) => {
            observedGeneration = m.generation;
            companionController.applyServerState(m);
            void displayCompanionState(m.companion);
          },
          onCompanionRemove: (m) => {
            companionController.applyServerRemove(m.id);
            removeCompanionAvatar();
          },
          onCompanionCommand: (m) => {
            observedGeneration = m.generation;
            companionController.setGeneration(m.generation);
            companionController.command(m.task, m.generation);
          },
          onOwnerChanged: (m) => {
            roomOwnerId = m.ownerId;
            companionController.setOwner(roomOwnerId === ownId);
          },
          onCompanionError: (m) => {
            observedGeneration = m.generation;
            companionController.setGeneration(m.generation);
            showCompanionNotice(m.message);
          },
          onCompanionSay: (m) => {
            if (companionController.getState()?.id === m.id) displayCompanionLine(m.line as CompanionLineId);
          },
          onBuildPreview: (m) => {
            if (m.requestId !== lastBuildPreviewRequest) return;
            pendingBuildPreview = { planId: m.planId, blocks: m.blocks, requestedBy: ownId ?? "" };
            showBuildPreview(m.blocks);
            showCompanionNotice(`Domek: ${m.blocks.length} bloków. Potwierdź budowę.`);
          },
          onBuildReserved: (m) => {
            if (pendingBuildPreview?.planId !== m.planId) return;
            activeBuildPlan = { planId: m.planId, blocks: m.blocks, requestedBy: ownId ?? "", placed: 0, reserved: true };
            companionController.reserveBuild(m.planId, m.blocks);
            clearBuildPreview();
            pendingBuildPreview = null;
          },
          onBuildCancelled: (m) => {
            if (pendingBuildPreview?.planId !== m.planId && activeBuildPlan?.planId !== m.planId) return;
            clearBuildPreview();
            pendingBuildPreview = null;
            activeBuildPlan = null;
            companionController.stop();
            showCompanionNotice("Budowa zatrzymana.");
          },
          onRoomSyncBegin: (m) => {
            activeSyncId = m.syncId;
            roomSyncBuffer.begin(m.syncId);
          },
          onRoomSyncPage: (m) => {
            if (roomSyncBuffer.applyPage(m.syncId, m.index, m.edits, (b) => world.setBlock(b.x, b.y, b.z, b.id, false))) {
              lanClient?.roomSyncAck(m.syncId, m.index);
            }
          },
          onRoomSyncEnd: (m) => {
            roomSyncBuffer.end(m.syncId, (b) => world.setBlock(b.x, b.y, b.z, b.id, false));
            activeSyncId = null;
          },
        },
      });
      lanClient.connect();
      setTimeout(() => resolve(false), 4000);
    });
  }

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
  const applyLaunchProfile = (targetPlayer: PlayerController, profile: PlayerProfile): void => {
    if (targetPlayer.characterProfile === profile) return;
    const oldObject = targetPlayer.avatar?.object;
    if (oldObject) scene.remove(oldObject);
    targetPlayer.setCharacterProfile(profile);
    void targetPlayer.loadAvatar().then((nextAvatar) => {
      scene.add(nextAvatar.object);
      targetPlayer.syncAvatar();
    });
  };


  const pauseRoot = document.querySelector<HTMLElement>("#pause-menu");
  const pauseResume = document.querySelector<HTMLButtonElement>("#pause-resume");
  const pauseMode = document.querySelector<HTMLButtonElement>("#pause-mode");
  const launchConciergeSlot = document.querySelector<HTMLElement>("#launch-concierge-slot");
  const pauseConciergeSlot = document.querySelector<HTMLElement>("#pause-concierge-slot");
  const conciergePanel = document.querySelector<HTMLElement>("#concierge-panel");
  const conciergeCanvas = document.querySelector<HTMLCanvasElement>("#concierge-canvas");
  const conciergeStatus = document.querySelector<HTMLElement>("#concierge-status");
  const conciergeRetry = document.querySelector<HTMLButtonElement>("#concierge-retry");
  if (!pauseRoot || !pauseResume || !pauseMode || !launchConciergeSlot || !pauseConciergeSlot || !conciergePanel || !conciergeCanvas || !conciergeStatus || !conciergeRetry) {
    throw new Error("Giera pause menu elements are missing");
  }

  let houseBuildSequence = 0;
  const playerForConcierge = (target: ConciergePlayer): PlayerController => {
    if (!splitScreen.isSplitScreen) return player;
    const name = target === "gniewko" ? "Gniewko" : "Ziemek";
    return player.profile.name === name ? player : player2;
  };
  const houseSiteOccupied = (x: number, z: number, radius: number): boolean => {
    const overlaps = (otherX: number, otherZ: number, otherRadius: number): boolean =>
      Math.hypot(x - otherX, z - otherZ) < radius + otherRadius;
    if (overlaps(player.position.x, player.position.z, 0.8) || overlaps(player2.position.x, player2.position.z, 0.8)) return true;
    for (const npc of npcManager.npcs) {
      if (overlaps(npc.position.x, npc.position.z, 0.6)) return true;
    }
    if (overlaps(trainingDummy.position.x, trainingDummy.position.z, 0.6)) return true;
    for (const remote of remotePlayers.values()) if (overlaps(remote.x, remote.z, 0.35)) return true;
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

  const companionNotice = document.createElement("div");
  companionNotice.className = "companion-notice";
  companionNotice.setAttribute("role", "status");
  companionNotice.setAttribute("aria-live", "polite");
  companionNotice.hidden = true;
  document.body.append(companionNotice);
  let companionNoticeTimer = 0;
  const showCompanionNotice = (text: string): void => {
    companionNotice.textContent = text;
    companionNotice.hidden = false;
    window.clearTimeout(companionNoticeTimer);
    companionNoticeTimer = window.setTimeout(() => { companionNotice.hidden = true; }, 4500);
  };
  const roomSyncBuffer = createRoomSyncBuffer<BuildBlock>();
  let activeSyncId: string | null = null;
  let roomOwnerId: string | null = null;
  let observedGeneration = 0;
  let activeBuildPlan: { planId: string; blocks: BuildBlock[]; requestedBy: string; placed: number; reserved: boolean } | null = null;
  let pendingBuildPreview: { planId: string; blocks: BuildBlock[]; requestedBy: string } | null = null;
  let buddyMuted = false;
  let buddyVolume = 0.7;
  const buddySpeechIds = new Set<number>();
  const companionBlockers: Cylinder[] = [];
  let companionController: ReturnType<typeof createCompanionController>;
  let companionTarget: CompanionState | null = null;
  let companionAvatar: Avatar | null = null;
  let companionAvatarProfile: CompanionProfileId | null = null;
  let preloadedCompanion: { profile: CompanionProfileId; avatar: Avatar } | null = null;
  let companionAvatarRevision = 0;
  let companionPanel: ReturnType<typeof createCompanionPanel>;
  const scoutBlockIds = new Set<number>([BLOCK_ID.oak_log, BLOCK_ID.coal_ore, BLOCK_ID.iron_ore, BLOCK_ID.gold_ore, BLOCK_ID.stone]);
  const refreshCompanionBlockers = (): void => {
    companionBlockers.length = 0;
    companionBlockers.push(
      { x: player.position.x, y: player.position.y, z: player.position.z, radius: 0.32, height: 1.8 },
      ...(splitScreen.isSplitScreen ? [{ x: player2.position.x, y: player2.position.y, z: player2.position.z, radius: 0.32, height: 1.8 }] : []),
      { x: trainingDummy.position.x, y: trainingDummy.position.y, z: trainingDummy.position.z, radius: 0.55, height: 1.8 },
      ...npcManager.npcs.map((npc) => ({ x: npc.position.x, y: npc.position.y, z: npc.position.z, radius: 0.35, height: 1.8 })),
      ...tycoon.getCollisionBodies(),
      ...[...remoteTycoons.values()].flatMap((plot) => [...plot.getCollisionBodies()]),
      ...[...remotePlayers.entries()].filter(([id]) => id !== ownId).map(([, pose]) => ({ ...pose, radius: 0.32, height: 1.8 })),
    );
  };
  const visibleCompanionBlocks = (): VisibleCompanionBlock[] => {
    const state = companionController?.getState();
    if (!state) return [];
    const centerX = Math.floor(state.x);
    const centerY = Math.floor(state.y);
    const centerZ = Math.floor(state.z);
    const candidates: VisibleCompanionBlock[] = [];
    for (let y = Math.max(1, centerY - 8); y <= Math.min(127, centerY + 8); y += 1) {
      for (let z = centerZ - 12; z <= centerZ + 12; z += 1) {
        for (let x = centerX - 12; x <= centerX + 12; x += 1) {
          if (!world.isLoadedCell(x, y, z)) continue;
          const id = world.getBlock(x, y, z);
          if (scoutBlockIds.has(id)) candidates.push({ x, y, z, id });
        }
      }
    }
    return candidates;
  };
  const displayCompanionLine = (line: CompanionLineId): void => {
    const state = companionController.getState();
    if (!state) return;
    const text = COMPANION_LINES[line];
    const name = state.profile === "staszek" ? "Staszek" : "Mina";
    hud.showNpcSpeech("companion", name, text);
    if (buddyMuted || buddyVolume <= 0.05) return;
    const request = audio.speech.request({ kind: "text", speakerId: "buddy", text, volume: buddyVolume });
    buddySpeechIds.add(request.id);
  };
  const removeCompanionAvatar = (): void => {
    companionAvatarRevision += 1;
    companionTarget = null;
    companionAvatar?.dispose();
    companionAvatar = null;
    companionAvatarProfile = null;
    preloadedCompanion?.avatar.dispose();
    preloadedCompanion = null;
  };
  const installCompanionAvatar = (profile: CompanionProfileId, avatar: Avatar, state: CompanionState): void => {
    companionAvatar?.dispose();
    companionAvatar = avatar;
    companionAvatarProfile = profile;
    companionTarget = { ...state };
    avatar.object.position.set(state.x, state.y, state.z);
    avatar.object.rotation.y = state.yaw;
    avatar.setMotion(state.anim === "walk" ? "walk" : state.anim === "jump" ? "jump" : state.anim === "mine" ? "mine" : "idle");
    scene.add(avatar.object);
    cascadedShadows?.registerObject(avatar.object);
  };
  const prepareCompanionModel = async (profile: CompanionProfileId): Promise<boolean> => {
    if (companionAvatarProfile === profile && companionAvatar) return true;
    if (preloadedCompanion?.profile === profile) return true;
    const revision = ++companionAvatarRevision;
    try {
      const avatar = await Avatar.load(COMPANION_PROFILES[profile].model, { targetHeight: COMPANION_PROFILES[profile].targetHeight });
      if (revision !== companionAvatarRevision) {
        avatar.dispose();
        return false;
      }
      const current = companionController?.getState();
      if (current?.profile === profile) {
        installCompanionAvatar(profile, avatar, current);
      } else {
        preloadedCompanion?.avatar.dispose();
        preloadedCompanion = { profile, avatar };
      }
      return true;
    } catch {
      showCompanionNotice(MISSING_COMPANION_ASSET_MESSAGE);
      return false;
    }
  };
  const displayCompanionState = async (state: CompanionState): Promise<void> => {
    companionTarget = { ...state };
    if (companionAvatarProfile === state.profile && companionAvatar) return;
    const revision = ++companionAvatarRevision;
    let avatar: Avatar;
    if (preloadedCompanion?.profile === state.profile) {
      avatar = preloadedCompanion.avatar;
      preloadedCompanion = null;
    } else {
      try {
        avatar = await Avatar.load(COMPANION_PROFILES[state.profile].model, { targetHeight: COMPANION_PROFILES[state.profile].targetHeight });
      } catch {
        showCompanionNotice(MISSING_COMPANION_ASSET_MESSAGE);
        return;
      }
    }
    const current = companionController.getState();
    if (revision !== companionAvatarRevision || current?.id !== state.id || current.profile !== state.profile) {
      avatar.dispose();
      return;
    }
    installCompanionAvatar(state.profile, avatar, state);
  };
  const localBuildBlocked = (block: BuildBlock): boolean => {
    const plan = activeBuildPlan;
    if (!plan || plan.planId.length === 0 || world.getBlock(block.x, block.y, block.z) !== BLOCK_ID.air) return true;
    const xs = plan.blocks.map((item) => item.x);
    const zs = plan.blocks.map((item) => item.z);
    const centerX = (Math.min(...xs) + Math.max(...xs) + 1) / 2;
    const centerZ = (Math.min(...zs) + Math.max(...zs) + 1) / 2;
    const radius = Math.hypot(Math.max(...xs) - Math.min(...xs) + 1, Math.max(...zs) - Math.min(...zs) + 1) / 2;
    return houseSiteOccupied(centerX, centerZ, radius) ||
      blockedByCylinders(block.x + 0.5, block.z + 0.5, block.y, 0.3, 1, companionBlockers);
  };
  const placeLocalBuildBlock = (planId: string, blockIndex: number): void => {
    const plan = activeBuildPlan;
    const block = plan?.blocks[blockIndex];
    if (!plan || !plan.reserved || plan.planId !== planId || !block || localBuildBlocked(block)) {
      showCompanionNotice("Budowa zatrzymana. Miejsce jest zajęte.");
      companionController.stop();
      return;
    }
    world.setBlock(block.x, block.y, block.z, block.id);
    companionController.blockPlaced(block);
    plan.placed += 1;
    if (plan.placed >= plan.blocks.length) activeBuildPlan = null;
  };
  companionController = createCompanionController({
    send: {
      state: (state) => {
        if (roomReady && roomOwnerId === ownId) lanClient?.sendCompanionState(state);
      },
      say: (id, line, evidence) => {
        if (roomReady) lanClient?.sendCompanionSay(id, line, evidence);
        else displayCompanionLine(line);
      },
      place: (id, planId, blockIndex) => {
        if (roomReady) lanClient?.sendCompanionPlace(id, planId, blockIndex);
        else placeLocalBuildBlock(planId, blockIndex);
      },
      stop: () => {
        if (roomReady) lanClient?.sendCompanionStop();
      },
    },
    world: (x, y, z) => world.getBlock(x, y, z),
    isLoaded: (x, y, z) => world.isLoadedCell(x, y, z),
    blocked: (x, y, z) => blockedByCylinders(x + 0.5, z + 0.5, y, 0.3, 1.8, companionBlockers),
    pathBlocked: (x, y, z) => blockedByCylinders(x + 0.5, z + 0.5, y, 0.3, 1.8, [
      { x: player.position.x, y: player.position.y, z: player.position.z, radius: 0.92, height: 1.8 },
      ...(splitScreen.isSplitScreen ? [{ x: player2.position.x, y: player2.position.y, z: player2.position.z, radius: 0.92, height: 1.8 }] : []),
    ]),
    ownerPosition: () => ({ x: player.position.x, y: player.position.y, z: player.position.z }),
    visibleBlocks: visibleCompanionBlocks,
    selfId: ownId,
    isOwner: true,
    isSyncing: () => roomSyncBuffer.syncing,
  });
  let previewMesh: THREE.InstancedMesh | null = null;
  const clearBuildPreview = (): void => {
    if (!previewMesh) return;
    scene.remove(previewMesh);
    previewMesh.geometry.dispose();
    if (Array.isArray(previewMesh.material)) previewMesh.material.forEach((material) => material.dispose());
    else previewMesh.material.dispose();
    previewMesh = null;
  };
  const showBuildPreview = (blocks: readonly BuildBlock[]): void => {
    clearBuildPreview();
    if (blocks.length === 0) return;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0x64d8ff, wireframe: true, transparent: true, opacity: 0.62, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geometry, material, blocks.length);
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      matrix.makeTranslation(block.x + 0.5, block.y + 0.5, block.z + 0.5);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    previewMesh = mesh;
    scene.add(mesh);
  };
  const findLocalCompanionSpawn = (): { x: number; y: number; z: number } | null => {
    refreshCompanionBlockers();
    const originX = Math.floor(player.position.x);
    const originZ = Math.floor(player.position.z);
    for (let radius = 1; radius <= 4; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (const dz of [-radius, radius]) {
          const x = originX + dx;
          const z = originZ + dz;
          const y = world.surfaceColumnTop(x, z) + 1;
          if (!world.isLoadedCell(x, y - 1, z) || !world.isLoadedCell(x, y, z) || !world.isLoadedCell(x, y + 1, z)) continue;
          if (world.getBlock(x, y, z) !== BLOCK_ID.air || world.getBlock(x, y + 1, z) !== BLOCK_ID.air) continue;
          if (blockedByCylinders(x + 0.5, z + 0.5, y, 0.3, 1.8, companionBlockers)) continue;
          return { x: x + 0.5, y, z: z + 0.5 };
        }
      }
      for (let dz = -radius + 1; dz < radius; dz += 1) {
        for (const dx of [-radius, radius]) {
          const x = originX + dx;
          const z = originZ + dz;
          const y = world.surfaceColumnTop(x, z) + 1;
          if (!world.isLoadedCell(x, y - 1, z) || !world.isLoadedCell(x, y, z) || !world.isLoadedCell(x, y + 1, z)) continue;
          if (world.getBlock(x, y, z) !== BLOCK_ID.air || world.getBlock(x, y + 1, z) !== BLOCK_ID.air) continue;
          if (blockedByCylinders(x + 0.5, z + 0.5, y, 0.3, 1.8, companionBlockers)) continue;
          return { x: x + 0.5, y, z: z + 0.5 };
        }
      }
    }
    return null;
  };
  let submitCompanionTask: (task: BuildTask) => void = () => {};
  const requestCabinPreview = (): void => {
    if (!companionController.getState()) {
      showCompanionNotice("Najpierw dodaj towarzysza.");
      return;
    }
    if (roomReady && lanClient) {
      const requestId = crypto.randomUUID();
      pendingBuildPreview = { planId: "", blocks: [], requestedBy: ownId ?? "" };
      lastBuildPreviewRequest = requestId;
      lanClient.send({ t: "build_preview", requestId, expectedGeneration: observedGeneration });
      return;
    }
    refreshCompanionBlockers();
    const plan = createHousePlan(
      world,
      { x: player.position.x, z: player.position.z, yaw: player.yaw },
      seed,
      (x, z, radius) => houseSiteOccupied(x, z, radius),
      "cabin",
    );
    if (!plan) {
      showCompanionNotice("Nie ma bezpiecznego miejsca na domek.");
      return;
    }
    const preview = { planId: `local-house-${crypto.randomUUID()}`, blocks: plan.blocks, requestedBy: "offline" };
    pendingBuildPreview = preview;
    showBuildPreview(preview.blocks);
    showCompanionNotice(`Domek: ${preview.blocks.length} bloków. Potwierdź budowę.`);
  };
  const confirmCabinPreview = (): void => {
    const preview = pendingBuildPreview;
    if (!preview || preview.blocks.length === 0) {
      showCompanionNotice("Najpierw wybierz domek.");
      return;
    }
    if (roomReady && lanClient) {
      if (preview.requestedBy !== ownId) {
        showCompanionNotice("Tylko autor może potwierdzić ten domek.");
        return;
      }
      lanClient.sendBuildConfirm(preview.planId);
      return;
    }
    activeBuildPlan = { ...preview, placed: 0, reserved: true };
    observedGeneration += 1;
    companionController.command("build", observedGeneration);
    if (!companionController.reserveBuild(preview.planId, preview.blocks)) {
      activeBuildPlan = null;
      showCompanionNotice("Towarzysz nie może rozpocząć budowy.");
      return;
    }
    pendingBuildPreview = null;
    clearBuildPreview();
  };
  const submitTask = (task: BuildTask): void => {
    if (task === "build") {
      requestCabinPreview();
      return;
    }
    if (task === "stop") {
      if (roomReady && lanClient) {
        lanClient.sendCompanionStop();
      } else {
        observedGeneration += 1;
        companionController.command("stop", observedGeneration);
      }
      clearBuildPreview();
      pendingBuildPreview = null;
      activeBuildPlan = null;
      return;
    }
    if (!companionController.getState()) {
      showCompanionNotice("Najpierw dodaj towarzysza.");
      return;
    }
    if (roomReady && lanClient) {
      lanClient.sendCompanionCommand(task, observedGeneration);
    } else {
      observedGeneration += 1;
      companionController.command(task, observedGeneration);
    }
  };
  submitCompanionTask = submitTask;
  const addCompanion = async (profile: CompanionProfileId): Promise<void> => {
    if (roomReady && roomOwnerId !== ownId) {
      showCompanionNotice("Tylko właściciel pokoju może dodać towarzysza.");
      return;
    }
    companionPanel.setBusy(true);
    if (!await prepareCompanionModel(profile)) {
      companionPanel.setBusy(false);
      return;
    }
    if (roomReady && lanClient) {
      const position = findLocalCompanionSpawn();
      if (!position) {
        showCompanionNotice("Nie znaleziono bezpiecznego miejsca obok ciebie.");
        companionPanel.setBusy(false);
        return;
      }
      const local = companionController.spawnLocal(profile, position, player.yaw);
      await displayCompanionState(local);
      lanClient.sendCompanionSpawn(profile);
      companionPanel.setBusy(false);
      return;
    }
    const position = findLocalCompanionSpawn();
    if (!position) {
      showCompanionNotice("Nie znaleziono bezpiecznego miejsca obok ciebie.");
      companionPanel.setBusy(false);
      return;
    }
    const state = companionController.spawnLocal(profile, position, player.yaw);
    await displayCompanionState(state);
    companionPanel.setBusy(false);
  };
  const removeCompanion = (): void => {
    const state = companionController.getState();
    if (!state) return;
    if (roomReady) {
      if (roomOwnerId !== ownId) {
        showCompanionNotice("Tylko właściciel pokoju może usunąć towarzysza.");
        return;
      }
      lanClient?.sendCompanionRemove(state.id);
      return;
    }
    companionController.applyServerRemove(state.id);
    removeCompanionAvatar();
  };
  let buddyMic: ReturnType<typeof createMicController> | null = null;
  let buddyGestureEpoch = 0;
  let buddyGestureHeld = false;
  let buddyLiveGesture: { id: number; epoch: number; mic: ReturnType<typeof createMicController> } | null = null;
  let buddyGestureExpiry = 0;
  let lastBuildPreviewRequest = "";
  const invalidateBuddyMic = (): void => {
    buddyGestureEpoch += 1;
    buddyGestureHeld = false;
    buddyLiveGesture = null;
    window.clearTimeout(buddyGestureExpiry);
    buddyMic?.cancel();
    buddyMic?.dispose();
    buddyMic = null;
  };
  const applyBuddyTranscript = (text: string): void => {
    const interpreted = interpretCompanionUtterance(text);
    if (!interpreted) {
      showCompanionNotice("Powiedz prościej.");
      return;
    }
    submitCompanionTask(interpreted.task);
  };
  const startBuddyMic = (): void => {
    if (!companionPanel.isOpen || paused || !gameStarted) return;
    invalidateBuddyMic();
    const epoch = buddyGestureEpoch;
    buddyGestureHeld = true;
    const micController = createMicController({
      maxSegmentMs: 10_000,
      silenceThresholdMs: 1_200,
      onTranscript: (text, gestureId) => {
        if (buddyLiveGesture?.id !== gestureId || buddyLiveGesture.epoch !== epoch ||
          !companionPanel.isOpen || paused || !gameStarted) return;
        buddyLiveGesture = null;
        window.clearTimeout(buddyGestureExpiry);
        micController.dispose();
        buddyMic = null;
        applyBuddyTranscript(text);
      },
      onError: (_code, gestureId) => {
        if (buddyLiveGesture?.id !== gestureId || buddyLiveGesture.epoch !== epoch) return;
        buddyLiveGesture = null;
        window.clearTimeout(buddyGestureExpiry);
        showCompanionNotice("Nie udało się rozpoznać mowy.");
        micController.dispose();
        buddyMic = null;
      },
    });
    buddyMic = micController;
    void micController.begin().then((gestureId) => {
      if (gestureId === null) {
        if (buddyMic === micController) buddyMic = null;
        micController.dispose();
        return;
      }
      if (epoch !== buddyGestureEpoch || !companionPanel.isOpen || paused) {
        micController.cancel();
        micController.dispose();
        return;
      }
      buddyLiveGesture = { id: gestureId, epoch, mic: micController };
      if (!buddyGestureHeld) {
        buddyGestureExpiry = window.setTimeout(() => invalidateBuddyMic(), 12_000);
      }
    }).catch(() => {
      if (epoch === buddyGestureEpoch) showCompanionNotice("Mikrofon jest niedostępny.");
      micController.dispose();
      if (buddyMic === micController) buddyMic = null;
    });
  };
  const endBuddyMic = (): void => {
    if (!buddyGestureHeld) return;
    buddyGestureHeld = false;
    buddyMic?.end();
    if (buddyLiveGesture) buddyGestureExpiry = window.setTimeout(() => invalidateBuddyMic(), 12_000);
  };
  companionPanel = createCompanionPanel({
    onAdd: (profile) => { void addCompanion(profile); },
    onRemove: removeCompanion,
    onFollow: () => submitTask("follow"),
    onScout: () => submitTask("scout"),
    onPreviewCabin: requestCabinPreview,
    onConfirmCabin: confirmCabinPreview,
    onStop: () => submitTask("stop"),
    onMute: (muted) => {
      buddyMuted = muted;
      if (muted) {
        invalidateBuddyMic();
        for (const id of buddySpeechIds) audio.speech.cancel(id);
        buddySpeechIds.clear();
      }
    },
    onVolume: (level) => {
      buddyVolume = level;
      if (level <= 0.05) {
        for (const id of buddySpeechIds) audio.speech.cancel(id);
        buddySpeechIds.clear();
      }
    },
    onTalkStart: startBuddyMic,
    onTalkEnd: endBuddyMic,
  });
  document.body.append(companionPanel.root);
  companionPanel.setModelChoice("staszek");
  const closeCompanionPanel = (): void => {
    companionPanel.close();
    invalidateBuddyMic();
    keys.clear();
    isMining = false;
    resetMiningFeedback();
  };
  const openCompanionPanel = (): void => {
    if (paused || !gameStarted) return;
    if (document.pointerLockElement) document.exitPointerLock();
    keys.clear();
    isMining = false;
    resetMiningFeedback();
    companionPanel.open();
  };

  const conciergeHost: ConciergeHost = {
    status: () => ({
      started: gameStarted,
      splitScreen: splitScreen.isSplitScreen,
      activePlayer: player.characterProfile,
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
    buildHouse: (target, archetype) => {
      const actor = playerForConcierge(target);
      const houseSeed = seed + houseBuildSequence++;
      const plan = createHousePlan(
        world,
        { x: actor.position.x, z: actor.position.z, yaw: actor.yaw },
        houseSeed,
        houseSiteOccupied,
        archetype
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
      return { blocks: plan.blocks.length, style: plan.style, archetype: plan.archetype };
    },
    digMine: (target) => {
      const actor = playerForConcierge(target);
      const plan = createMinePlan(
        world,
        { x: actor.position.x, y: actor.position.y, z: actor.position.z, yaw: actor.yaw },
        houseSiteOccupied
      );
      if (!plan || !applyMinePlan(plan, world, inventory)) return null;
      for (const block of plan.blocks) lanClient?.sendBlockEdit(block.x, block.y, block.z, BLOCK_ID.air);
      const first = plan.blocks[0];
      const position = new THREE.Vector3(first.x + 0.5, first.y + 0.5, first.z + 0.5);
      gameplayVfx.emit("mine", position);
      gameplayVfx.emit("debris", position, { tint: 0x8a7b66, groundY: first.y });
      gameplayVfx.emit("impact_ring", position, { tint: 0x8a7b66, groundY: first.y });
      audio.play("dig_stone");
      return plan.blocks.length;
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

  const pauseLanPanel = document.querySelector<HTMLElement>("#pause-lan-panel");
  const pauseLanBtn = document.querySelector<HTMLButtonElement>("#pause-lan");
  const lanMenu = new LanMenuController({
    root: pauseLanPanel!,
    onLeave: async () => leaveRoom(),
    onHost: async (roomName, hostSeed) => {
      const code = Math.random().toString(36).slice(2, 6).toUpperCase();
      const url = __GIERA_TEST_WS_URL__ || `ws://${window.location.hostname}:${DEFAULT_LAN_PORT}/ws`;
      return connectLan(url, code, {
        host: true,
        roomName,
        seed: hostSeed || seed,
        onConnected: (welcomeSeed) => {
          if (welcomeSeed !== seed) {
            sessionStorage.setItem("giera.pendingLanJoin", JSON.stringify({ url, room: code, host: false }));
            window.location.href = `?seed=${welcomeSeed}`;
          }
        },
      });
    },
    onJoin: async (url, room) => {
      return connectLan(url, room, {
        host: false,
        onConnected: (welcomeSeed) => {
          if (welcomeSeed !== seed) {
            sessionStorage.setItem("giera.pendingLanJoin", JSON.stringify({ url, room, host: false }));
            window.location.href = `?seed=${welcomeSeed}`;
          }
        },
      });
    },
    onScan: () => scanLanServers({ port: DEFAULT_LAN_PORT }),
    onClose: () => {
      pauseMenu.sync();
      pauseResume?.focus({ preventScroll: true });
    },
  });

  pauseLanBtn?.addEventListener("click", () => {
    if (pauseMenu.isOpen) lanMenu.openMenu();
  });

  const conciergeSession = new ConciergeSession({
    host: conciergeHost,
    root: conciergePanel,
    canvas: conciergeCanvas,
    statusEl: conciergeStatus,
    slots: { launch: launchConciergeSlot, pause: pauseConciergeSlot },
    retryEl: conciergeRetry,
    speech: audio.speech,
    onClosed: (reason) => {
      if (reason === "hidden") pauseMenu.close();
    },
  });
  const launchMenu = new LaunchMenuController({
    root: launchRoot,
    startButton: launchStart,
    modeButton: launchMode,
    conciergeSession,
    onStart: (settings, source) => {
      gameStarted = true;
      canvas.inert = false;
      if (hudRoot) {
        hudRoot.removeAttribute("inert");
        hudRoot.style.visibility = "";
      }
      attachTouchControls();
      suppressGamepadJumpUntilRelease = source === "gamepad";
      applyLaunchProfile(player, settings.profile);
      applyLaunchProfile(player2, settings.profile === "ziemek" ? "gniewko" : "ziemek");
      splitScreen.setSplitScreen(settings.splitScreen);
      hud.modeBtn.textContent = settings.splitScreen ? "Tryb: 2 Graczy (Ziemek & Gniewko)" : "Tryb: 1 Gracz";
      const pending = sessionStorage.getItem("giera.pendingLanJoin");
      if (pending) {
        sessionStorage.removeItem("giera.pendingLanJoin");
        try {
          const { url, room } = JSON.parse(pending) as { url: string; room: string };
          void connectLan(url, room, { host: false });
          return;
        } catch {
          // fall through to the active-room session
        }
      }
      if (activeRoomSession && !roomReady) {
        void connectLan(activeRoomSession.url, activeRoomSession.room, { host: false });
      }
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
    audio.speech.request({ kind: "text", speakerId: npcId, text, volume: Math.max(0, 1 - distance / 40) });
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
  if (qa && activeRoomSession && !roomReady && gameStarted) {
    void connectLan(activeRoomSession.url, activeRoomSession.room, { host: false });
  }
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
  const tntFuses = new TntFuseQueue();
  const SHAKE_DURATION = 0.5;
  let shakeTime = 0;
  let shakeAmp = 0;
  const explodeTnt = (cx: number, cy: number, cz: number): void => {
    const blast = planBlast((x, y, z) => world.getBlock(x, y, z), cx, cy, cz);
    for (const cell of blast.cleared) {
      world.setBlock(cell.x, cell.y, cell.z, BLOCK_ID.air);
      lanClient?.sendBlockEdit(cell.x, cell.y, cell.z, BLOCK_ID.air);
    }
    for (const cell of blast.chained) tntFuses.ignite(cell.x, cell.y, cell.z, TNT_CHAIN_FUSE_SECONDS);
    const center = new THREE.Vector3(cx + 0.5, cy + 0.5, cz + 0.5);
    gameplayVfx.emit("explosion", center);
    audio.play("explosion");
    shakeTime = SHAKE_DURATION;
    shakeAmp = 0.4;
    for (const p of [player, player2]) {
      const dx = p.position.x - center.x;
      const dy = p.position.y + 0.9 - center.y;
      const dz = p.position.z - center.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 0.01 && d < TNT_KNOCKBACK_RANGE) {
        const k = (1 - d / TNT_KNOCKBACK_RANGE) * TNT_KNOCKBACK_STRENGTH;
        p.velocity.x += (dx / d) * k;
        p.velocity.y += Math.abs(dy / d) * k * 0.6 + 3;
        p.velocity.z += (dz / d) * k;
      }
    }
  };
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
          onMicStart: async () => {
            const started = await mic.start();
            return { started, reason: started ? undefined : (mic.lastError ?? undefined) };
          },
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
      } else if (companionPanel.isOpen) {
        closeCompanionPanel();
      } else {
        pauseMenu.toggle();
      }
      audio.play("ui_click");
    } else if (e.code === "KeyB") {
      if (companionPanel.isOpen) {
        closeCompanionPanel();
      } else {
        openCompanionPanel();
      }
      audio.play("ui_click", { volume: 0.4 });
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
    }, currentSaveKey);
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
      tycoon.updateMenuVisuals(menuDelta);
      menuStage.update(menuDelta, camera, tycoon.origin);
      postfx.noteFrame(menuDelta);
      beatTracker.update();
      postfx.setBeatPulse(beatTracker.beatPulse);
      postfx.renderSolo(qa ? menuDelta : undefined);
      previous = now;
      return;
    }
    if (qa && qaState.pauseAt !== undefined && qaState.frame >= qaState.pauseAt) qaState.paused = true;
    const delta = qa ? (qaState.paused ? 0 : 1 / 60) : Math.min(0.05, Math.max(0, (now - previous) / 1000));
    previous = now;
    if (paused && companionPanel.isOpen) closeCompanionPanel();
    if (paused) {
      beatTracker.update();
      postfx.setBeatPulse(beatTracker.beatPulse);
      if (splitScreen.isSplitScreen) postfx.renderSplit(camera, camera2, qa ? delta : undefined);
      else postfx.renderSolo(qa ? delta : undefined);
      return;
    }
    if (qa && !qaState.paused) {
      qaState.simTime += delta;
      qaState.frame++;
    }
    elapsed = (elapsed + delta) % 600;

    refreshCompanionBlockers();
    const companionState = companionController.tick(delta);
    if (companionState) companionTarget = { ...companionState };
    if (companionTarget && companionAvatar) {
      const object = companionAvatar.object;
      const blend = Math.min(1, delta * 12);
      object.position.x += (companionTarget.x - object.position.x) * blend;
      object.position.y += (companionTarget.y - object.position.y) * blend;
      object.position.z += (companionTarget.z - object.position.z) * blend;
      object.rotation.y = companionTarget.yaw;
      const anim = companionTarget.anim;
      companionAvatar.setMotion(anim === "walk" ? "walk" : anim === "jump" ? "jump" : anim === "mine" ? "mine" : "idle");
    }

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
      const npcBodies = npcManager.npcs.map((n) => ({ x: n.position.x, y: n.position.y, z: n.position.z, radius: 0.4, height: 1.8 }));
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
      if (remoteActive && !splitScreen.isSplitScreen) {
        const lerp = Math.min(1, delta * 10);
        player2.position.lerp(remoteTarget, lerp);
        let dyaw = remoteYaw - player2.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        player2.yaw += dyaw * lerp;
        player2.pitch += (remotePitch - player2.pitch) * lerp;
        player2.syncAvatar();
      }
      const gb = (x: number, y: number, z: number): number => world.getBlock(x, y, z);
      const follow = (o: THREE.Object3D, x: number, y: number, z: number, grounded: boolean, damp: boolean, lift: number): void => {
        const activeLift = grounded ? lift : 0;
        let target = 0;
        if (grounded) {
          const centreOffset = smoothGroundOffset(gb, x, z, y);
          let footprintOffset = centreOffset;
          for (const [dx, dz] of GROUNDING_PROBES) {
            footprintOffset = Math.max(footprintOffset, smoothGroundOffset(gb, x + dx, z + dz, y));
          }
          const groundOffset = centreOffset + (footprintOffset - centreOffset) * 0.5;
          target = Math.max(-0.1, Math.min(0.5 - activeLift, groundOffset));
        }
        const prev = (o.userData.groundOffset as number | undefined) ?? target;
        const candidate = target > prev ? target : prev + (target - prev) * Math.min(1, delta * 12);
        const prevLift = (o.userData.locomotionLift as number | undefined) ?? activeLift;
        const nextLift = activeLift > prevLift
          ? activeLift
          : prevLift + (activeLift - prevLift) * Math.min(1, delta * 12);
        const next = Math.max(-0.1, Math.min(0.5 - nextLift, candidate));
        o.userData.groundOffset = next;
        o.userData.locomotionLift = nextLift;
        let baseY = y;
        if (damp) {
          const prevY = (o.userData.baseY as number | undefined) ?? y;
          baseY = Math.abs(y - prevY) > 2 ? y : prevY + (y - prevY) * Math.min(1, delta * 9);
          o.userData.baseY = baseY;
        }
        o.position.y = baseY + next + nextLift;
      };
      for (const p of [player, player2]) if (p.avatar) {
        const motion = p.avatar.currentMotion;
        const lift = motion === "walk" || motion === "sprint" ? PLAYER_GROUNDED_LOCOMOTION_LIFT[p.characterProfile] : 0;
        follow(p.avatar.object, p.position.x, p.position.y, p.position.z, p.onGround, false, lift);
      }
    }
    player.avatar?.update(delta);
    if (!splitScreen.isSplitScreen) player2.avatar?.update(delta);
    gameplayVfx.updateFootsteps("p1", player.position, player.onGround);
    gameplayVfx.updateFootsteps("p2", player2.position, splitScreen.isSplitScreen && player2.onGround);
    if (qa) {
      if (!qaLivePlayerPose) {
        player.avatar?.freezePose(0.5);
        player2.avatar?.freezePose(0.5);
      }
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
    if (shakeTime > 0) {
      shakeTime -= delta;
      const k = shakeAmp * Math.max(0, shakeTime / SHAKE_DURATION);
      camera.position.x += Math.sin(elapsed * 91.3) * k;
      camera.position.y += Math.sin(elapsed * 77.7 + 1.3) * k * 0.6;
      camera.position.z += Math.cos(elapsed * 83.1 + 0.6) * k;
    }
    if (splitScreen.isSplitScreen) {
      camera2.position.copy(player2.getCameraPosition(5.5));
      const t2 = player2.getCameraTarget();
      const c2 = collideCamera(t2, camera2.position, camSolid);
      camera2.position.set(c2.x, c2.y, c2.z);
      camera2.lookAt(player2.getCameraTarget());
    }

    tntFuses.update(
      delta,
      (x, y, z) => explodeTnt(x, y, z),
      (x, y, z) => gameplayVfx.emit("fuse", new THREE.Vector3(x + 0.5, y + 1.1, z + 0.5))
    );

    const nearestNpc = npcManager.getNearestNPC(player.position.x, player.position.y, player.position.z, 3.0);
    const shouldShowPrompt = nearestNpc && !hud.isNpcDialogOpen() && !hud.isInventoryOpen() && !hud.isControlsModalOpen();
    hud.setNpcPrompt(shouldShowPrompt ? nearestNpc.name : null);
    npcManager.updateAll(delta, (x, z) => surfaceHeight(Math.floor(x), Math.floor(z), seed), (x, y, z) => world.getBlock(x, y, z) !== 0);
    {
      const gb2 = (x: number, y: number, z: number): number => world.getBlock(x, y, z);
      for (const n of npcManager.npcs) {
        const o = n.avatar?.object;
        if (!o) continue;
        const target = Math.max(-0.1, Math.min(0.5, smoothGroundOffset(gb2, n.position.x, n.position.z, n.position.y)));
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
      const headY = 2.2;
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
      (coins) => tycoonFeedback(player, camera, false, "collect", coins),
      () => tycoonFeedback(player, camera, false, "upgrade", 6),
      () => {
        player.velocity.y = 22.0;
        gameplayVfx.emit("bounce", new THREE.Vector3(player.position.x, player.position.y + 0.2, player.position.z));
        player.onGround = false;
        audio.play("jump", { rate: 1.5, volume: 1.0 });
      },
      player.velocity.y,
      () => tycoonFeedback(player, camera, false, "expand", 6)
    );

    if (splitScreen.isSplitScreen) {
      tycoon.updateSecondary(
        delta,
        player2.position,
        (coins) => tycoonFeedback(player2, camera2, true, "collect", coins),
        () => tycoonFeedback(player2, camera2, true, "upgrade", 6),
        () => {
          gameplayVfx.emit("bounce", new THREE.Vector3(player2.position.x, player2.position.y + 0.2, player2.position.z));
          player2.velocity.y = 22.0;
          player2.onGround = false;
          audio.play("jump", { rate: 1.5, volume: 1.0 });
        },
        player2.velocity.y,
        () => tycoonFeedback(player2, camera2, true, "expand", 6)
      );
    }
    hud.updateTycoonFeedback(delta);
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
        if (bId === BLOCK_ID.tnt) {
          if (tntFuses.ignite(hit.hit.x, hit.hit.y, hit.hit.z, TNT_FUSE_SECONDS)) {
            audio.play("ui_click", { volume: 0.5 });
            resetMiningFeedback();
          }
        } else if (bId !== BLOCK_ID.air && bId !== BLOCK_ID.bedrock) {
          if (!miningBlock || miningBlock.x !== hit.hit.x || miningBlock.y !== hit.hit.y || miningBlock.z !== hit.hit.z) {
            miningBlock = { ...hit.hit, id: bId };
            miningProgress = 0;
            woodHitEffectTimer = 0;
          }

          const def = BLOCK_BY_ID[bId as BlockId];
          const hardness = def?.hardness ?? 1.0;
          const toolSpeed = inventory.getMiningSpeedMultiplier(bId);

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
            const tileMaterial = world.getTileMaterial(def?.tiles.side ?? "stone");
            const tint = tileMaterial && "color" in tileMaterial ? Number((tileMaterial as THREE.MeshStandardMaterial).color.getHex()) : 0xffffff;
            itemDrops.spawn(minedPosition.x, minedPosition.y, minedPosition.z, bId, tileMaterial);
            gameplayVfx.emit(bId === BLOCK_ID.oak_log ? "wood" : bId === BLOCK_ID.oak_leaves ? "leaves" : "mine", minedPosition);
            gameplayVfx.emit("debris", minedPosition, { tint, groundY: hit.hit.y });
            gameplayVfx.emit("impact_ring", minedPosition, { tint, groundY: hit.hit.y });
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
            } else if (isStoneFamily(bId)) {
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

    postfx.noteFrame(qa ? 1 / 60 : realDelta);
    beatTracker.update();
    postfx.setBeatPulse(beatTracker.beatPulse);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const viewports = getSplitViewports(width, height, splitScreen.isSplitScreen);
    camera.aspect = viewports[0].aspect;
    camera.updateProjectionMatrix();
    if (splitScreen.isSplitScreen && viewports.length > 1) {
      camera2.aspect = viewports[1].aspect;
      camera2.updateProjectionMatrix();
      postfx.renderSplit(camera, camera2, qa ? delta : undefined);
    } else {
      postfx.renderSolo(qa ? delta : undefined);
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
