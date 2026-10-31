const results = {};
const out = document.getElementById('out');

function flush() {
  try {
    window.external.notify(JSON.stringify(results));
  } catch (e) {
    results.notify = 'unavailable: ' + e.message;
  }
}

function emit(key, value) {
  results[key] = value;
  const shown = value && typeof value === 'object' ? JSON.stringify(value) : String(value);
  out.textContent += key + ': ' + shown + '\n';
  flush();
}

async function step(key, fn) {
  try {
    const value = await fn();
    emit(key, value);
    return value;
  } catch (e) {
    emit(key, 'ERROR ' + (e && e.message ? e.message : String(e)));
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function es2022Report() {
  const report = {};
  const check = (name, fn) => {
    try {
      report[name] = fn() ? 'ok' : 'false';
    } catch (e) {
      report[name] = 'throw: ' + e.message;
    }
  };
  check('classPrivateFields', () => {
    class Box {
      #v = 7;
      read() {
        return this.#v;
      }
    }
    return new Box().read() === 7;
  });
  check('ergonomicBrandCheck', () => {
    class Box {
      #v = 1;
      static has(o) {
        return #v in o;
      }
    }
    return Box.has(new Box()) && !Box.has({});
  });
  check('objectHasOwn', () => Object.hasOwn({ a: 1 }, 'a'));
  check('arrayAt', () => [1, 2, 3].at(-1) === 3);
  check('structuredClone', () => structuredClone({ a: [1] }).a[0] === 1);
  check('logicalAssignment', () => {
    let a = null;
    a ??= 5;
    return a === 5;
  });
  check('errorCause', () => new Error('x', { cause: 1 }).cause === 1);
  check('regexpMatchIndices', () => new RegExp('a', 'd').exec('a').indices !== undefined);
  check('topLevelAwait', () => typeof results === 'object');
  return report;
}

async function webglReport() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) {
    return { context: 'null' };
  }
  const report = {
    context: 'webgl2',
    version: gl.getParameter(gl.VERSION),
    vendor: gl.getParameter(gl.VENDOR),
    renderer: gl.getParameter(gl.RENDERER),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxSamples: gl.getParameter(gl.MAX_SAMPLES),
    maxVertexUniformVectors: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
    colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
    floatLinear: !!gl.getExtension('OES_texture_float_linear'),
    anisotropic: !!gl.getExtension('EXT_texture_filter_anisotropic'),
    maxAnisotropy: gl.getExtension('EXT_texture_filter_anisotropic')
      ? gl.getParameter(gl.getExtension('EXT_texture_filter_anisotropic').MAX_TEXTURE_MAX_ANISOTROPY_EXT)
      : 0,
  };

  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, '#version 300 es\nin vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }');
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, '#version 300 es\nprecision highp float; out vec4 c; void main(){ c = vec4(0.0, 1.0, 0.0, 1.0); }');
  gl.compileShader(fs);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  report.linkOk = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (!report.linkOk) {
    report.linkLog = gl.getProgramInfoLog(program);
    return report;
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const px = new Uint8Array(4);
  gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  report.pixel = Array.from(px).join(',');
  report.renderOk = px[1] > 200 && px[0] < 40;
  return report;
}

async function fetchReport(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const text = await res.text();
  return { status: res.status, bytes: text.length, body: text.slice(0, 40) };
}

function xhrReport(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.onload = () => resolve({ status: xhr.status, bytes: (xhr.responseText || '').length });
    xhr.onerror = () => reject(new Error('xhr error status ' + xhr.status));
    xhr.send();
  });
}

function imageReport(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('image error'));
    img.src = url;
  });
}

function workerReport() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker timeout')), 4000);
    try {
      const worker = new Worker(new URL('./probe-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event.data);
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        reject(new Error('worker error ' + (event.message || 'unknown')));
      };
      worker.postMessage({ ping: 1 });
    } catch (e) {
      clearTimeout(timer);
      reject(new Error('worker construct failed: ' + e.message));
    }
  });
}

async function gamepadReport() {
  const seen = new Map();
  for (let i = 0; i < 40; i += 1) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      const pressed = pad.buttons.map((b, idx) => (b.pressed ? idx : -1)).filter((idx) => idx >= 0);
      const prev = seen.get(pad.index);
      if (!prev || pressed.length !== prev.buttons.length) {
        seen.set(pad.index, {
          index: pad.index,
          id: pad.id,
          mapping: pad.mapping,
          buttons: pressed,
          axes: Array.from(pad.axes).map((a) => Math.round(a * 100) / 100),
        });
      }
    }
    if (seen.size > 0 && [...seen.values()].some((p) => p.buttons.length > 0)) break;
    await sleep(50);
  }
  return { count: seen.size, pads: [...seen.values()] };
}

function fpsReport() {
  return new Promise((resolve) => {
    const deltas = [];
    let last = performance.now();
    const start = last;
    const tick = (now) => {
      deltas.push(now - last);
      last = now;
      if (now - start < 2000) {
        requestAnimationFrame(tick);
        return;
      }
      deltas.sort((a, b) => a - b);
      const p50 = deltas[Math.floor(deltas.length / 2)];
      resolve({
        frames: deltas.length,
        seconds: Math.round((now - start) / 100) / 10,
        fps: Math.round((deltas.length / (now - start)) * 10000) / 10,
        p50ms: Math.round(p50 * 100) / 100,
        worstMs: Math.round(deltas[deltas.length - 1] * 100) / 100,
      });
    };
    requestAnimationFrame(tick);
  });
}

async function audioReport() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return { context: 'unavailable' };
  const ctx = new Ctor();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0.05;
  osc.frequency.value = 440;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  await sleep(400);
  const state = ctx.state;
  const advanced = ctx.currentTime > 0.05;
  osc.stop();
  return { context: 'ok', state, currentTimeAdvanced: advanced };
}

async function storageReport() {
  const report = {};
  try {
    localStorage.setItem('probe', 'ok');
    report.localStorage = localStorage.getItem('probe');
  } catch (e) {
    report.localStorage = 'ERROR ' + e.message;
  }
  report.indexedDb = await new Promise((resolve) => {
    try {
      const req = indexedDB.open('probe', 1);
      req.onsuccess = () => resolve('ok');
      req.onerror = () => resolve('ERROR ' + (req.error && req.error.message));
      setTimeout(() => resolve('timeout'), 3000);
    } catch (e) {
      resolve('ERROR ' + e.message);
    }
  });
  return report;
}

emit('location', {
  href: location.href,
  baseURI: document.baseURI,
  userAgent: navigator.userAgent,
  dpr: window.devicePixelRatio,
  screen: window.screen.width + 'x' + window.screen.height,
  pointerFine: window.matchMedia('(pointer: fine)').matches,
});

emit('es2022', es2022Report());
await step('webgl2', webglReport);
await step('moduleImport', async () => {
  const mod = await import('/Assets/probe-mod.mjs');
  return { exported: mod.label, at: [3, 2, 1].at(-1) };
});
await step('fetchRootAbsolute', () => fetchReport('/Assets/probe-data.json'));
await step('xhrRootAbsolute', () => xhrReport('/Assets/probe-data.json'));
await step('imageLoad', () => imageReport('/Assets/probe-tex.png'));
await step('moduleWorker', workerReport);
await step('gamepads', gamepadReport);
await step('fps', fpsReport);
await step('storage', storageReport);

document.getElementById('start').addEventListener('click', async () => {
  await step('audio', audioReport);
});

emit('probeComplete', new Date().toISOString());