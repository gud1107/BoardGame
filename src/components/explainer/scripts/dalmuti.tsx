"use client";

import { CardFace } from "@/games/dalmuti/CardArt";
import type { Card } from "@/games/dalmuti/engine";
import type { ExplainerScript } from "../types";
import { Arrow, At, Big, Bubble, Felt, Heading, Seat, Stamp, Tag } from "../stage";
import { fade, lerp, mix, pop, prog, pulse } from "../anim";
import { CAST, ChapterCard, CornerTag } from "./kit";

let uid = 0;
const card = (rank: number): Card => ({ id: `x${uid++}`, rank, isJoker: rank === 13 });
const joker = (): Card => card(13);

function Face({ c, s = 1.6, hl }: { c: Card; s?: number; hl?: boolean }) {
  return (
    <Big s={s}>
      <CardFace card={c} highlight={hl} />
    </Big>
  );
}

/** A same-number set fanned slightly. */
function CardSet({ cards, s = 1.4 }: { cards: Card[]; s?: number }) {
  return (
    <div className="flex" style={{ gap: 6 * s }}>
      {cards.map((c) => (
        <Face key={c.id} c={c} s={s} />
      ))}
    </div>
  );
}

const ROLES = [
  { title: "왕", emoji: "👑" },
  { title: "귀족", emoji: "🎩" },
  { title: "평민", emoji: "🌾" },
  { title: "거지", emoji: "🪵" },
  { title: "노예", emoji: "⛓️" },
];

const LADDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(card);
const TRICK = {
  nine: [card(9), card(9), card(9)],
  seven: [card(7), card(7), card(7)],
  five: [card(5), card(5), joker()],
};

const TRICK_SEATS: [number, number][] = [
  [800, 760],
  [230, 430],
  [800, 130],
  [1370, 430],
];

export const dalmutiScript: ExplainerScript = {
  gameId: "dalmuti",
  title: "달무티 룰 설명",
  kind: "animated",
  chapters: [
    {
      title: "인트로",
      scenes: [
        {
          cues: ["달무티는 신분이 정해진 채 시작하는 계급 카드 게임입니다.", "손에 든 카드를 가장 먼저 모두 내려놓는 사람이 이겨요. 이 앱은 한 판으로 승부가 나는 단판 규칙입니다."],
          render: ({ t }) => (
            <Felt theme="navy">
              <At x={800} y={200} opacity={fade(t, 0)}>
                <Heading sub="The Great Dalmuti · 3~8명 · 단판 승부">👑 달무티</Heading>
              </At>
              {[1, 2, 5, 9, 12, 13].map((r, i) => (
                <At key={r} x={lerp(800, 300 + i * 200, prog(t, 0.4 + i * 0.08))} y={560} rot={lerp(0, -15 + i * 6, prog(t, 0.4 + i * 0.08))} scale={pop(t, 0.3 + i * 0.08)}>
                  <Face c={r === 13 ? joker() : card(r)} s={2} />
                </At>
              ))}
            </Felt>
          ),
        },
      ],
    },
    {
      title: "카드 구성",
      scenes: [
        {
          cues: [" "],
          tail: 1.4,
          render: ({ t }) => (
            <Felt theme="navy">
              <ChapterCard t={t} n={1} icon="🃏" title="카드 구성" sub="작은 숫자일수록 높은 계급" />
            </Felt>
          ),
        },
        {
          cues: [
            "카드는 1부터 12까지 있고, 숫자가 작을수록 높은 계급이에요. 1번이 위대한 달무티, 12번이 농노입니다.",
            "숫자가 곧 장수예요. 1번은 단 1장, 2번은 2장, 그리고 12번은 12장이나 있죠.",
            "여기에 조커, 어릿광대 2장을 더해 모두 80장입니다. 조커는 다른 숫자와 함께 내면 그 숫자처럼 쓸 수 있어요.",
          ],
          render: ({ t, at, cue }) => (
            <Felt theme="navy">
              {LADDER.map((c, i) => (
                <At key={c.id} x={140 + i * 120} y={cue >= 1 ? 300 : 430} scale={pop(t, 0.2 + i * 0.07)}>
                  <div className="flex flex-col items-center gap-5">
                    <Face c={c} s={1.15} />
                    {cue >= 1 && (
                      <div className="text-[24px] font-black text-white" style={{ opacity: prog(t, at(1) + i * 0.1, 0.3) }}>
                        ×{c.rank}
                      </div>
                    )}
                  </div>
                </At>
              ))}
              <At x={800} y={cue >= 1 ? 120 : 640} opacity={fade(t, 1)}>
                <div className="flex items-center gap-8 text-[32px] font-black text-white">
                  <span className="text-amber-200">높은 계급 ⬅</span>
                  <span className="text-white/60">➡ 낮은 계급</span>
                </div>
              </At>
              {cue >= 1 && (
                <At x={800} y={560} opacity={fade(t, at(1) + 1.2)}>
                  <div className="flex items-end gap-3">
                    {Array.from({ length: 12 }, (_, i) => (
                      <div key={i} className="w-[70px] rounded-t-lg bg-sky-400/70" style={{ height: (i + 1) * 14 * prog(t, at(1) + 1.2 + i * 0.05, 0.4) }} />
                    ))}
                  </div>
                </At>
              )}
              <At x={800} y={760} opacity={fade(t, at(2))} scale={pop(t, at(2))}>
                <div className="flex items-center gap-8">
                  <Face c={joker()} s={1.3} />
                  <Face c={joker()} s={1.3} />
                  <Tag color="#be123c" size={34}>
                    조커 2장 · 합계 80장
                  </Tag>
                </div>
              </At>
            </Felt>
          ),
        },
      ],
    },
    {
      title: "신분과 세금",
      scenes: [
        {
          cues: [" "],
          tail: 1.4,
          render: ({ t }) => (
            <Felt theme="navy">
              <ChapterCard t={t} n={2} icon="🏰" title="신분과 세금" />
            </Felt>
          ),
        },
        {
          cues: [
            "게임을 시작하면 무작위로 신분 순서가 정해집니다. 5명이면 왕, 귀족, 평민, 거지, 노예예요.",
            "카드를 모두 나눠 준 뒤 세금을 냅니다. 노예는 가장 좋은 카드 2장을 자동으로 왕에게 바쳐요.",
            "왕은 그 대가로 필요 없는 카드 2장을 골라 노예에게 돌려줍니다.",
            "귀족과 거지도 똑같이 1장씩 주고받아요. 6명 이상이라 평민이 둘 이상이면, 평민끼리는 원하면 1장씩 자유롭게 교환할 수도 있어요.",
          ],
          render: ({ t, at }) => {
            const xs = [200, 500, 800, 1100, 1400];
            const up = prog(t, at(1) + 0.6, 1);
            const down = prog(t, at(2) + 0.6, 1);
            const side = prog(t, at(3) + 0.5, 1);
            return (
              <Felt theme="navy">
                <CornerTag>예시 · 5인</CornerTag>
                {ROLES.map((r, i) => (
                  <At key={i} x={xs[i]} y={250} scale={pop(t, 0.2 + i * 0.15)}>
                    <Seat name={`${r.emoji} ${r.title}`} emoji={CAST[i].emoji} color={CAST[i].color} active={(i === 0 || i === 4) && t > at(1) && t < at(3)} />
                  </At>
                ))}
                {/* slave -> king: two best cards */}
                {[card(2), card(4)].map((c, i) => {
                  const p = t < at(2) ? up : 1;
                  const [x, y] = mix([1400 + i * 60, 520], [200 + i * 60, 520], p);
                  return t > at(1) + 0.3 ? (
                    <At key={c.id} x={x} y={y} rot={lerp(0, -360, p)} z={3} opacity={1 - prog(t, at(2), 0.3)}>
                      <Face c={c} s={1.3} hl />
                    </At>
                  ) : null;
                })}
                {[card(11), card(12)].map((c, i) => {
                  const [x, y] = mix([200 + i * 60, 620], [1400 + i * 60, 620], down);
                  return t > at(2) + 0.3 ? (
                    <At key={c.id} x={x} y={y} rot={lerp(0, 360, down)} z={3} opacity={1 - prog(t, at(3), 0.3)}>
                      <Face c={c} s={1.3} />
                    </At>
                  ) : null;
                })}
                <Arrow x1={1350} y1={430} x2={260} y2={430} p={t > at(1) && t < at(3) ? prog(t, at(1), 0.6) : 0} color="#fde047" />
                <At x={800} y={470} opacity={fade(t, at(1) + 0.4, at(3))}>
                  <Tag color="#ca8a04">노예 → 왕 : 가장 좋은 카드 2장 (자동)</Tag>
                </At>
                <At x={800} y={760} opacity={fade(t, at(2) + 0.4, at(3))}>
                  <Tag color="#475569">왕 → 노예 : 고른 카드 2장</Tag>
                </At>
                {t > at(3) && (
                  <>
                    <Arrow x1={1060} y1={430} x2={540} y2={430} p={side} color="#e9d5ff" />
                    <At x={800} y={480} opacity={side}>
                      <Tag color="#7c3aed">거지 ↔ 귀족 : 1장씩</Tag>
                    </At>
                    <At x={800} y={680} opacity={side}>
                      <Tag color="#059669">6인 이상 · 평민끼리 : 원하면 1장 자유 교환</Tag>
                    </At>
                  </>
                )}
              </Felt>
            );
          },
        },
        {
          cues: [
            "잠깐, 혁명도 있어요! 카드를 받았을 때 조커 2장을 모두 가진 사람은 혁명을 선언할 수 있습니다.",
            "혁명을 선언하면 이번 판의 세금이 통째로 취소돼요.",
            "만약 노예가 혁명을 선언하면 대혁명! 신분 순서 자체가 완전히 뒤집힙니다.",
          ],
          render: ({ t, at }) => {
            const flip = prog(t, at(2) + 0.6, 1);
            return (
              <Felt theme="wine">
                <At x={800} y={170} scale={pop(t, 0.2)}>
                  <div className="flex gap-6">
                    <Face c={joker()} s={1.8} hl />
                    <Face c={joker()} s={1.8} hl />
                  </div>
                </At>
                <At x={800} y={380} opacity={fade(t, 0.6)}>
                  <Bubble color="#e11d48" text="#fff" size={42}>
                    혁명이다!
                  </Bubble>
                </At>
                <At x={800} y={520} opacity={fade(t, at(1) + 0.3, at(2))} scale={pop(t, at(1) + 0.3)}>
                  <Stamp ok={false} label="세금 취소" />
                </At>
                {ROLES.map((r, i) => {
                  const x = lerp(240 + i * 280, 240 + (4 - i) * 280, flip);
                  return (
                    <At key={i} x={x} y={700} opacity={fade(t, at(2))} scale={0.85}>
                      <Seat name={`${ROLES[flip > 0.5 ? 4 - i : i].emoji} ${ROLES[flip > 0.5 ? 4 - i : i].title}`} emoji={CAST[i].emoji} color={CAST[i].color} active={i === 4} />
                    </At>
                  );
                })}
              </Felt>
            );
          },
        },
      ],
    },
    {
      title: "카드 내기(트릭)",
      scenes: [
        {
          cues: [" "],
          tail: 1.4,
          render: ({ t }) => (
            <Felt theme="navy">
              <ChapterCard t={t} n={3} icon="🎴" title="카드 내기" sub="같은 장수, 더 작은 숫자" />
            </Felt>
          ),
        },
        {
          cues: [
            "첫 차례는 왕부터. 선 플레이어는 같은 숫자 카드를 원하는 만큼 냅니다. 여우가 9를 3장 냈어요.",
            "다음 사람은 똑같이 3장, 그리고 더 작은 숫자만 낼 수 있어요. 곰돌이가 7을 3장!",
            "낼 수 없거나 내기 싫으면 패스. 패스해도 다음 차례가 오면 다시 낼 수 있어요.",
            "호랑이는 5가 2장뿐이지만 조커를 붙여 5를 3장으로 만들었습니다.",
            "나머지가 모두 연속으로 패스하면, 마지막으로 낸 호랑이가 판을 치우고 새로 원하는 카드를 냅니다.",
          ],
          render: ({ t, at, cue }) => {
            const plays = [
              { seat: 0, cards: TRICK.nine, at: at(0) + 2.4 },
              { seat: 1, cards: TRICK.seven, at: at(1) + 1.2 },
              { seat: 3, cards: TRICK.five, at: at(3) + 1.0 },
            ];
            const active = cue === 0 ? 0 : cue === 1 ? 1 : cue === 2 ? 2 : 3;
            const clear = prog(t, at(4) + 1.6, 0.6);
            return (
              <Felt theme="navy">
                <CornerTag>예시 · 4인</CornerTag>
                {TRICK_SEATS.map(([x, y], i) => (
                  <At key={i} x={x} y={y}>
                    <Seat {...CAST[i]} active={i === active} sub={<div className="text-[20px] text-white/60">{ROLES[[0, 1, 3, 4][i]].emoji} {ROLES[[0, 1, 3, 4][i]].title}</div>} />
                  </At>
                ))}
                {plays.map((p, i) => {
                  const pr = prog(t, p.at, 0.7);
                  if (pr <= 0) return null;
                  const [x, y] = mix(TRICK_SEATS[p.seat], [800 + i * 30, 440 + i * 20], pr);
                  const covered = plays[i + 1] && t > plays[i + 1].at + 0.7;
                  return (
                    <At key={i} x={x} y={y} z={i + 2} opacity={(covered ? 0.45 : 1) * (1 - clear)} scale={lerp(0.6, 1, pr)}>
                      <CardSet cards={p.cards} s={1.3} />
                    </At>
                  );
                })}
                {[
                  { seat: 2, at: at(2) + 0.5 },
                  { seat: 0, at: at(4) + 0.2 },
                  { seat: 1, at: at(4) + 0.6 },
                  { seat: 2, at: at(4) + 1.0 },
                ].map((p, i) => (
                  <At key={i} x={TRICK_SEATS[p.seat][0]} y={TRICK_SEATS[p.seat][1] - 120} opacity={fade(t, p.at, p.at + 1.3)} scale={pop(t, p.at)}>
                    <Bubble color="#94a3b8">패스</Bubble>
                  </At>
                ))}
                <At x={800} y={600} opacity={fade(t, at(1) + 1.9, at(2))}>
                  <Tag color="#16a34a">✔ 3장 · 9보다 작은 7</Tag>
                </At>
                <At x={800} y={600} opacity={fade(t, at(3) + 1.6, at(4))}>
                  <Tag color="#be123c">🃏 조커 = 5 (3장 맞추기)</Tag>
                </At>
                <At x={800} y={440} opacity={clear} scale={pop(t, at(4) + 1.6)}>
                  <Bubble color="#fde047">호랑이가 새로 시작!</Bubble>
                </At>
              </Felt>
            );
          },
        },
        {
          cues: ["헷갈리기 쉬운 부분! 장수가 다르면 낼 수 없고, 같은 숫자나 더 큰 숫자도 안 됩니다."],
          tail: 1.5,
          render: ({ t }) => (
            <Felt theme="navy">
              <At x={800} y={150} opacity={fade(t, 0)}>
                <div className="flex items-center gap-6">
                  <div className="text-[34px] font-bold text-white">테이블:</div>
                  <CardSet cards={TRICK.seven} s={1.1} />
                </div>
              </At>
              {[
                { cards: [card(6), card(6)], ok: false, label: "2장 ✘" },
                { cards: [card(8), card(8), card(8)], ok: false, label: "더 큰 숫자 ✘" },
                { cards: [card(3), card(3), card(3)], ok: true, label: "OK" },
              ].map((o, i) => (
                <At key={i} x={330 + i * 470} y={520} scale={pop(t, 0.6 + i * 0.6)}>
                  <div className="flex flex-col items-center gap-10">
                    <CardSet cards={o.cards} s={1.1} />
                    <Stamp ok={o.ok} label={o.label} />
                  </div>
                </At>
              ))}
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
            "이렇게 카드를 내다가 손패를 가장 먼저 모두 털어 낸 사람이 바로 승리!",
            "팁. 1번이나 2번 같은 높은 카드는 아껴 뒀다가, 판을 가져와 많은 장수를 한 번에 털어 낼 때 쓰세요.",
            "조커는 장수를 맞추는 만능 카드니까 마지막까지 들고 있는 게 좋아요. 그럼 방을 만들어 직접 해 보세요!",
          ],
          tail: 1.2,
          render: ({ t, at }) => (
            <Felt theme="navy">
              <At x={800} y={170} opacity={fade(t, 0)}>
                <Heading>🏆 먼저 다 내면 승리</Heading>
              </At>
              <At x={800} y={430} scale={1 + 0.03 * pulse(t)}>
                <div className="flex items-center gap-10">
                  <Seat {...CAST[3]} active />
                  <div className="flex h-[150px] w-[110px] items-center justify-center rounded-xl border-4 border-dashed border-emerald-300/60 text-[26px] font-bold text-emerald-200">손패 0</div>
                </div>
              </At>
              <At x={500} y={720} opacity={fade(t, at(1))} scale={pop(t, at(1))}>
                <div className="flex items-center gap-4">
                  <Face c={card(1)} s={1.1} />
                  <Face c={card(2)} s={1.1} />
                  <Tag color="#7c3aed">높은 카드는 아껴서</Tag>
                </div>
              </At>
              <At x={1130} y={720} opacity={fade(t, at(2))} scale={pop(t, at(2))}>
                <div className="flex items-center gap-4">
                  <Face c={joker()} s={1.1} />
                  <Tag color="#be123c">조커는 끝까지</Tag>
                </div>
              </At>
            </Felt>
          ),
        },
      ],
    },
  ],
};
