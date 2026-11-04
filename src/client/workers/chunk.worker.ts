import { generateBlock, generateChunkWithCityTints } from "../../shared/worldgen";
import { meshChunk } from "../../shared/mesher";
import { WARSAW_CITY_TINT_PALETTES } from "../../shared/warsaw-city-data.generated";
import type { ChunkBuildRequest, ChunkBuildResponse } from "../../shared/chunk-worker-protocol";
import atlasManifest from "../../shared/atlas-manifest.json";

self.onmessage = (event: MessageEvent<ChunkBuildRequest>) => {
  const request = event.data;
  try {
    const { data, cityTintIds } = generateChunkWithCityTints(request.cx, request.cy, request.cz, request.seed);
    const mesh = meshChunk({
      data,
      cx: request.cx,
      cy: request.cy,
      cz: request.cz,
      getBlock: (x, y, z) => generateBlock(x, y, z, request.seed),
      atlas: atlasManifest.tiles,
      cityTintIds,
      cityTintPalettes: WARSAW_CITY_TINT_PALETTES,
    });
    const response: ChunkBuildResponse = { ...request, data, ...(cityTintIds ? { cityTintIds } : {}), mesh };
    const transfer: Transferable[] = [data.buffer, ...(cityTintIds ? [cityTintIds.buffer] : []), mesh.positions.buffer, mesh.normals.buffer, mesh.uvs.buffer, mesh.colors.buffer, mesh.tileIds.buffer, mesh.indices.buffer];
    self.postMessage(response, transfer);
  } catch (error) {
    const response: ChunkBuildResponse = { taskId: request.taskId, error: error instanceof Error ? error.message : "Chunk build failed" };
    self.postMessage(response);
  }
};
