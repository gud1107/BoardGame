import { GAME_LAST_COMMIT } from "@/constants/gameLastUpdated.generated";
import type { AdminSortOption } from "@/constants/sortOptions";
import type { GameRelease } from "@/lib/admin/gameReleases";

const KST = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = Object.fromEntries(KST.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

const STATE_LABEL: Partial<Record<GameRelease["state"], string>> = {
  building: "배포 중",
  failed: "배포 실패",
  pushed: "배포 대기",
};

/**
 * Admin-only footer on lobby cards while a 🛠 커밋/푸시/배포순 sort is active:
 * the game's newest commit and when it was pushed / reached production (KST).
 * The active sort's basis is highlighted.
 */
export default function AdminReleaseLine({
  gameId,
  release,
  option,
}: {
  gameId: string;
  release: GameRelease | undefined;
  option: AdminSortOption;
}) {
  const commitAt = release?.commitAt ?? GAME_LAST_COMMIT[gameId]?.at;
  if (!commitAt) return <p className="text-[9px] text-violet-300/60 light:text-violet-600">🛠 커밋 기록 없음</p>;
  const sha = (release?.sha ?? GAME_LAST_COMMIT[gameId]?.sha)?.slice(0, 7);
  const stateLabel = release ? STATE_LABEL[release.state] : undefined;
  const cell = (label: string, value: string, active: boolean) => (
    <span className={active ? "font-bold text-violet-200 light:text-violet-700" : ""}>
      {label} {value}
    </span>
  );
  return (
    <p
      className="flex flex-wrap gap-x-1.5 font-mono text-[9px] leading-tight text-violet-300/70 light:text-violet-600/80"
      title={sha ? `최신 게임 커밋 ${sha}` : undefined}
    >
      {cell("커밋", fmt(commitAt), option === "ADMIN_COMMIT_DESC")}
      {cell("푸시", release ? fmt(release.pushedAt) : "…", option === "ADMIN_PUSH_DESC")}
      {cell("배포", release ? (stateLabel ?? fmt(release.deployedAt)) : "…", option === "ADMIN_DEPLOY_DESC")}
    </p>
  );
}
