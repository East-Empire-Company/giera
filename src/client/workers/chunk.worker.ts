import { generateBlock, generateChunk } from "../../shared/worldgen";
import { meshChunk } from "../../shared/mesher";
import type { ChunkBuildRequest, ChunkBuildResponse } from "../../shared/chunk-worker-protocol";
import atlasManifest from "../../shared/atlas-manifest.json";

self.onmessage = (event: MessageEvent<ChunkBuildRequest>) => {
  const request = event.data;
  try {
    const data = generateChunk(request.cx, request.cy, request.cz, request.seed);
    const mesh = meshChunk({
      data,
      cx: request.cx,
      cy: request.cy,
      cz: request.cz,
      getBlock: (x, y, z) => generateBlock(x, y, z, request.seed),
      atlas: atlasManifest.tiles,
    });
    const response: ChunkBuildResponse = { ...request, data, mesh };
    const transfer: Transferable[] = [data.buffer, mesh.positions.buffer, mesh.normals.buffer, mesh.uvs.buffer, mesh.colors.buffer, mesh.tileIds.buffer, mesh.indices.buffer];
    self.postMessage(response, transfer);
  } catch (error) {
    const response: ChunkBuildResponse = { taskId: request.taskId, error: error instanceof Error ? error.message : "Chunk build failed" };
    self.postMessage(response);
  }
};
