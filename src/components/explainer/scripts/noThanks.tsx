"use client";

import type { ExplainerScript } from "../types";
import { At, Bubble, Chip, Felt, Heading, Panel, Seat, Stamp, Tag } from "../stage";
import { fade, lerp, mix, pop, prog, pulse } from "../anim";
import { CAST, ChapterCard, CornerTag } from "./kit";

/** A No Thanks number card (the app draws these inline too — amber/brown tones). */
function NumCard({ n, w = 150, dim = false, strike = false, back = false }: { n?: number; w?: number; dim?: boolean; strike?: boolean; back?: boolean }) {
  const h = w * 1.45;
  if (back)
    return (
      <div className="rounded-[18px] border-4 border-white/25 bg-gradient-to-br from-slate-600 to-slate-800 shadow-[0_10px_24px_rgba(0,0,0,.5)]" style={{ width: w, height: h }}>
        <div className="flex h-full items-center justify-center">
          <div className="rotate-45 rounded-md border-4 border-white/20" style={{ width: w * 0.3, height: w * 0.3 }} />
        </div>
      </div>
    );
  return (
    <div
      className="relative flex flex-col items-center justify-center rounded-[18px] border-4 font-black shadow-[0_10px_24px_rgba(0,0,0,.5)]"
      style={{
        width: w,
        height: h,
        background: "linear-gradient(160deg,#fde68a,#f59e0b 60%,#b45309)",
        borderColor: "#fff7",
        color: "#451a03",
        opacity: dim ? 0.45 : 1,
      }}
    >
      <span className="absolute top-2 left-3" style={{ fontSize: w * 0.17 }}>
        {n}
      </span>
      <span style={{ fontSize: w * 0.5 }} className={strike ? "line-through decoration-[6px]" : ""}>
        {n}
      </span>
      <span className="absolute right-3 bottom-2 rotate-180" style={{ fontSize: w * 0.17 }}>
        {n}
      </span>
    </div>
  );
}

const SEATS: [number, number][] = [
  [300, 640],
  [800, 190],
  [1300, 640],
];

export const noThanksScript: ExplainerScript = {
  gameId: "no-thanks",
  title: "노땡스 룰 설명",
  kind: "animated",
  chapters: [
    {
      title: "인트로",
      scenes: [
        {
          cues: ["노땡스는 아무도 원하지 않는 카드를 서로 떠넘기는 게임입니다.", "카드는 전부 벌점이에요. 칩을 내고 거절하느냐, 칩까지 챙겨 떠안느냐. 그 눈치싸움이 핵심이죠."],
          render: ({ t, at }) => (
            <Felt theme="wine">
              <At x={800} y={230} opacity={fade(t, 0)}>
                <Heading sub="No Thanks! · 3~7명 · 15~25분">🙅 노땡스</Heading>
              </At>
              {[3, 17, 26, 35].map((n, i) => (
                <At key={n} x={lerp(800, 380 + i * 280, prog(t, 0.4 + i * 0.12))} y={560} rot={lerp(0, -12 + i * 8, prog(t, 0.4 + i * 0.12))} scale={pop(t, 0.3 + i * 0.1)}>
                  <NumCard n={n} />
                </At>
              ))}
              {Array.from({ length: 6 }, (_, i) => (
                <At key={i} x={620 + i * 70} y={lerp(-80, 790, prog(t, at(1) + i * 0.12, 0.5))} z={5}>
                  <Chip />
                </At>
              ))}
            </Felt>
          ),
        },
      ],
    },
    {
      title: "구성물과 준비",
      scenes: [
        {
          cues: [" "],
          tail: 1.4,
          render: ({ t }) => (
            <Felt theme="wine">
              <ChapterCard t={t} n={1} icon="📦" title="구성물과 준비" />
            </Felt>
          ),
        },
        {
          cues: [
            "카드는 3부터 35까지, 모두 33장입니다.",
            "섞은 뒤 9장을 아무도 모르게 빼 둡니다. 그래서 어떤 숫자가 없는지 아무도 몰라요.",
            "남은 24장이 이번 게임의 덱이 됩니다.",
            "칩은 3명에서 5명이면 11개씩, 6명은 9개, 7명은 7개씩 나눠 가집니다.",
          ],
          render: ({ t, at }) => (
            <Felt theme="wine">
              {Array.from({ length: 33 }, (_, i) => {
                const n = i + 3;
                const removed = [5, 11, 14, 19, 24, 27, 30, 33, 35].includes(n);
                const col = i % 11;
                const row = Math.floor(i / 11);
                const home: [number, number] = [200 + col * 120, 170 + row * 170];
                const out = prog(t, at(1) + 0.5 + (i % 9) * 0.05, 0.7);
                const gather = prog(t, at(2), 0.9);
                const [x, y] = removed ? mix(home, [1450, 760], out) : mix(home, [520 + (i % 6) * 4, 600 - (i % 6) * 4], gather);
                return (
                  <At key={n} x={x} y={y} scale={pop(t, i * 0.03) * (removed ? lerp(0.62, 0.5, out) : lerp(0.62, 0.8, gather))} rot={removed ? out * 12 : 0} opacity={removed ? 1 - prog(t, at(2) + 0.5) * 0.4 : 1} z={removed ? 3 : 1}>
                    <NumCard n={n} back={removed ? out > 0.5 : gather > 0.6} w={120} />
                  </At>
                );
              })}
              <At x={1450} y={630} opacity={fade(t, at(1) + 1)}>
                <Tag color="#475569">🙈 비밀로 제외 9장</Tag>
              </At>
              <At x={520} y={430} opacity={fade(t, at(2) + 0.8, at(3))}>
                <Tag color="#b45309">덱 24장</Tag>
              </At>
              {[11, 9, 7].map((c, i) => (
                <At key={c} x={900 + i * 220} y={500} opacity={fade(t, at(3) + i * 0.3)}>
                  <div className="flex flex-col items-center gap-3">
                    <Chip size={80} label={c} />
                    <div className="text-[26px] font-bold text-white">{["3~5명", "6명", "7명"][i]}</div>
                  </div>
                </At>
              ))}
            </Felt>
          ),
        },
      ],
    },
    {
      title: "내 차례: 거절 또는 인수",
      scenes: [
        {
          cues: [" "],
          tail: 1.4,
          render: ({ t }) => (
            <Felt theme="wine">
              <ChapterCard t={t} n={2} icon="🤔" title="내 차례에 할 일" sub="둘 중 하나만 고르면 끝!" />
            </Felt>
          ),
        },
        {
          cues: [
            "덱 맨 위 카드 한 장이 가운데에 공개됩니다. 이번엔 27이네요.",
            "내 차례엔 딱 두 가지 중 하나. 첫째, 노땡스! 칩 하나를 카드 위에 올리고 다음 사람에게 넘깁니다.",
            "곰돌이도 27은 싫대요. 칩을 하나 더 올립니다.",
            "둘째, 인수. 토끼는 카드를 가져가기로 했어요. 카드와 함께 위에 쌓인 칩 2개도 전부 가져갑니다!",
            "카드를 가져간 사람이 곧바로 다음 카드를 뒤집고, 다시 자기 차례를 시작합니다.",
          ],
          render: ({ t, at, cue }) => {
            const chip1 = prog(t, at(1) + 1.2, 0.7);
            const chip2 = prog(t, at(2) + 0.8, 0.7);
            const take = prog(t, at(3) + 1.6, 0.9);
            const flip = prog(t, at(4) + 0.4, 0.6);
            const centre: [number, number] = [800, 440];
            const active = cue <= 1 ? 0 : cue === 2 ? 1 : 2;
            return (
              <Felt theme="wine">
                <CornerTag>예시 · 3인</CornerTag>
                {SEATS.map(([x, y], i) => (
                  <At key={i} x={x} y={y}>
                    <Seat {...CAST[i]} active={i === active} sub={<div className="text-[20px] text-white/70">칩 {i === 0 ? 11 - (chip1 > 0.5 ? 1 : 0) : i === 1 ? 11 - (chip2 > 0.5 ? 1 : 0) : 11 + (take > 0.6 ? 2 : 0)}개</div>} />
                  </At>
                ))}
                <At x={1010} y={440} opacity={fade(t, 0)}>
                  <NumCard back w={120} />
                </At>
                {(() => {
                  const [x, y] = mix(centre, [1180, 800], take);
                  return (
                    <At x={x} y={y} scale={lerp(1, 0.55, take)} z={2}>
                      <NumCard n={27} />
                    </At>
                  );
                })()}
                {[chip1, chip2].map((p, i) => {
                  const from = SEATS[i];
                  const on: [number, number] = [800 + i * 16, 420 - i * 14];
                  const pos = take > 0 ? mix(on, [1420 + i * 30, 800], take) : mix(from, on, p);
                  return p > 0 ? (
                    <At key={i} x={pos[0]} y={pos[1]} z={3} scale={0.9}>
                      <Chip />
                    </At>
                  ) : null;
                })}
                {/* next card flips after the take */}
                <At x={800} y={440} scale={flip > 0 ? Math.abs(Math.cos(flip * Math.PI)) * 0.98 + 0.02 : 0} z={4}>
                  <NumCard n={flip > 0.5 ? 9 : undefined} back={flip <= 0.5} />
                </At>
                <At x={300} y={500} opacity={fade(t, at(1) + 0.3, at(2))}>
                  <Bubble>노땡스!</Bubble>
                </At>
                <At x={800} y={60} opacity={fade(t, at(2) + 0.2, at(3))}>
                  <Bubble>나도 노땡스!</Bubble>
                </At>
                <At x={1300} y={500} opacity={fade(t, at(3) + 0.3, at(4))}>
                  <Bubble color="#fde047">인수할게!</Bubble>
                </At>
                <At x={800} y={720} opacity={fade(t, at(1), at(3))}>
                  <Tag color="#dc2626">거절 = 칩 1개 내고 넘기기</Tag>
                </At>
                <At x={800} y={720} opacity={fade(t, at(3), at(4))}>
                  <Tag color="#16a34a">인수 = 카드 + 쌓인 칩 전부</Tag>
                </At>
                <At x={800} y={720} opacity={fade(t, at(4) + 0.4)}>
                  <Tag color="#0ea5e9">토끼가 바로 다음 카드(9)로 차례 시작</Tag>
                </At>
              </Felt>
            );
          },
        },
        {
          cues: ["주의! 칩이 하나도 없으면 거절할 수 없어요.", "무조건 카드를 가져가야 합니다. 그래서 칩을 다 써 버리면 아주 위험하죠."],
          render: ({ t, at }) => (
            <Felt theme="wine">
              <At x={520} y={430} scale={pop(t, 0.1)}>
                <Seat {...CAST[3]} active sub={<div className="text-[26px] font-bold text-rose-300">칩 0개</div>} />
              </At>
              <At x={950} y={430} scale={pop(t, 0.3)}>
                <NumCard n={34} />
              </At>
              <At x={950} y={430} opacity={fade(t, 0.9)} scale={pop(t, 0.9)} z={3}>
                <Stamp ok={false} label="거절 불가" />
              </At>
              <At x={800} y={740} opacity={fade(t, at(1))}>
                <Tag color="#dc2626" size={32}>
                  칩 0개 → 반드시 인수
                </Tag>
              </At>
            </Felt>
          ),
        },
      ],
    },
    {
      title: "연속 숫자 보너스",
      scenes: [
        {
          cues: [" "],
          tail: 1.4,
          render: ({ t }) => (
            <Felt theme="wine">
              <ChapterCard t={t} n={3} icon="🔗" title="연속 숫자는 이득!" />
            </Felt>
          ),
        },
        {
          cues: [
            "가져온 카드 중에 숫자가 연속으로 이어지면 특별 규칙이 있어요.",
            "21, 22, 23처럼 이어진 묶음은 가장 작은 숫자 하나만 벌점으로 칩니다.",
            "66점이 될 뻔한 벌점이 21점으로 줄어드는 거죠. 그래서 큰 숫자 카드도 이어 붙일 수 있다면 일부러 가져갈 만합니다.",
          ],
          render: ({ t, at }) => {
            const join = prog(t, at(1) + 0.6, 0.8);
            const strike = prog(t, at(1) + 1.8, 0.3);
            return (
              <Felt theme="wine">
                {[21, 22, 23].map((n, i) => (
                  <At key={n} x={lerp(450 + i * 350, 620 + i * 180, join)} y={400} scale={pop(t, 0.2 + i * 0.15)}>
                    <NumCard n={n} w={170} dim={i > 0 && strike > 0.5} strike={i > 0 && strike > 0.5} />
                  </At>
                ))}
                <At x={800} y={640} opacity={fade(t, at(1) + 2.1, at(2) + 0.2)}>
                  <Panel accent="#86efac">
                    <div className="text-[44px] font-black">
                      벌점 = <span className="text-emerald-300">21</span>
                      <span className="text-white/40"> (+0 +0)</span>
                    </div>
                  </Panel>
                </At>
                <At x={800} y={640} opacity={fade(t, at(2) + 0.2)} scale={pop(t, at(2) + 0.2)}>
                  <div className="flex items-center gap-6 text-[46px] font-black text-white">
                    <span className="text-rose-300 line-through">66점</span>
                    <span>→</span>
                    <span className="text-emerald-300">21점</span>
                  </div>
                </At>
              </Felt>
            );
          },
        },
      ],
    },
    {
      title: "게임 끝 · 점수 계산",
      scenes: [
        {
          cues: [" "],
          tail: 1.4,
          render: ({ t }) => (
            <Felt theme="wine">
              <ChapterCard t={t} n={4} icon="🏁" title="게임 끝과 점수" />
            </Felt>
          ),
        },
        {
          cues: [
            "덱 24장이 모두 떨어지면 게임이 바로 끝납니다.",
            "점수는 가져온 카드 숫자의 합에서, 남은 칩 개수를 뺀 값이에요. 칩 1개가 1점을 지워 줍니다.",
            "예를 들어 21부터 23 묶음은 21점, 30이 하나 있으면 51점. 칩이 8개 남았으면 51 빼기 8, 43점입니다.",
            "벌점이 가장 낮은 사람이 승리! 동점이면 칩이 더 많은 쪽이 유리하겠죠?",
          ],
          render: ({ t, at, cue }) => (
            <Felt theme="wine">
              <At x={800} y={140} opacity={fade(t, at(1))}>
                <Panel accent="#fde047">
                  <div className="text-[46px] font-black whitespace-nowrap">
                    점수 = <span className="text-amber-300">카드 합</span> − <span className="text-rose-300">남은 칩</span>
                  </div>
                </Panel>
              </At>
              <At x={800} y={430} opacity={fade(t, 0, at(1))}>
                <div className="flex items-center gap-6">
                  <NumCard back />
                  <div className="text-[60px] font-black text-white">→</div>
                  <div className="flex h-[217px] w-[150px] items-center justify-center rounded-[18px] border-4 border-dashed border-white/30 text-[28px] text-white/50">빈 덱</div>
                </div>
              </At>
              {cue >= 2 && (
                <>
                  {[21, 22, 23, 30].map((n, i) => (
                    <At key={n} x={360 + i * 120 + (i === 3 ? 60 : 0)} y={460} scale={pop(t, at(2) + i * 0.12) * 0.75}>
                      <NumCard n={n} dim={i === 1 || i === 2} strike={i === 1 || i === 2} />
                    </At>
                  ))}
                  <At x={1000} y={460} scale={pop(t, at(2) + 0.6)}>
                    <div className="flex items-center gap-2">
                      <Chip size={70} label={8} />
                    </div>
                  </At>
                  <At x={1290} y={460} opacity={fade(t, at(2) + 1.4)}>
                    <div className="text-[56px] font-black whitespace-nowrap text-white">
                      51 − 8 = <span className="text-amber-300">43</span>
                    </div>
                  </At>
                </>
              )}
              <At x={800} y={730} scale={pop(t, at(3)) * (1 + 0.03 * pulse(t))}>
                <Tag color="#16a34a" size={38}>
                  🏆 벌점이 가장 낮은 사람 승리
                </Tag>
              </At>
            </Felt>
          ),
        },
      ],
    },
    {
      title: "초보자 팁",
      scenes: [
        {
          cues: [
            "마지막으로 초보자 팁 세 가지!",
            "하나, 칩이 많이 쌓인 카드는 벌점보다 칩 이득이 클 수 있어요.",
            "둘, 내 카드와 이어지는 숫자는 남들이 돌리는 동안 칩을 더 받고 가져오세요.",
            "셋, 칩이 떨어져 가면 다들 그걸 노리고 카드를 떠넘깁니다. 칩 관리가 생명이에요. 그럼 방을 만들어 직접 해 보세요!",
          ],
          tail: 1.2,
          render: ({ t, at, cue }) => (
            <Felt theme="wine">
              <At x={800} y={130} opacity={fade(t, 0)}>
                <Heading>💡 초보자 팁</Heading>
              </At>
              {["칩이 많이 쌓인 카드는 이득일 수도", "이어지는 숫자는 칩 더 받고 가져오기", "칩 0개는 가장 위험한 상태"].map((s, i) => (
                <At key={i} x={800} y={320 + i * 170} scale={pop(t, at(i + 1))}>
                  <div
                    className="flex w-[1100px] items-center gap-6 rounded-[24px] border-2 px-8 py-5 text-[40px] font-bold text-white"
                    style={{ background: cue === i + 1 ? "rgba(251,191,36,.25)" : "rgba(0,0,0,.45)", borderColor: cue === i + 1 ? "#fcd34d" : "#fff2" }}
                  >
                    <span className="text-[48px]">{["💰", "🔗", "⚠️"][i]}</span>
                    {s}
                  </div>
                </At>
              ))}
            </Felt>
          ),
        },
      ],
    },
  ],
};
