"use client";

import Overlay from "@/components/Overlay";
import { StarTile } from "./StarRummyBoard";

const T = (c: number, n: number) => c * 24 + (n - 1);

function Example({ ids, caption }: { ids: number[]; caption: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-0.5">
        {ids.map((id, i) => (
          <StarTile key={`${id}-${i}`} id={id} size="sm" />
        ))}
      </div>
      <span className="text-[11px] text-white/50 light:text-slate-500">{caption}</span>
    </div>
  );
}

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 light:text-slate-500 uppercase";
const EM = "text-emerald-300 light:text-emerald-700";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="🌌 별빛 러미 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <p className="text-white/70 light:text-slate-600">
            숫자 타일로 <span className={EM}>별자리(런·그룹)</span>를 만들어 테이블에 내려놓고, 손의 타일을 가장 먼저 모두 털어내면 라운드 승리! 2~4인, 1~3라운드의
            점수를 합쳐 가장 높은 사람이 최종 우승합니다.
          </p>
        </section>

        <section>
          <h3 className={H3}>1. 구성 (98장)</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              별빛 4색 — 루비 ●, 사파이어 ▲, 황금 ■, 에메랄드 ◆ — 각각 <b>1~12</b>, 같은 타일이 2장씩 (96장)
            </li>
            <li>☄️ 혜성(만능) 2장 — 어떤 숫자·색이든 대신할 수 있어요</li>
            <li>색마다 모양이 달라서 색을 구분하기 어려워도 모양으로 읽을 수 있어요</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>2. 준비</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>모든 타일을 섞어 각자 13장씩 받고, 3장을 앞면으로 펼쳐 🔭 관측소를 만듭니다. 나머지는 뒷면 더미.</li>
            <li>첫 라운드 선은 무작위, 다음 라운드부터는 왼쪽 사람으로 넘어가요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>3. 조합 (별자리)</h3>
          <div className="flex flex-wrap gap-4">
            <Example ids={[T(1, 4), T(1, 5), T(1, 6), T(1, 7)]} caption="런: 같은 색 연속 숫자 3장 이상" />
            <Example ids={[T(0, 9), T(2, 9), T(3, 9)]} caption="그룹: 같은 숫자 다른 색 3~4장" />
            <Example ids={[T(3, 3), 96, T(3, 5)]} caption="혜성은 빈자리를 채워요" />
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>런은 1부터 12까지, 12 다음에 1로 이어지지 않아요. 최대 12장.</li>
            <li>그룹에 같은 색이 두 번 들어갈 수 없어요 (그래서 최대 4장).</li>
            <li>혜성의 뜻은 조합에 맞춰 그때그때 정해져요 — 놓인 뒤에도 조합이 바뀌면 다른 숫자가 될 수 있어요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>4. 내 차례 — 둘 중 하나</h3>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              <b>내려놓기</b>: 손의 타일을 1장 이상 테이블에 내려놓아요. 차례가 끝날 때 테이블의 <span className={EM}>모든 조합이 올바라야</span> 해요.
            </li>
            <li>
              <b>한 장 가져오기</b>: 🔭 관측소의 앞면 타일 하나를 고르거나(빈자리는 더미에서 채움), 🎴 더미에서 뒷면으로 한 장. 내려놓을 수 있어도 일부러 가져와도 돼요.
            </li>
          </ol>
          <p className="mt-2 text-xs text-white/50 light:text-slate-500">관측소에서 가져가면 모두가 무슨 타일을 가져갔는지 알게 돼요 — 정보와 확실함의 거래!</p>
        </section>

        <section>
          <h3 className={H3}>5. ✨ 첫 관측 (첫 등록)</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              처음 내려놓을 때는 <b>내 손의 타일만으로</b> 만든 조합의 숫자 합이 <span className={EM}>24점 이상</span>이어야 해요. 혜성은 대신하는 숫자로 계산.
            </li>
            <li>첫 관측을 하는 차례에는 테이블에 이미 있는 조합을 건드릴 수 없어요. 첫 관측 전에도 관측소·더미에서 가져오기는 자유.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>6. 테이블 재배치</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>첫 관측을 마친 다음 차례부터는 테이블의 조합을 마음대로 쪼개고, 합치고, 타일을 옮겨 새 조합을 만들 수 있어요.</li>
            <li>단, 테이블의 타일을 손으로 가져갈 수는 없어요. 손에서 1장 이상은 꼭 보태야 해요.</li>
            <li>혜성 바꿔치기: 혜성이 대신하던 타일을 내가 넣고, 빠진 혜성은 같은 차례에 다른 조합에 써요 (혜성도 손으로는 못 가져와요).</li>
            <li>조작 중엔 <b>↩ 되돌리기</b>로 언제든 차례 시작 상태로 돌아갈 수 있어요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>7. 시간 제한</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>한 차례 90초. 시간이 끝나면 하던 조작은 취소되고 더미에서 한 장을 자동으로 가져와요.</li>
            <li>오래 응답이 없거나 연결이 끊긴 자리는 투표로 AI가 대신 맡을 수 있어요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>8. 라운드 끝 & 점수</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              누군가 손의 타일을 모두 내려놓으면 <b>러미!</b> — 라운드가 끝나요. 다른 사람은 남은 타일 숫자 합(혜성 20점)만큼 잃고, 러미한 사람은 그 합을 모두 얻어요.
            </li>
            <li>
              더미와 관측소가 모두 바닥나면 가져올 타일이 없는 차례는 <b>넘기기</b>. 모두가 한 바퀴 연속으로 넘기면 라운드 끝: 남은 합이 가장 적은 사람이 이기고, 나머지는 그
              사람과의 차이만큼 잃어요.
            </li>
            <li>정한 라운드(1~3)가 끝나면 합계 점수 순으로 순위. 동점은 공동 순위.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>9. 조작 방법</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>끌어다 놓기</b>: 타일을 조합·<b>＋ 새 조합</b> 칸·내 받침대로 끌어다 놓아요(휴대폰은 손가락으로). 여러 장을 골라 둔 뒤 그중 하나를 끌면 함께 움직여요.</li>
            <li>또는 타일을 눌러 고르고(여러 장 가능) → 놓을 조합을 누르거나 <b>＋ 새 조합</b>.</li>
            <li>테이블 타일도 같은 방법으로 옮겨요. 이번 차례에 낸 타일은 점선 테두리 — <b>✋ 손으로</b>로 되돌릴 수 있어요.</li>
            <li>올바르지 않은 조합은 빨간 테두리 ✕. 모두 올바르면 <b>✔ 내려놓기</b>가 켜져요.</li>
            <li>직전 사람이 낸 타일은 금빛으로 빛나요.</li>
            <li>첫 관측 전, 내 손에 24점 이상 조합이 있으면 그 타일들이 금빛 테두리로 깜빡여요 (없으면 안 빛나요).</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
