"use client";

import Overlay from "@/components/Overlay";
import { CardFace } from "./cardArt";

/** In-game summary of boardGameRule/블러프룰렛/블러프룰렛.md (the full rulebook is the source of truth). */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const h = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
  const box = "rounded-xl border border-white/15 bg-white/[0.03] p-3 light:border-slate-200 light:bg-white/90 light:shadow-sm";
  return (
    <Overlay title="📖 블러프 룰렛 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={h}>목표</h3>
          <p>
            카드로 거짓말하고, 남의 거짓말을 잡아내세요. 틀린 쪽은 <b>자기 리볼버</b>(6칸 중 실탄 1발, 재장전 없음)의 방아쇠를 당깁니다.
            마지막까지 <b className="text-amber-300 light:text-amber-700">살아남은 1명</b>이 승리합니다.
          </p>
        </section>

        <section>
          <h3 className={h}>카드</h3>
          <div className="flex flex-wrap items-end gap-3">
            {(["sun", "moon", "star", "mask", "skull"] as const).map((k) => (
              <div key={k} className="flex flex-col items-center gap-1 text-[11px]">
                <CardFace kind={k} className="h-16 w-12" />
                {k === "mask" ? "와일드" : k === "skull" ? "해골 모드" : "무늬"}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/60 light:text-slate-500">
            2~4인: 해·달·별 6장씩 + 가면 2장 (20장) · 5~6인: 9장씩 + 가면 3장 (30장). 해골 모드는 가면 1장이 해골로 바뀝니다.
          </p>
        </section>

        <section>
          <h3 className={h}>진행</h3>
          <ol className="list-decimal space-y-1 pl-4 text-xs">
            <li>라운드마다 살아 있는 모두가 5장씩 받고, <b>오늘의 카드</b>(해/달/별 중 하나)가 정해집니다.</li>
            <li>
              내 차례: <b>1~3장을 엎어 내기</b> (&ldquo;전부 오늘의 카드&rdquo;) 또는 직전 선언에 <b>&ldquo;거짓말!&rdquo;</b>. 패스는 없습니다.
            </li>
            <li>진짜 카드 = 오늘의 카드 + 🎭 가면. 1장이라도 가짜면 거짓말입니다.</li>
            <li>손패가 없는 사람은 건너뜁니다. 남들이 모두 손패가 없으면 다음 사람은 반드시 &ldquo;거짓말!&rdquo;을 외칩니다.</li>
          </ol>
        </section>

        <section>
          <h3 className={h}>판정과 룰렛</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className={box}>
              <p className="mb-1 font-medium">✅ 전부 진짜</p>
              <p className="text-xs text-white/60 light:text-slate-500">의심한 사람이 방아쇠</p>
            </div>
            <div className={box}>
              <p className="mb-1 font-medium">❌ 하나라도 가짜</p>
              <p className="text-xs text-white/60 light:text-slate-500">카드를 낸 사람이 방아쇠</p>
            </div>
          </div>
          <p className="mt-2 text-xs">
            방아쇠 위험: 1/6 → 1/5 → 1/4 → 1/3 → 1/2 → 6번째는 반드시 발사. 의심이 일어나면 라운드가 끝나고, 방아쇠를 당긴 사람(탈락했으면 다음 사람)이 다음 라운드의 선이 됩니다.
          </p>
        </section>

        <section>
          <h3 className={h}>💀 해골 모드 (선택)</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs">
            <li>해골을 <b>1장만 단독으로</b> 냈는데 의심받으면 → 해골을 낸 사람을 뺀 <b>모두</b>가 방아쇠를 당깁니다 (의심한 사람부터).</li>
            <li>다른 카드와 섞어 내면 해골은 가짜 → 거짓말 판정.</li>
            <li>의심받지 않고 지나가면 아무 일도 없습니다.</li>
          </ul>
        </section>

        <section>
          <h3 className={h}>팁</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs">
            <li>덱 구성은 공개 정보입니다. 내 손에 진짜가 많으면 남이 가진 진짜는 적습니다.</li>
            <li>많이 낸다고 수상한 건 아닙니다 — 진짜가 있는 사람만 크게 냅니다. 손패를 털어내는 마지막 한 장을 조심하세요.</li>
            <li>약실 표시(●)가 많이 찬 사람일수록 의심하기도, 의심받기도 무섭습니다.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
