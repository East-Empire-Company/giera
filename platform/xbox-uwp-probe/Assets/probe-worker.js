export const workerModuleType = "module";

self.addEventListener("message", (event) => {
  if (event.data.type !== "probe") return;
  self.postMessage({
    kind: "giera-xbox-probe-worker",
    moduleType: workerModuleType,
    rootPath: new URL("/data/probe.json", import.meta.url).pathname,
  });
});
