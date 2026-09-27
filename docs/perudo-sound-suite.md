# 페루도 잉카 미스터리 BGM (Perudo Sound Suite)

2026-09-28. 붙여넣은 명세 「캐리비안 해적 & 안데스 판플루트 프로시저럴 사운드 엔진」을 페루도(`perudo`)에 적용했다. 외부 오디오 파일 없이 Web Audio만 쓴다.

## 파일

| 파일 | 역할 |
|---|---|
| `src/games/perudo/perudoIncaScore.ts` | 순수 악보(96 BPM, 8분음표 1스텝, 4마디/32스텝, Dm → Bb → C → Am). Web Audio 없음 |
| `src/games/perudo/perudoSound.ts` | 신디 엔진 `getPerudoSound()`. 톰, 셰이커, 나일론 기타, 판플루트 |
| `src/games/perudo/PerudoSoundHud.tsx` | 🎲 Inca Dice(BGM) / 🔔 효과음 토글. 룰북 버튼 옆 |
| `src/games/perudo/perudoIncaScore.test.ts` | 악보 테스트 5건 |
| `src/games/perudo/PerudoBoard.tsx` | `phase === "playing"`일 때만 BGM, 기존 🔊 버튼을 HUD로 교체, 보드 탭 시 AudioContext 언락 |

## 명세와 다르게 한 부분

- **SFX 5종은 새로 만들지 않았다.** 명세의 컵 슬램, 호가 선언, 듀도, 칼자, 주사위 탈락은 전부 이미 소리가 나는 순간이다. 굴림에는 `playDiceRattle`/`playCupThud`, 베팅 확정에는 `playPerudoBetStamp`, 판정에는 4종 쇼다운 시네마틱(`PerudoActionFX.tsx`)이 있다. 명세 버전까지 넣으면 모든 순간에 소리가 두 번 난다. 그래서 이번 작업은 BGM과 HUD다.
- **음소거와 볼륨은 사이트 공용 설정을 쓴다.** 명세에는 자체 `isMuted`/`toggleMute`가 있었다. 여기서는 헤더 🔇/🔊, 설정 모달 슬라이더, 이 HUD가 모두 같은 값을 쓴다. BGM 슬라이더 기본값 0.4에서 버스 게인이 명세의 0.09가 된다.
- **HUD는 버튼 2개다.** BGM과 효과음을 따로 켜고 끈다. 전체 음소거 상태에서 하나를 켜면 마스터 음소거도 풀린다. 효과음을 켜면 베팅 스탬프 소리로 확인시켜 준다. 기존 단일 🔊(마스터 음소거) 버튼을 이것으로 교체했다.
- **BGM은 입찰 중에만 나온다.** 공개 화면과 게임 종료 화면에서는 쉬고, 쇼다운 연출 소리만 난다.
- 악보 조정:
  - 기타는 명세처럼 반 마디마다 근음만 치지 않는다. 근음 → 5음 아르페지오라서 코드 진행이 들린다.
  - 판플루트는 음마다 정확히 2스텝이다. 명세는 2.2박이라 다음 음과 겹쳤다. 판플루트에는 음높이에 맞춘 숨소리 노이즈를 얹었다.
  - 셰이커는 삼각파 대신 하이패스 노이즈다. 명세의 삼각파는 방울 소리가 아니라 삐 소리로 들렸다.
- 스케줄러는 `setInterval` + 룩어헤드 방식이다. 탭이 스로틀된 뒤에는 밀린 음을 몰아서 치지 않고 박자에 다시 합류한다. 코요테, 랫어탯캣, 오이 다섯 개와 같은 구조다.
- 명세 끝의 외부 음원 추천 목록(캐리비안의 해적 OST 등)은 반영하지 않았다. 저작권 음원이다.

## 검증

- `npx vitest run src/games/perudo`: 89/89 (새 악보 테스트 5건 포함)
- eslint `src/games/perudo`: 통과
- tsc: 페루도 오류 0 (`.next/dev/types`의 오래된 파일 1건은 무관)
- **실제 청음은 하지 않았다.** 톰의 60~85Hz 저음은 휴대폰 스피커에서 거의 안 들릴 수 있다.
