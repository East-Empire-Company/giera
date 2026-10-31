const root = document.querySelector("[data-probe-root]");

function report(name, passed, detail) {
  const output = root.querySelector(`[data-check="${name}"]`);
  output.dataset.state = passed ? "pass" : "fail";
  output.textContent = detail;
}

const stylesheetReady = getComputedStyle(root).getPropertyValue("--probe-stylesheet").trim() === "ready";
report("stylesheet", stylesheetReady, stylesheetReady ? "Root stylesheet loaded." : "Root stylesheet missing.");

class Es2022Probe {
  static #label = "ES2022";

  static read() {
    return this.#label;
  }
}

const es2022Ready = Es2022Probe.read() === "ES2022"
  && Object.hasOwn({ ready: true }, "ready")
  && ["module", "ready"].at(-1) === "ready";
report("es2022", es2022Ready, es2022Ready ? "Module and ES2022 features ran." : "ES2022 feature missing.");

const gamepadReady = typeof navigator.getGamepads === "function";
const gamepadDetails = root.querySelector("[data-gamepad-details]");
report("gamepad", gamepadReady, gamepadReady ? "Gamepad API available." : "Gamepad API unavailable.");

const canvas = root.querySelector("[data-webgl-canvas]");
const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
report("webgl2", Boolean(gl), gl ? "WebGL 2 context created." : "WebGL 2 context unavailable.");

async function checkRootFetch() {
  const response = await fetch("/data/probe.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const passed = payload.kind === "giera-xbox-probe" && payload.revision === 1;
  report("root-fetch", passed, passed ? "Root JSON resource loaded." : "Root JSON payload mismatch.");
}

function waitForImage(image) {
  if (image.complete) {
    return image.naturalWidth > 0
      ? Promise.resolve()
      : Promise.reject(new Error("Texture image failed to load."));
  }

  return new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", () => reject(new Error("Texture image failed to load.")), { once: true });
  });
}

async function checkTexture() {
  if (!gl) throw new Error("WebGL 2 context unavailable.");
  const image = root.querySelector("[data-texture-preview]");
  await waitForImage(image);
  const texture = gl.createTexture();
  if (!texture) throw new Error("WebGL texture allocation failed.");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  const error = gl.getError();
  gl.deleteTexture(texture);
  if (error !== gl.NO_ERROR) throw new Error(`WebGL error ${error}.`);
  report("texture", true, "Root SVG uploaded to WebGL 2.");
}

function checkWorker() {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL("/probe-worker.js", import.meta.url), { type: "module" });
    } catch (error) {
      reject(error);
      return;
    }

    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("Worker did not respond."));
    }, 5000);

    worker.addEventListener("message", (event) => {
      window.clearTimeout(timeout);
      worker.terminate();
      const passed = event.data.kind === "giera-xbox-probe-worker"
        && event.data.moduleType === "module"
        && event.data.rootPath === "/data/probe.json";
      report("module-worker", passed, passed ? "Root module worker replied." : "Worker response mismatch.");
      resolve();
    }, { once: true });

    worker.addEventListener("error", (event) => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || "Module worker failed."));
    }, { once: true });

    worker.postMessage({ type: "probe" });
  });
}

void checkRootFetch().catch((error) => report("root-fetch", false, error.message));
void checkTexture().catch((error) => report("texture", false, error.message));
void checkWorker().catch((error) => report("module-worker", false, error.message));

const fpsOutput = root.querySelector("[data-probe-fps]");
let frameCount = 0;
let windowStart = performance.now();
let nextGamepadSample = 0;
let previousGamepadDetails = "";

function updateGamepad(now) {
  if (now < nextGamepadSample) return;
  nextGamepadSample = now + 100;

  let details;
  if (!gamepadReady) {
    details = "Gamepad API unavailable.";
  } else {
    try {
      const connected = Array.from(navigator.getGamepads()).filter(Boolean);
      if (connected.length === 0) {
        details = "No controller connected; API available.";
      } else {
        const gamepad = connected[0];
        const buttons = gamepad.buttons.map((button, index) => `${index}:${button.value.toFixed(1)}`).join(" ");
        const axes = Array.from(gamepad.axes, (value, index) => `${index}:${value.toFixed(2)}`).join(" ");
        details = `${connected.length} controller${connected.length === 1 ? "" : "s"}; pad ${gamepad.index}; buttons ${buttons}; axes ${axes}.`;
      }
    } catch (error) {
      details = error.message;
    }
  }

  if (details !== previousGamepadDetails) {
    gamepadDetails.textContent = details;
    previousGamepadDetails = details;
  }
}

function sampleFrame(now) {
  frameCount += 1;
  if (now - windowStart >= 1000) {
    const fps = Math.round(frameCount * 1000 / (now - windowStart));
    fpsOutput.textContent = `Page rAF: ${fps} FPS`;
    report("frame-rate", fps > 0, `Page rAF ${fps} FPS measured.`);
    frameCount = 0;
    windowStart = now;
  }

  updateGamepad(now);

  requestAnimationFrame(sampleFrame);
}

requestAnimationFrame(sampleFrame);

root.querySelector("[data-play-sound]").addEventListener("click", async () => {
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) {
    report("audio", false, "AudioContext unavailable.");
    return;
  }

  const context = new AudioContextConstructor();
  try {
    await context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.025, context.currentTime);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.15);
    const passed = context.state === "running";
    report("audio", passed, passed ? "Audio started after gesture." : `Audio state: ${context.state}.`);
  } catch (error) {
    report("audio", false, error.message);
  } finally {
    window.setTimeout(() => void context.close(), 300);
  }
});
