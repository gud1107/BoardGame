/**
 * Chunked `state-sync` transport. A finished 14-player game holds ~90
 * drawings, which can exceed Supabase Realtime's per-message payload limit,
 * so the snapshot is serialized once and sent as ordered string slices that
 * the requester reassembles. Pure — no channel access — so it is unit-tested.
 */

export const SYNC_CHUNK_CHARS = 60_000;

export interface SyncChunk {
  /** Device the snapshot is for; everyone else ignores the chunk. */
  forDeviceId: string;
  /** Distinguishes two overlapping responses to the same request. */
  syncId: string;
  index: number;
  total: number;
  data: string;
}

export function splitIntoChunks(payload: string, forDeviceId: string, syncId: string, size = SYNC_CHUNK_CHARS): SyncChunk[] {
  const total = Math.max(1, Math.ceil(payload.length / size));
  return Array.from({ length: total }, (_, index) => ({
    forDeviceId,
    syncId,
    index,
    total,
    data: payload.slice(index * size, (index + 1) * size),
  }));
}

/** Collects chunks per `syncId`; `accept` returns the full payload once the last piece lands. */
export class ChunkAssembler {
  private readonly pending = new Map<string, string[]>();

  accept(chunk: SyncChunk): string | null {
    if (!Number.isInteger(chunk.total) || chunk.total < 1 || chunk.index < 0 || chunk.index >= chunk.total) return null;
    const parts = this.pending.get(chunk.syncId) ?? Array<string>(chunk.total);
    parts[chunk.index] = chunk.data;
    this.pending.set(chunk.syncId, parts);
    for (let i = 0; i < chunk.total; i++) if (parts[i] === undefined) return null;
    this.pending.delete(chunk.syncId);
    return parts.join("");
  }
}
