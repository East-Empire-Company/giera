import type { ChunkMesh } from "./mesher";

export type ChunkBuildRequest = { taskId: number; cx: number; cy: number; cz: number; seed: number; worldgenVersion: number };
export type ChunkBuildResult = ChunkBuildRequest & { data: Uint8Array; mesh: ChunkMesh };
export type ChunkBuildFailure = { taskId: number; error: string };
export type ChunkBuildResponse = ChunkBuildResult | ChunkBuildFailure;
