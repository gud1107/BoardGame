"use client";

import { CardFace, HeartPips } from "@/games/coyote/CardArt";
import type { Card } from "@/games/coyote/engine";
import type { ExplainerScript } from "../types";
import { At, Big, Bubble, Felt, Heading, Panel, Seat, Stamp, Tag } from "../stage";
import { fade, lerp, pop, prog, pulse } from "../anim";
import { CAST, ChapterCard, CornerTag } from "./kit";

const num = (id: number, value: number): Card => ({ id, kind: "number", value });
const special = (id: number, kind: Card["kind"]): Card => ({ id, kind, value: 0 });

/** Four seats around the table; seat 0 (bottom) is "you". */
const SEATS: [number, number][] = [
  [800, 700],
  [260, 400],
  [800, 170],
  [1340, 400],
];
const HANDS: Card[] = [num(1, 10), num(2, 5), num(3, -5), num(4, 15)];

function Forehead({ card, hidden, s = 1.9 }: { card: Card; hidden?: boolean; s?: number }) {
  return (
    <Big s={s}>
      <CardFace card={hidden ? null : card} />
    </Big>
  );
}

export const coyoteScript: ExplainerScript = {
  gameId: "coyote",
  title: "코요테 룰 설명",
  kind: "animated",
  chapters: [
    {
      title: "인트로",
      scenes: [
        {
          cues: ["코요테는 내 카드만 나에게 안 보이는 인디언 포커 스타일의 블러핑 게임입니다.", "남의 카드는 다 보이는데 내 것만 모르는 상태에서, 테이블 전체 숫자의 합을 두고 허세를 부리게 돼요."],
          render: ({ t, at }) => (
            <Felt theme="desert">
              <At x={800} y={190} opacity={fade(t, 0)}>
                <Heading sub="Coyote · 3~8명 · 15~30분">🐺 코요테</Heading>
              </At>
              {HANDS.map((c, i) => (
                <At key={c.id} x={380 + i * 280} y={lerp(700, 520, prog(t, 0.4 + i * 0.15))} rot={-6 + i * 4} opacity={fade(t, 0.4 + i * 0.15)}>
                  <Forehead card={c} hidden={i === 0 && t > at(1)} s={2.2} />
                </At>
              ))}
              <At x={380} y={330} opacity={fade(t, at(1) + 0.4)}>
                <Bubble>내 건 안 보여!</Bubble>
              </At>
            </Felt>
          ),
        },
      ],
    },
    {
      title: "준비: 이마에 카드 한 장",
      scenes: [
        {
          cues: [" "],
          tail: 1.4,
          render: ({ t }) => (
            <Felt theme="desert">
              <ChapterCard t={t} n={1} icon="🃏" title="준비" sub="이마에 카드 한 장" />
            </Felt>
          ),
        },
        {
          cues: [
            "라운드마다 모두 카드를 한 장씩 받아서, 내용을 보지 않고 이마에 붙입니다.",
            "그래서 여우인 나에게는 내 카드만 물음표로 보이고, 다른 사람 카드는 전부 보여요.",
            "목숨은 하트 2개. 이 앱은 하우스룰로 2개로 시작하고, 다 잃으면 탈락입니다.",
          ],
          render: ({ t, at }) => (
            <Felt theme="desert">
              <CornerTag>예시 · 4인 · 나는 여우</CornerTag>
              {SEATS.map(([x, y], i) => (
                <At key={i} x={x} y={y} opacity={fade(t, 0.1 * i)}>
                  <div className="flex items-center gap-6">
                    <Seat {...CAST[i]} active={i === 0} sub={t > at(2) ? <div style={{ transform: "scale(2)", marginTop: 18 }}><HeartPips hearts={2} max={2} /></div> : undefined} />
                    <div style={{ opacity: prog(t, 0.6 + i * 0.25, 0.4) }}>
                      <Forehead card={HANDS[i]} hidden={i === 0 && t > at(1) - 0.2} />
                    </div>
                  </div>
                </At>
              ))}
              <At x={800} y={430} opacity={fade(t, at(1) + 0.5, at(2))}>
                <Panel accent="#fbbf24">
                  <div className="text-[34px] font-bold whitespace-nowrap">여우 눈에 보이는 합: 5 − 5 + 15 = <span className="text-amber-300">15</span> + ❓</div>
                </Panel>
              </At>
            </Felt>
          ),
        },
      ],
    },
    {
      title: "선언 올리기",
      scenes: [
        {
          cues: [" "],
          tail: 1.4,
          render: ({ t }) => (
            <Felt theme="desert">
              <ChapterCard t={t} n={2} icon="📣" title="선언 올리기" sub="모든 카드의 합은 최소 몇?" />
            </Felt>
          ),
        },
        {
          cues: [
            "차례가 되면 '모든 이마 카드의 합이 최소 이만큼은 된다'고 숫자를 선언합니다.",
            "여우는 남들 합이 15니까, 내 카드까지 생각해 18을 불렀어요. 첫 선언은 1 이상이어야 합니다.",
            "다음 사람은 반드시 더 큰 숫자를 불러야 해요. 곰돌이는 22.",
            "단, 이 앱에선 직전보다 딱 1만 올리는 건 한 라운드에 한 사람당 한 번만 쓸 수 있어요.",
            "토끼도 23을 부르며 그 +1 찬스를 썼네요. 이제 호랑이 차례. 호랑이 눈엔 합이 10밖에 안 보입니다.",
          ],
          render: ({ t, at, cue }) => {
            const bids = [
              { seat: 0, n: 18, at: at(1) + 0.6 },
              { seat: 1, n: 22, at: at(2) + 0.4 },
              { seat: 2, n: 23, at: at(4) + 0.3 },
            ];
            const active = cue <= 1 ? 0 : cue <= 3 ? 1 : 3;
            const last = [...bids].reverse().find((b) => t >= b.at);
            return (
              <Felt theme="desert">
                {SEATS.map(([x, y], i) => (
                  <At key={i} x={x} y={y}>
                    <div className="flex items-center gap-6">
                      <Seat {...CAST[i]} active={i === active} />
                      <Forehead card={HANDS[i]} hidden={i === 0} s={1.5} />
                    </div>
                  </At>
                ))}
                {bids.map((b, i) => (
                  <At key={i} x={SEATS[b.seat][0] + (SEATS[b.seat][1] < 300 ? 330 : 0)} y={SEATS[b.seat][1] - (SEATS[b.seat][1] < 300 ? 0 : 150)} opacity={fade(t, b.at, (bids[i + 1]?.at ?? Infinity) + 0.6)} scale={pop(t, b.at)}>
                    <Bubble>{b.n}!</Bubble>
                  </At>
                ))}
                {last && (
                  <At x={800} y={430} scale={1 + 0.03 * pulse(t)}>
                    <div className="flex flex-col items-center rounded-[28px] border-4 border-amber-300 bg-black/60 px-10 py-4">
                      <div className="text-[24px] font-bold text-amber-200">현재 선언</div>
                      <div className="text-[90px] leading-none font-black text-white">{last.n}</div>
                    </div>
                  </At>
                )}
                <At x={800} y={560} opacity={fade(t, at(3), at(4) + 1.5)}>
                  <Tag color="#b45309">+1 올리기는 1인 1라운드 1회</Tag>
                </At>
              </Felt>
            );
          },
        },
      ],
    },
    {
      title: "코요테! 판정",
      scenes: [
        {
          cues: [" "],
          tail: 1.4,
          render: ({ t }) => (
            <Felt theme="desert">
              <ChapterCard t={t} n={3} icon="🐺" title="코요테!" sub="뻥이라고 생각되면 외쳐라" />
            </Felt>
          ),
        },
        {
          cues: [
            "직전 선언이 너무 크다고 생각되면, 숫자 대신 '코요테!'를 외쳐 승부를 겁니다.",
            "그러면 모든 카드를 공개해서 진짜 합을 계산해요. 10 더하기 5, 빼기 5, 더하기 15. 합은 25!",
            "진짜 합이 선언보다 크거나 같으면 선언은 맞은 것. 코요테를 외친 사람이 하트를 잃어요.",
            "진짜 합이 선언보다 작았다면 반대로 선언한 사람이 하트를 잃습니다. 이번엔 25가 23 이상이니 호랑이가 하트 하나를 잃었네요.",
          ],
          render: ({ t, at }) => {
            const reveal = prog(t, at(1) + 0.3, 0.6);
            return (
              <Felt theme="desert">
                <At x={1340} y={240} scale={pop(t, 0.3)}>
                  <Bubble color="#f97316" text="#fff" size={44}>
                    코요테!
                  </Bubble>
                </At>
                {SEATS.map(([x, y], i) => (
                  <At key={i} x={x} y={y}>
                    <div className="flex items-center gap-6">
                      <Seat
                        {...CAST[i]}
                        active={i === 3}
                        sub={i === 3 && t > at(3) + 1.5 ? <div style={{ transform: "scale(2)", marginTop: 18 }}><HeartPips hearts={1} max={2} lostIndex={1} /></div> : undefined}
                      />
                      <div style={{ transform: `scaleX(${i === 0 ? Math.abs(Math.cos(reveal * Math.PI)) : 1})` }}>
                        <Forehead card={HANDS[i]} hidden={i === 0 && reveal < 0.5} s={1.5} />
                      </div>
                    </div>
                  </At>
                ))}
                <At x={800} y={410} opacity={fade(t, at(1) + 1)}>
                  <Panel accent="#fbbf24">
                    <div className="text-center text-[40px] font-black whitespace-nowrap">
                      진짜 합 <span className="text-amber-300">25</span> vs 선언 <span className="text-white">23</span>
                    </div>
                  </Panel>
                </At>
                <At x={800} y={545} opacity={fade(t, at(2) + 0.4)} scale={pop(t, at(2) + 0.4)}>
                  <Stamp ok label="선언 성공" />
                </At>
                <At x={1340} y={590} opacity={fade(t, at(3) + 1.5)}>
                  <Tag color="#dc2626">❤️ −1</Tag>
                </At>
              </Felt>
            );
          },
        },
        {
          cues: ["정리하면 이렇습니다."],
          tail: 4,
          render: ({ t }) => (
            <Felt theme="desert">
              <At x={800} y={170} opacity={fade(t, 0)}>
                <Heading>⚖️ 판정 규칙</Heading>
              </At>
              <At x={470} y={480} scale={pop(t, 0.4)}>
                <Panel w={600} accent="#22c55e">
                  <div className="text-center text-[34px] leading-snug font-bold break-keep">
                    진짜 합 <b className="text-emerald-300">≥</b> 선언
                    <br />→ <span className="text-rose-300">코요테 외친 사람</span> ❤️−1
                  </div>
                </Panel>
              </At>
              <At x={1130} y={480} scale={pop(t, 0.9)}>
                <Panel w={600} accent="#ef4444">
                  <div className="text-center text-[34px] leading-snug font-bold break-keep">
                    진짜 합 <b className="text-rose-300">&lt;</b> 선언
                    <br />→ <span className="text-rose-300">선언한 사람</span> ❤️−1
                  </div>
                </Panel>
              </At>
            </Felt>
          ),
        },
      ],
    },
    {
      title: "특수 카드",
      scenes: [
        {
          cues: [" "],
          tail: 1.4,
          render: ({ t }) => (
            <Felt theme="desert">
              <ChapterCard t={t} n={4} icon="✨" title="특수 카드" sub="계산 순서가 중요해요" />
            </Felt>
          ),
        },
        {
          cues: [
            "숫자 카드는 1부터 20, 그리고 마이너스 카드와 0도 있어요. 여기에 특수 카드 네 장이 섞여 있습니다.",
            "보물상자 물음표 카드가 있으면, 판정 때 덱에서 한 장을 더 뽑아 그 숫자를 더해요.",
            "인디언 소녀, 맥스 제로 카드는 테이블에서 가장 큰 숫자 카드 하나를 0으로 만듭니다.",
            "인디언 추장, 곱하기 2 카드는 마지막에 합계 전체를 두 배로 만들어요.",
            "그리고 밤 카드는 0으로 치지만, 이 카드를 단 사람이 다음 라운드의 첫 선언자가 됩니다.",
            "계산 순서는 물음표 뽑기, 맥스 제로, 곱하기 2. 이 순서만 기억하세요!",
          ],
          render: ({ t, at, cue }) => {
            const cards: { c: Card; at: number }[] = [
              { c: special(10, "question"), at: at(1) },
              { c: special(11, "maxZero"), at: at(2) },
              { c: special(12, "double"), at: at(3) },
              { c: special(13, "night"), at: at(4) },
            ];
            return (
              <Felt theme="desert">
                <At x={800} y={150} opacity={fade(t, 0, at(1))}>
                  <div className="flex gap-5">
                    {[num(20, 1), num(21, 5), num(22, 10), num(23, 20), num(24, -5), num(25, -10), num(26, 0)].map((c, i) => (
                      <div key={c.id} style={{ opacity: prog(t, 0.2 + i * 0.1, 0.3) }}>
                        <Big s={1.4}>
                          <CardFace card={c} />
                        </Big>
                      </div>
                    ))}
                  </div>
                </At>
                {cards.map(({ c, at: a }, i) => (
                  <At key={c.id} x={260 + i * 360} y={cue >= 5 ? 360 : 430} scale={pop(t, a) * (cue === i + 1 ? 1.08 : 0.92)}>
                    <div className="flex flex-col items-center gap-10">
                      <Forehead card={c} s={2.4} />
                      <div className="text-center text-[28px] font-bold text-white" style={{ opacity: cue === i + 1 || cue >= 5 ? 1 : 0.55 }}>
                        {["덱에서 1장 더", "최대 카드 → 0", "합계 × 2", "다음 라운드 선"][i]}
                      </div>
                    </div>
                  </At>
                ))}
                <At x={800} y={720} opacity={fade(t, at(5) + 0.3)} scale={pop(t, at(5) + 0.3)}>
                  <div className="flex items-center gap-4 text-[40px] font-black whitespace-nowrap text-white">
                    <Tag color="#b45309" size={34}>1 ❓ 뽑기</Tag>→<Tag color="#be185d" size={34}>2 MAX→0</Tag>→<Tag color="#047857" size={34}>3 ×2</Tag>
                  </div>
                </At>
              </Felt>
            );
          },
        },
        {
          cues: [
            "예시를 볼까요? 10, 5, 20, 그리고 맥스 제로와 곱하기 2가 있어요.",
            "먼저 가장 큰 20이 0이 되고, 남은 합은 15. 마지막으로 두 배를 해서 최종 합은 30입니다.",
          ],
          render: ({ t, at }) => {
            const zero = prog(t, at(1) + 0.3, 0.4);
            return (
              <Felt theme="desert">
                {[num(30, 10), num(31, 5), num(32, 20), special(33, "maxZero"), special(34, "double")].map((c, i) => (
                  <At key={c.id} x={300 + i * 250} y={380} scale={pop(t, 0.2 + i * 0.12)} opacity={i === 2 ? 1 - zero * 0.6 : 1}>
                    <Forehead card={c} s={2.1} />
                  </At>
                ))}
                <At x={800} y={380} opacity={zero}>
                  <Stamp ok={false} label="20 → 0" />
                </At>
                <At x={800} y={680} opacity={fade(t, at(1) + 1.2)}>
                  <Panel accent="#fbbf24">
                    <div className="text-[46px] font-black whitespace-nowrap">
                      (10 + 5 + <span className="text-rose-300">0</span>) × 2 = <span className="text-amber-300">30</span>
                    </div>
                  </Panel>
                </At>
              </Felt>
            );
          },
        },
      ],
    },
    {
      title: "승리 조건 · 팁",
      scenes: [
        {
          cues: [
            "판정이 끝나면 카드를 새로 받아 다음 라운드를 진행합니다.",
            "하트를 모두 잃으면 탈락, 마지막까지 살아남은 한 명이 승리!",
            "팁 하나. 내 카드는 모르지만, 남들이 부르는 숫자를 들으면 내 카드가 큰지 작은지 짐작할 수 있어요. 그럼 방을 만들어 직접 해 보세요!",
          ],
          tail: 1.2,
          render: ({ t, at }) => (
            <Felt theme="desert">
              <At x={800} y={170} opacity={fade(t, 0)}>
                <Heading>🏆 최후의 1인</Heading>
              </At>
              {SEATS.map((_, i) => (
                <At key={i} x={380 + i * 280} y={450} scale={i === 2 ? 1 + 0.05 * pulse(t) : 0.9}>
                  <Seat {...CAST[i]} dim={i !== 2 && t > at(1) + 0.3 + i * 0.2} active={i === 2 && t > at(1) + 1} />
                </At>
              ))}
              <At x={940} y={300} opacity={fade(t, at(1) + 1)} scale={pop(t, at(1) + 1)}>
                <div className="text-[80px]">👑</div>
              </At>
              <At x={800} y={720} opacity={fade(t, at(2))}>
                <Tag color="#b45309" size={32}>
                  💡 남들의 선언으로 내 카드를 추리하기
                </Tag>
              </At>
            </Felt>
          ),
        },
      ],
    },
  ],
};
