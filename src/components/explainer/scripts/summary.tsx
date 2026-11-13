"use client";

import { getRoomRulebookSummary } from "@/constants/roomRulebookSummaries";
import { getPosterImage } from "@/constants/posterImages";
import { getPosterVideo } from "@/constants/posterVideos";
import { getPosterTagline } from "@/constants/posterTaglines";
import { getGameMeta } from "@/games/registry";
import type { ExplainerScene, ExplainerScript } from "../types";
import { At, Felt, Heading, Panel, Tag, type FeltTheme } from "../stage";
import { fade, lerp, pop, prog, pulse } from "../anim";

/** Split a paragraph into subtitle-sized sentences. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const THEMES: FeltTheme[] = ["green", "navy", "wine", "wood", "night", "desert"];
function themeFor(id: string): FeltTheme {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return THEMES[h % THEMES.length];
}

/** Framed poster still with a slow Ken Burns push, or the real gameplay loop. */
function Footage({ gameId, t, clip = false, w = 400 }: { gameId: string; t: number; clip?: boolean; w?: number }) {
  const still = getPosterImage(gameId);
  const video = clip ? getPosterVideo(gameId) : null;
  const meta = getGameMeta(gameId);
  const h = w * 1.25;
  const z = 1.04 + 0.08 * Math.min(1, t / 14);
  return (
    <div className="overflow-hidden rounded-[26px] border-4 border-white/80 bg-black shadow-[0_30px_80px_rgba(0,0,0,.6)]" style={{ width: w, height: h }}>
      {video ? (
        <video className="h-full w-full object-cover" autoPlay muted loop playsInline preload="auto" poster={still ?? undefined}>
          <source src={video.webm} type="video/webm" />
          <source src={video.mp4} type="video/mp4" />
        </video>
      ) : still ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={still} alt="" className="h-full w-full object-cover" style={{ transform: `scale(${z})` }} draggable={false} />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-[160px]"
          style={{ background: `linear-gradient(160deg, ${meta?.thumbnail.gradient?.[0] ?? "#334155"}, ${meta?.thumbnail.gradient?.[1] ?? "#0f172a"})` }}
        >
          {meta?.thumbnail.emoji}
        </div>
      )}
    </div>
  );
}

/**
 * Builds a narrated explainer for any game from its curated 30초 룰북 entry
 * (`ROOM_RULEBOOK_SUMMARIES`) + registry meta + lobby poster art. This is the
 * baseline every game gets; hand-animated scripts replace it game by game.
 */
export function buildSummaryScript(gameId: string): ExplainerScript | null {
  const meta = getGameMeta(gameId);
  const sum = getRoomRulebookSummary(gameId);
  if (!meta || !sum) return null;
  const theme = themeFor(gameId);
  const emoji = meta.thumbnail.emoji;
  const tagline = getPosterTagline(meta);
  const players = meta.players.min === meta.players.max ? `${meta.players.min}명` : `${meta.players.min}~${meta.players.max}명`;
  const time = meta.playTime.minMinutes === meta.playTime.maxMinutes ? `${meta.playTime.minMinutes}분` : `${meta.playTime.minMinutes}~${meta.playTime.maxMinutes}분`;

  const intro: ExplainerScene = {
    cues: [`${meta.name} 룰 설명을 시작합니다.`, `${tagline}.`, `${players}이 함께, 한 판에 ${time} 정도 걸리는 게임이에요.`],
    tail: 0.8,
    render: ({ t, at }) => (
      <Felt theme={theme}>
        <At x={480} y={250} scale={pop(t, 0.1)}>
          <div className="text-[150px] leading-none">{emoji}</div>
        </At>
        <At x={480} y={430} opacity={fade(t, 0.3)}>
          <div className="text-[86px] font-black whitespace-nowrap text-white [text-shadow:0_8px_30px_rgba(0,0,0,.7)]">{meta.name}</div>
        </At>
        {meta.nameEn && (
          <At x={480} y={515} opacity={fade(t, 0.5) * 0.8}>
            <div className="text-[30px] font-semibold tracking-widest text-white/80 uppercase">{meta.nameEn}</div>
          </At>
        )}
        <At x={480} y={610} opacity={fade(t, at(1))} scale={lerp(0.9, 1, prog(t, at(1)))}>
          <div className="max-w-[760px] text-center text-[34px] font-bold break-keep text-amber-200">“{tagline}”</div>
        </At>
        <At x={480} y={730} opacity={fade(t, at(2))}>
          <div className="flex gap-4">
            <Tag color="#0ea5e9">👥 {players}</Tag>
            <Tag color="#8b5cf6">⏱ {time}</Tag>
          </div>
        </At>
        <At x={1170} y={450} rot={lerp(8, 3, prog(t, 0, 1.2))} opacity={fade(t, 0.2)} scale={lerp(0.85, 1, prog(t, 0.2, 1))}>
          <Footage gameId={gameId} t={t} />
        </At>
      </Felt>
    ),
  };

  const goalCues = sentences(sum.objective);
  const goal: ExplainerScene = {
    cues: goalCues,
    render: ({ t }) => (
      <Felt theme={theme}>
        <At x={800} y={170} opacity={fade(t, 0)}>
          <Heading>🎯 게임의 목표</Heading>
        </At>
        <At x={800} y={360} scale={pop(t, 0.3) * (1 + 0.04 * pulse(t, 2))}>
          <div className="text-[170px] leading-none [filter:drop-shadow(0_10px_30px_rgba(253,224,71,.5))]">🏆</div>
        </At>
        <At x={800} y={640} opacity={fade(t, 0.6)}>
          <Panel w={1180} accent="#fde047">
            <div className="text-center text-[38px] leading-snug font-bold break-keep">{sum.objective}</div>
          </Panel>
        </At>
      </Felt>
    ),
  };

  const flow: ExplainerScene = {
    cues: sum.turnFlow.map((s, i) => `${i + 1}단계. ${s}`),
    render: ({ t, at, cue }) => (
      <Felt theme={theme}>
        <At x={560} y={80} opacity={fade(t, 0)}>
          <div className="text-[48px] font-black whitespace-nowrap text-white [text-shadow:0_4px_16px_rgba(0,0,0,.7)]">🔄 이렇게 진행해요</div>
        </At>
        {sum.turnFlow.map((step, i) => {
          const on = i === cue;
          const seen = i <= cue;
          const n = sum.turnFlow.length;
          const y = 200 + i * (n > 4 ? 135 : 160);
          return (
            <At key={i} x={lerp(500, 560, prog(t, at(i), 0.5))} y={y} opacity={seen ? fade(t, at(i)) : 0.22} scale={on ? 1 : 0.94}>
              <div
                className="flex w-[980px] items-start gap-5 rounded-[24px] border-2 px-6 py-4 transition-colors"
                style={{ background: on ? "rgba(14,165,233,.28)" : "rgba(0,0,0,.45)", borderColor: on ? "#7dd3fc" : "rgba(255,255,255,.12)" }}
              >
                <div
                  className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full text-[32px] font-black"
                  style={{ background: on ? "#38bdf8" : "rgba(255,255,255,.15)", color: on ? "#082f49" : "#fff" }}
                >
                  {i + 1}
                </div>
                <div className="text-[29px] leading-snug font-semibold break-keep text-white">{step}</div>
              </div>
            </At>
          );
        })}
        <At x={1330} y={470} rot={2} opacity={fade(t, 0.3)}>
          <div className="flex flex-col items-center gap-3">
            <Footage gameId={gameId} t={t} clip w={360} />
            <div className="rounded-full bg-black/60 px-4 py-1 text-[20px] font-semibold text-white/80">실제 게임 화면</div>
          </div>
        </At>
      </Felt>
    ),
  };

  const scenes: ExplainerScript["chapters"] = [
    { title: "인트로", scenes: [intro] },
    { title: "게임의 목표", scenes: [goal] },
    { title: "진행 방법", scenes: [flow] },
  ];

  if (sum.specialRules.length > 0) {
    scenes.push({
      title: "특수 룰 · 주의점",
      scenes: [
        {
          cues: ["꼭 알아 둘 특수 룰이에요.", ...sum.specialRules],
          render: ({ t, at, cue }) => (
            <Felt theme={theme}>
              <At x={800} y={150} opacity={fade(t, 0)}>
                <Heading color="#fca5a5">⚠️ 특수 룰 · 주의점</Heading>
              </At>
              {sum.specialRules.map((r, i) => (
                <At key={i} x={800} y={330 + i * 165} scale={pop(t, at(i + 1))}>
                  <div
                    className="w-[1240px] rounded-[26px] border-2 px-8 py-5 text-center text-[34px] leading-snug font-bold break-keep text-white"
                    style={{
                      background: cue === i + 1 ? "rgba(244,63,94,.28)" : "rgba(0,0,0,.5)",
                      borderColor: cue === i + 1 ? "#fda4af" : "rgba(255,255,255,.15)",
                    }}
                  >
                    {r}
                  </div>
                </At>
              ))}
            </Felt>
          ),
        },
      ],
    });
  }

  scenes.push({
    title: "정리",
    scenes: [
      {
        cues: ["정리해 볼까요?", sum.objective.split(/(?<=[.!?])\s+/)[0], "나머지는 직접 해 보면서 익히는 게 제일 빨라요. 방을 만들어 바로 시작해 보세요!"],
        tail: 1.2,
        render: ({ t, at }) => (
          <Felt theme={theme}>
            <At x={800} y={190} opacity={fade(t, 0)}>
              <Heading>✅ 한 줄 정리</Heading>
            </At>
            <At x={800} y={420} opacity={fade(t, at(1))} scale={lerp(0.92, 1, prog(t, at(1)))}>
              <Panel w={1200} accent="#86efac">
                <div className="text-center text-[40px] leading-snug font-bold break-keep">{sentences(sum.objective)[0]}</div>
              </Panel>
            </At>
            <At x={800} y={680} scale={pop(t, at(2))}>
              <div className="flex items-center gap-5 rounded-full bg-red-600 px-10 py-5 text-[40px] font-black text-white shadow-[0_20px_60px_rgba(220,38,38,.5)]">
                {emoji} 방 만들고 플레이!
              </div>
            </At>
          </Felt>
        ),
      },
    ],
  });

  return { gameId, title: `${meta.name} 룰 설명`, kind: "summary", chapters: scenes };
}
