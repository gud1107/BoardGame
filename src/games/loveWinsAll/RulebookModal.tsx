"use client";

import Overlay from "@/components/Overlay";
import { ANTE, declarableHands, HAND_CATEGORY_LABEL, LIAR_PENALTY, STARTING_CHIPS, type Variant } from "./engine";

export default function RulebookModal({ variant, onClose }: { variant: Variant; onClose: () => void }) {
  return (
    <Overlay title="💗 러브 윈즈 올 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <p className="break-keep text-white/70">
            가위·바위·보에 <span className="text-pink-300">러브</span> 카드가 더해진 패로 족보를 만들어, 포커처럼
            베팅을 주고받으며 상대의 칩을 모두 가져오면 승리하는 <span className="text-pink-300">1:1 대결</span>
            게임입니다.
          </p>
          <p className="mt-2 break-keep text-xs text-white/40">
            [확인된 하우스 결정] 룰북 원문(기본판)과 부록(시즌2 개선판 &ldquo;러브 윈즈 올 2&rdquo;)이 함께 실려 있어 세션 시작
            전 사용자와 직접 확인했습니다: <b>기본판을 기본값</b>으로 하고 방장이 방 생성 시 시즌2 변형으로 전환
            가능, 베팅은 <b>노리밋</b>(레이즈 상한 없음, 전 칩 올인까지 허용), 기본판 덱은 매 라운드 종료 시 셔플해
            재사용(무한 진행 보장), 룰북 J절의 연습 게임은 생략하고 바로 본게임으로 시작합니다.
          </p>
        </section>

        {variant === "base" ? (
          <>
            <section>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">구성물</h3>
              <p className="break-keep text-white/70">
                가위 12장·바위 7장·보 7장·러브 4장(총 30장), 개인 칩 각자 {STARTING_CHIPS.base}개.
              </p>
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">족보표 (숫자가 낮을수록 강함)</h3>
              <ol className="list-decimal space-y-1 pl-5 break-keep text-white/70">
                {declarableHands("base").map((h) => (
                  <li key={h}>{HAND_CATEGORY_LABEL[h]}</li>
                ))}
              </ol>
            </section>
          </>
        ) : (
          <>
            <section>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
                구성물 (러브 윈즈 올 2 · 시즌2 개선판)
              </h3>
              <p className="break-keep text-white/70">
                가위 18장·바위 12장·보 12장·러브 6장·라이어 1장(총 49장), 개인 칩 각자 {STARTING_CHIPS.lwa2}개. 공유
                카드 1장 + 개인 카드 3장으로 총 4장의 족보를 만드는 홀덤 방식입니다. 라이어 카드는 원하는 조합으로든
                선언 가능한 조커지만, 승부에서 지면(동률 포함 항상 패배 처리) 칩 {LIAR_PENALTY}개를 추가로 지불합니다.
              </p>
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">족보표 (숫자가 낮을수록 강함)</h3>
              <ol className="list-decimal space-y-1 pl-5 break-keep text-white/70">
                {declarableHands("lwa2").map((h) => (
                  <li key={h}>{HAND_CATEGORY_LABEL[h]}</li>
                ))}
              </ol>
            </section>
          </>
        )}

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">라운드 진행 순서</h3>
          <ol className="list-decimal space-y-1.5 pl-5 break-keep text-white/70">
            <li>매 라운드 시작 시 둘 다 칩 {ANTE}개씩 필수 베팅(안테) 후 카드를 받습니다.</li>
            <li>1차 베팅(콜/레이즈/폴드, 노리밋)을 진행합니다.</li>
            <li>각자 카드 1장을 공개하고 자신의 족보를 선언합니다 — <b>거짓 선언(블러핑)도 가능</b>합니다.</li>
            <li>선언 내용을 참고해 2차 베팅을 다시 진행합니다.</li>
            <li>남은 카드를 모두 공개해 족보를 비교, 더 높은 쪽이 팟을 가져갑니다.</li>
          </ol>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">무승부 · 폴드 · 승리 조건</h3>
          <p className="break-keep text-white/70">
            두 족보가 완전히 동일한 무승부는 팟을 나누지 않고 다음 라운드로 이월합니다. 베팅 도중 포기(폴드)하면
            카드는 공개하지 않고 라운드가 종료됩니다. 상대방의 칩을 전부 가져오는 순간 즉시 게임이 종료되고
            승리합니다. 거짓 족보 선언에 대한 별도 페널티는 없습니다 — 순수한 심리전 용도입니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
