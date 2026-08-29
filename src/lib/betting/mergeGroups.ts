/**
 * Post-hoc "same person, different name" consolidation for a settlement view.
 *
 * This is a *presentation-layer* grouping only — it never rewrites a
 * session's underlying `BettingRound.deltas`/`rankedPlayerIds` (or a room
 * ledger's per-round deltas). Those stay immutable and keyed by whatever raw
 * id was actually used at the time (a `playerId` for the local device-bound
 * tool, a seat key for an online room). A `MergedGroup` just says "when
 * building the settlement table, fold these raw ids into one display row
 * under this canonical id's name" — which is what makes `unmergeParticipants`
 * below a trivial, lossless operation (delete the grouping; the raw rounds
 * were never touched) instead of an unwind of destructive history rewrites.
 */

export interface MergedGroup {
  /** The raw id (playerId or seat key) whose current display name represents the group. */
  canonicalId: string;
  /** All raw ids folded into this group, including `canonicalId` itself. */
  memberIds: string[];
}

/**
 * Folds `memberIds` (which may already individually belong to other groups)
 * into one group under `canonicalId`. Any prior group containing one of
 * these ids is dissolved first — a raw id can only ever belong to one group
 * at a time, so re-merging is always well-defined instead of nesting groups.
 */
export function mergeParticipants(
  groups: MergedGroup[],
  canonicalId: string,
  memberIds: string[],
): MergedGroup[] {
  // Re-merging under an id that already leads a group adds to that group
  // instead of replacing it — otherwise a second "합치기" on the same
  // canonical would silently drop whoever was folded in the first time.
  const existingForCanonical = groups.find((g) => g.memberIds.includes(canonicalId));
  const allMembers = new Set([canonicalId, ...memberIds, ...(existingForCanonical?.memberIds ?? [])]);
  const untouched = groups.filter((g) => !g.memberIds.some((id) => allMembers.has(id)));
  return [...untouched, { canonicalId, memberIds: [...allMembers] }];
}

/** Dissolves the group led by `canonicalId` entirely — every member reverts to its own row. */
export function unmergeParticipants(groups: MergedGroup[], canonicalId: string): MergedGroup[] {
  return groups.filter((g) => g.canonicalId !== canonicalId);
}

/** Pulls a single id back out of whichever group it's currently in (if any), leaving the rest of that group merged. */
export function removeMember(groups: MergedGroup[], memberId: string): MergedGroup[] {
  return groups
    .map((g) => {
      if (!g.memberIds.includes(memberId)) return g;
      const remaining = g.memberIds.filter((id) => id !== memberId);
      if (remaining.length <= 1) return null; // group dissolves once only the canonical (or nobody) is left
      return { ...g, canonicalId: g.canonicalId === memberId ? remaining[0] : g.canonicalId, memberIds: remaining };
    })
    .filter((g): g is MergedGroup => g !== null);
}

/** The group id (`canonicalId`) that `rawId` currently displays under — itself, if ungrouped. */
export function resolveGroupId(groups: MergedGroup[], rawId: string): string {
  return groups.find((g) => g.memberIds.includes(rawId))?.canonicalId ?? rawId;
}

/** All raw ids that fold into `groupId`'s row — just `[groupId]` if it isn't part of any group. */
export function membersOf(groups: MergedGroup[], groupId: string): string[] {
  return groups.find((g) => g.canonicalId === groupId)?.memberIds ?? [groupId];
}
