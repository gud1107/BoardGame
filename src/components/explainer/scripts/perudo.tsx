"use client";

import type { ExplainerScript } from "../types";
import { At, Bubble, Die, Felt, Heading, Panel, Seat, Stamp, Tag } from "../stage";
import { fade, hash01, lerp, pop, prog, pulse } from "../anim";
import { CAST, ChapterCard, CornerTag } from "./kit";

const DICE: number[][] = [
  [2, 3, 3, 1, 5],
  [3, 6, 1, 4, 4],
  [3, 2, 6, 5, 5],
];
const SEATS: [number, number][] = [
  [800, 760],
  [260, 300],
  [1340, 300],
];

/** Count of `face` across all dice, 1s wild (unless counting 1s). */
const countOf = (face: number) => DICE.flat().filter((d) => d === face || (face !== 1 && d === 1)).length;

function Cup({ lift = 0, color = "#7c2d12" }: { lift?: number; color?: string }) {
  return (
    <div
      className="rounded-t-[60px] rounded-b-[18px] border-4 border-black/30"
      style={{
        width: 170,
        height: 150,
        transform: `translateY(${-lift * 130}px) rotate(${lift * -8}deg)`,
        background: `linear-gradient(90deg, ${color}, #f59e0b 45%, ${color})`,
        boxShadow: "0 18px 30px rgba(0,0,0,.5)",
        backgroundImage: `linear-gradient(90deg, ${color}, #ea580c 45%, ${color}), repeating-linear-gradient(0deg, transparent 0 22px, rgba(0,0,0,.25) 22px 28px)`,
      }}
    />
  );
}

/** A row of dice; `hl` paints matching faces (1s count as wild). */
function DiceRow({ dice, size = 52, hl, roll = 1, seed = 0 }: { dice: number[]; size?: number; hl?: number; roll?: number; seed?: number }) {
  return (
    <div className="flex" style={{ gap: size * 0.18 }}>
      {dice.map((d, i) => {
        const rolling = roll < 1;
        const face = rolling ? 1 + Math.floor(hash01(seed * 31 + i * 7 + Math.floor(roll * 14)) * 6) : d;
        const match = hl !== undefined && !rolling && (d === hl || (hl !== 1 && d === 1));
        return (
          <div key={i} style={{ transform: rolling ? `rotate(${(hash01(i + roll * 9) - 0.5) * 60}deg)` : undefined }}>
            <Die face={face} size={size} wild glow={match ? "#fde047" : undefined} />
          </div>
        );
      })}
    </div>
  );
}

function BidBadge({ q, face }: { q: number; face: number }) {
  return (
    <div className="flex items-center gap-3 rounded-[22px] border-4 border-amber-300 bg-black/65 px-6 py-3">
      <Die face={face} size={58} wild />
      <span className="text-[56px] leading-none font-black text-white">× {q}</span>
    </div>
  );
}

export const perudoScript: ExplainerScript = {
  gameId: "perudo",
  title: "페루도 룰 설명",
  kind: "animated",
  chapters: [
    {
      title: "인트로",
      scenes: [
        {
          cues: ["페루도는 컵 속에 주사위를 숨기고 허세를 부리는 주사위 블러핑 게임입니다.", "상대의 주사위를 모두 없애고 마지막까지 살아남으면 승리해요."],
          render: ({ t }) => (
            <Felt theme="desert">
              <At x={800} y={200} opacity={fade(t, 0)}>
                <Heading sub="Perudo · 2~8명 · 15~30분">🎲 페루도</Heading>
              </At>
              <At x={800} y={560}>
                <DiceRow dice={[1, 6, 3, 5, 2]} size={110} roll={prog(t, 0.3, 1.6, (x) => x)} seed={2} />
              </At>
            </Felt>
          ),
        },
      ],
    },
    {
      title: "준비: 컵과 주사위",
      scenes: [
        {
          cues: [" "],
          tail: 1.4,
          render: ({ t }) => (
            <Felt theme="desert">
              <ChapterCard t={t} n={1} icon="🥤" title="준비" sub="주사위 5개, 컵 1개" />
            </Felt>
          ),
        },
        {
          cues: [
            "모두 주사위 5개와 컵을 하나씩 가집니다.",
            "라운드가 시작되면 다 같이 컵을 흔들어 주사위를 굴리고, 자기 주사위만 살짝 확인해요.",
            "중요한 규칙 하나. 별이 그려진 1, 페루도 눈은 와일드예요. 어떤 숫자를 세든 항상 그 숫자로 함께 셉니다.",
          ],
          render: ({ t, at }) => {
            const shake = Math.sin(t * 30) * 10 * (t > at(1) && t < at(1) + 1.2 ? 1 : 0);
            const peek = prog(t, at(1) + 1.6, 0.5);
            return (
              <Felt theme="desert">
                <CornerTag>예시 · 3인 · 나는 여우</CornerTag>
                {SEATS.map(([x, y], i) => (
                  <At key={i} x={x} y={y - (i === 0 ? 0 : 0)}>
                    <div className={`flex items-center gap-8 ${i === 0 ? "flex-row" : "flex-col"}`}>
                      <Seat {...CAST[i]} active={i === 0} sub={<div className="text-[20px] text-white/70">🎲 × 5</div>} />
                      <div className="relative" style={{ transform: `rotate(${shake}deg)` }}>
                        {i === 0 && peek > 0 && (
                          <div className="absolute top-[70px] left-1/2 -translate-x-1/2" style={{ opacity: peek }}>
                            <DiceRow dice={DICE[0]} size={46} hl={t > at(2) ? 3 : undefined} />
                          </div>
                        )}
                        <div style={{ opacity: pop(t, 0.2 + i * 0.2) }}>
                          <Cup lift={i === 0 ? peek : 0} />
                        </div>
                      </div>
                    </div>
                  </At>
                ))}
                <At x={800} y={430} opacity={fade(t, at(2))} scale={pop(t, at(2))}>
                  <Panel accent="#fde047">
                    <div className="flex items-center gap-5 text-[36px] font-bold whitespace-nowrap">
                      <Die face={1} size={64} wild /> = 어떤 숫자든 OK (와일드)
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
      title: "선언 올리기",
      scenes: [
        {
          cues: [" "],
          tail: 1.4,
          render: ({ t }) => (
            <Felt theme="desert">
              <ChapterCard t={t} n={2} icon="📣" title="선언 올리기" sub="테이블 전체에 이 눈이 최소 몇 개?" />
            </Felt>
          ),
        },
        {
          cues: [
            "차례대로 '테이블 전체 주사위 중에 이 눈이 최소 몇 개 있다'고 선언합니다.",
            "여우는 내 주사위에 3이 두 개, 와일드 1이 하나라서 3이 4개라고 불렀어요.",
            "다음 사람은 더 세게 불러야 해요. 개수를 늘리거나, 같은 개수에서 더 높은 눈으로. 곰돌이는 3이 5개.",
            "토끼는 크게 질러서 3이 7개!",
            "1, 페루도 눈으로 선언할 때는 화면의 보드 트랙에서 지금보다 뒤 칸만 고를 수 있어요. 앱이 가능한 칸만 열어 주니 걱정 마세요.",
          ],
          render: ({ t, at, cue }) => {
            const bids = [
              { seat: 0, q: 4, at: at(1) + 1.6 },
              { seat: 1, q: 5, at: at(2) + 2.2 },
              { seat: 2, q: 7, at: at(3) + 0.3 },
            ];
            const active = cue <= 1 ? 0 : cue === 2 ? 1 : 2;
            const last = [...bids].reverse().find((b) => t >= b.at);
            return (
              <Felt theme="desert">
                {SEATS.map(([x, y], i) => (
                  <At key={i} x={x} y={y}>
                    <div className={`flex items-center gap-8 ${i === 0 ? "flex-row" : "flex-col"}`}>
                      <Seat {...CAST[i]} active={i === active} />
                      {i === 0 ? <DiceRow dice={DICE[0]} size={46} hl={t > at(1) ? 3 : undefined} /> : <div style={{ transform: "scale(.7)" }}><Cup /></div>}
                    </div>
                  </At>
                ))}
                {bids.map((b, i) => (
                  <At key={i} x={SEATS[b.seat][0] + (b.seat === 0 ? 0 : 0)} y={SEATS[b.seat][1] - (b.seat === 0 ? 150 : 250)} opacity={fade(t, b.at, (bids[i + 1]?.at ?? Infinity) + 0.4)} scale={pop(t, b.at)}>
                    <Bubble>3이 {b.q}개!</Bubble>
                  </At>
                ))}
                {last && cue < 4 && (
                  <At x={800} y={420} scale={1 + 0.03 * pulse(t)}>
                    <BidBadge q={last.q} face={3} />
                  </At>
                )}
                {cue === 4 && (
                  <At x={800} y={420} opacity={fade(t, at(4))}>
                    <div className="flex items-center gap-2">
                      {["5", "★3", "6", "7", "★4"].map((l, i) => (
                        <div
                          key={i}
                          className="flex h-[86px] w-[86px] items-center justify-center rounded-xl border-2 text-[30px] font-black"
                          style={{
                            background: l.startsWith("★") ? "rgba(217,119,6,.45)" : "rgba(0,0,0,.5)",
                            borderColor: i === 0 ? "#fde047" : "#fff3",
                            color: "#fff",
                            opacity: i === 0 ? 0.6 : prog(t, at(4) + 0.5 + i * 0.25, 0.3),
                          }}
                        >
                          {l}
                        </div>
                      ))}
                    </div>
                  </At>
                )}
                <At x={800} y={560} opacity={fade(t, at(2) + 0.4, at(3))}>
                  <Tag color="#b45309">개수 ↑  또는  같은 개수 + 더 높은 눈</Tag>
                </At>
              </Felt>
            );
          },
        },
      ],
    },
    {
      title: "페루도! (의심)",
      scenes: [
        {
          cues: [" "],
          tail: 1.4,
          render: ({ t }) => (
            <Felt theme="desert">
              <ChapterCard t={t} n={3} icon="🤨" title="페루도!" sub="그 선언, 못 믿겠어!" />
            </Felt>
          ),
        },
        {
          cues: [
            "직전 선언이 거짓말 같으면, 내 차례에 '페루도!'를 외쳐 의심합니다.",
            "모든 컵을 열고 세어 봐요. 3과 와일드 1을 합치면 모두 6개.",
            "선언은 7개였으니 1개가 모자라죠. 선언한 토끼가 진 거예요.",
            "이 앱은 차등 페널티예요. 모자란 개수만큼 주사위를 잃습니다. 이번엔 1개 차이니 토끼가 주사위 1개를 잃어요.",
          ],
          render: ({ t, at }) => {
            const open = prog(t, at(1) + 0.2, 0.6);
            return (
              <Felt theme="desert">
                <At x={SEATS[0][0]} y={SEATS[0][1] - 160} opacity={fade(t, 0.2, at(1))} scale={pop(t, 0.2)}>
                  <Bubble color="#dc2626" text="#fff" size={44}>
                    페루도!
                  </Bubble>
                </At>
                {SEATS.map(([x, y], i) => (
                  <At key={i} x={x} y={y}>
                    <div className={`flex items-center gap-8 ${i === 0 ? "flex-row" : "flex-col"}`}>
                      <Seat {...CAST[i]} active={i === 2 && t > at(2)} sub={i === 2 && t > at(3) + 1.6 ? <div className="text-[24px] font-black text-rose-300">🎲 5 → 4</div> : undefined} />
                      <div className="relative">
                        <DiceRow dice={i === 2 && t > at(3) + 1.6 ? DICE[i].slice(0, 4) : DICE[i]} size={46} hl={t > at(1) + 0.9 ? 3 : undefined} />
                        {i !== 0 && open < 1 && (
                          <div className="absolute inset-0 flex justify-center" style={{ transform: `translateY(${-open * 120}px)`, opacity: 1 - open }}>
                            <Cup />
                          </div>
                        )}
                      </div>
                    </div>
                  </At>
                ))}
                <At x={800} y={440} opacity={fade(t, at(1) + 1.2)}>
                  <Panel accent="#fde047">
                    <div className="flex items-center gap-4 text-[44px] font-black whitespace-nowrap">
                      실제 <span className="text-amber-300">{countOf(3)}개</span> vs 선언 7개
                    </div>
                  </Panel>
                </At>
                <At x={800} y={570} opacity={fade(t, at(2) + 0.3)} scale={pop(t, at(2) + 0.3)}>
                  <Stamp ok={false} label="선언 실패" />
                </At>
              </Felt>
            );
          },
        },
        {
          cues: [
            "반대로 선언이 맞았다면, 의심한 사람이 '실제 개수 빼기 선언 개수 더하기 1'만큼 잃어요.",
            "그리고 이 앱만의 하우스룰! 선언이 딱 맞아떨어지면, 의심한 사람뿐 아니라 선언자를 뺀 나머지 모두가 주사위를 1개씩 잃습니다.",
          ],
          tail: 1,
          render: ({ t, at }) => (
            <Felt theme="desert">
              <At x={800} y={150} opacity={fade(t, 0)}>
                <Heading>⚖️ 페루도! 판정</Heading>
              </At>
              <At x={470} y={430} scale={pop(t, 0.3)}>
                <Panel w={620} accent="#ef4444">
                  <div className="text-center text-[30px] leading-snug font-bold break-keep">
                    실제 &lt; 선언
                    <br />
                    <span className="text-rose-300">선언자</span>가 <b>(선언 − 실제)</b>개 잃음
                  </div>
                </Panel>
              </At>
              <At x={1130} y={430} scale={pop(t, 0.8)}>
                <Panel w={620} accent="#22c55e">
                  <div className="text-center text-[30px] leading-snug font-bold break-keep">
                    실제 ≥ 선언
                    <br />
                    <span className="text-rose-300">의심한 사람</span>이 <b>(실제 − 선언 + 1)</b>개 잃음
                  </div>
                </Panel>
              </At>
              <At x={800} y={710} opacity={fade(t, at(1))} scale={pop(t, at(1))}>
                <div className="rounded-[24px] border-4 border-amber-300 bg-amber-500/25 px-8 py-4 text-center text-[32px] font-black break-keep text-white">
                  🎯 딱 맞으면? 의심한 사람 + 선언자 뺀 전원 각 1개씩
                </div>
              </At>
            </Felt>
          ),
        },
      ],
    },
    {
      title: "맞아! (정확히 맞히기)",
      scenes: [
        {
          cues: [
            "또 하나의 승부수, '맞아!'. 선언한 개수가 정확히 딱 맞다고 생각하면 외칩니다.",
            "'맞아!'는 내 차례가 아니어도, 살아 있는 사람이면 언제든 외칠 수 있어요.",
            "정확히 맞으면 주사위를 1개 되찾고, 틀리면 차이 나는 개수만큼 잃습니다.",
          ],
          render: ({ t, at }) => (
            <Felt theme="desert">
              <At x={800} y={200} scale={pop(t, 0.2)}>
                <Bubble color="#16a34a" text="#fff" size={56}>
                  맞아!
                </Bubble>
              </At>
              <At x={800} y={360} opacity={fade(t, 0.5)}>
                <BidBadge q={6} face={3} />
              </At>
              <At x={800} y={490} opacity={fade(t, at(1))}>
                <Tag color="#0ea5e9">⏱ 차례와 상관없이 언제든</Tag>
              </At>
              <At x={500} y={680} scale={pop(t, at(2) + 0.3)}>
                <Panel w={520} accent="#22c55e">
                  <div className="text-center text-[34px] font-bold">정확히 일치 → 🎲 +1</div>
                </Panel>
              </At>
              <At x={1100} y={680} scale={pop(t, at(2) + 1.2)}>
                <Panel w={520} accent="#ef4444">
                  <div className="text-center text-[34px] font-bold">틀림 → 차이만큼 🎲 −</div>
                </Panel>
              </At>
            </Felt>
          ),
        },
      ],
    },
    {
      title: "승리와 팁",
      scenes: [
        {
          cues: [
            "주사위가 0개가 되면 탈락. 판정이 끝나면 모두 다시 굴려 새 라운드를 시작하고, 마지막 한 명이 남을 때까지 계속합니다.",
            "팁. 주사위 하나에 특정 눈이 나올 확률은 와일드 1까지 치면 3분의 1이에요. 남의 주사위 개수에 3분의 1을 곱하고 내 것을 더하면 적당한 선언이 나옵니다.",
            "그럼 방을 만들어 직접 굴려 보세요!",
          ],
          tail: 1.2,
          render: ({ t, at }) => (
            <Felt theme="desert">
              <At x={800} y={160} opacity={fade(t, 0)}>
                <Heading>🏆 최후의 1인</Heading>
              </At>
              {SEATS.map((_, i) => (
                <At key={i} x={lerp(400, 400 + i * 400, 1)} y={400} scale={i === 0 ? 1 + 0.04 * pulse(t) : 0.9}>
                  <Seat {...CAST[i]} dim={i !== 0 && t > 1 + i * 0.4} active={i === 0} sub={<div className="text-[22px] text-white/70">🎲 × {i === 0 ? 2 : 0}</div>} />
                </At>
              ))}
              <At x={800} y={660} opacity={fade(t, at(1))} scale={pop(t, at(1))}>
                <Panel accent="#fde047">
                  <div className="text-[38px] font-black whitespace-nowrap">
                    예상 개수 ≈ <span className="text-amber-300">내 것</span> + 남의 주사위 × ⅓
                  </div>
                </Panel>
              </At>
            </Felt>
          ),
        },
      ],
    },
  ],
};
