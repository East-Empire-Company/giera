export type GLCapabilities = {
  vendor: string;
  renderer: string;
  software: boolean;
  webgl2: boolean;
};

const SOFTWARE_RENDERER_PATTERN = /swiftshader|llvmpipe|software|warp|basic render/i;

export function isSoftwareRenderer(vendor: string, renderer: string): boolean {
  return SOFTWARE_RENDERER_PATTERN.test(`${vendor} ${renderer}`);
}

export function probeWebGL(): GLCapabilities {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return { vendor: "none", renderer: "none", software: true, webgl2: false };
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = String(debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
    const renderer = String(debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const webgl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { vendor, renderer, software: isSoftwareRenderer(vendor, renderer), webgl2 };
  } catch {
    return { vendor: "unknown", renderer: "unknown", software: true, webgl2: false };
  }
}
