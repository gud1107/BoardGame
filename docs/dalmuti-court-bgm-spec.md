# 달무티 — 중세 궁정 류트 & 광대 BGM/SFX 엔진 명세 (검토본)

- 작성일: 2026-09-27
- 상태: **BGM 부분은 2026-09-28에 구현됨** → [dalmuti-class-saga-bgm.md](./dalmuti-class-saga-bgm.md) (§5 결정 1번 확정: mp3 대신 신디 BGM). SFX 항목은 여전히 미구현
- 대상 게임: `src/games/dalmuti/` (id `dalmuti`)

## 1. 요청 요약

"인생은 불공평합니다" 테마를 살린 **중세 궁정 + 선술집(Tavern & Court) 분위기의 신디사이저 사운드**를 외부 오디오 파일 없이 Web Audio API로 만든다.

| 구성 | 내용 |
|---|---|
| BGM | 6/8박자 살타렐로풍 궁정 무곡, 108 BPM(4분음표 기준 → 8분음표 ≈ 0.278s, 점4분 ≈ 72), 24스텝(4마디) 루프 |
| 화성 진행 | Am → G → F → E7 (안달루시아 종지) |
| 성부 | ① 류트 플럭(triangle + lowpass 950Hz) 8분음표 아르페지오 ② 백파이프풍 드론 베이스(sawtooth + lowpass 280Hz, 마디 첫 박) ③ 탬버린/광대 방울(매 8분음표, 1·4박 악센트) |
| 볼륨 | BGM 0.12 / SFX 0.35 / master 1 |
| SFX 5종 | 카드 제출 "촤르륵"(장수 비례, 최대 5회) · 달무티(1번) 카드 팡파르(C5-E5-G5-C6) · 조커 단독 "삐빅" · 패스 낮은 단음 · 대혁명 경보(A 장3화음 상행, square) |
| HUD | 상단 🪕 "Court Dance" / 🔇 "Muted" 토글 버튼 |

명세가 제안한 파일: `src/games/dalmuti/audio/dalmutiSoundEngine.ts`(독립 싱글톤 클래스), `DalmutiSoundHUD.tsx`, 인게임 `handlePlayCard`/`handlePass`/`handleRevolution` 분기.

## 2. 현재 코드베이스와의 대조

명세는 달무티에 사운드가 없다는 전제로 쓰였지만, 실제로는 이미 사운드 파이프라인이 있다.

| 명세 항목 | 현재 구현 | 비고 |
|---|---|---|
| BGM | `DalmutiGame.tsx`의 `useGameBgm(phase === "playing" ? "dalmuti" : null)` → `bgmManager.ts`가 `/assets/sounds/bgm/dalmuti.mp3` 재생 | **해당 mp3가 저장소에 없다** (`public/assets/sounds/bgm/`에는 README.md만 있음). bgmManager는 404가 나면 조용히 건너뛰므로 **지금 달무티 BGM은 사실상 무음**. 신디 BGM이 실제로 채울 수 있는 빈자리 |
| 카드 제출음 | `DalmutiBoard.tsx` `dispatch()` → `playParchmentSubmit()`, 트릭 착지 시 `playCardSubmitImpact()` | 이미 있음. "촤르륵"은 교체/보강 후보 |
| 패스 | `playPassWhiff()` + 브라우저 TTS `speakPass()` (자동 패스도 같은 경로) | 이미 있음 |
| 대혁명 | 엔진 `revolutionOption` 페이즈 + `declareRevolution` 액션, `playRevolutionBell()` + `RevolutionBanner` | 이미 있음. 명세의 "조커 2장 공개 시 경보"와 같은 이벤트 |
| 달무티(1번) 팡파르 | 없음 (`playDalmutiFinishFanfare`는 라운드 종료 연출용) | **신규 후보** — `Card.rank === 1` |
| 조커 단독 | 없음 | **신규 후보** — `Card.isJoker`, 단독 제출 시 |
| 음소거 | 사이트 전역 `useAudioSettingsStore`(`masterMuted`/`bgmVolume`/SFX 볼륨), 보드 내 토글도 이 스토어 사용 | 명세의 독립 `isMuted`는 전역 설정과 어긋남 |
| 오디오 언락 | 루트 `onPointerDownCapture` → `getSoundEngine().unlock()` (모바일 자동재생 정책 방어, 2026-09-13) | 명세는 HUD 첫 클릭에만 의존 |

## 3. 명세 코드 자체의 문제점

구현 시 그대로 옮기면 안 되는 부분.

1. **HUD 첫 클릭이 BGM을 켜자마자 음소거한다.** `toggle()`이 `startBGM()` 직후 `toggleMute()`를 부르는데 `isMuted` 초기값이 `false`라 첫 클릭 결과가 `true`(음소거)가 된다.
2. **독립 `AudioContext` + 독립 mute.** 전역 `soundEngine`과 별개 컨텍스트를 하나 더 만들고, 헤더 전역 음소거·설정 모달 볼륨을 무시한다. (Great Legacy 교향곡 BGM처럼 `soundEngine`의 `bgmGain`/설정 스토어 경로에 붙이는 것이 이 프로젝트의 패턴.)
3. **`stopBGM()` 호출 지점이 없다.** 게임 이탈/언마운트/페이즈 전환 시 루프가 계속 돈다. 기존 `useGameBgm`의 "playing 페이즈에서만" 규칙과도 맞춰야 한다.
4. **탬버린이 사실상 2.8~3.4kHz 사인파 비프.** 노이즈 버스트가 아니라 순음이고 매 8분음표마다 울려서 "귀를 찌르지 않는" 목표와 정반대. `osc.type = 'highpass'` 줄은 무의미한 잔재(유효하지 않은 값이라 무시된 뒤 `'sine'`으로 덮어씀). → 짧은 필터드 화이트노이즈 + 저볼륨이 맞음.
5. **드론 베이스 sawtooth 0.09 × 마디마다 재어택** — "지속 저음"이라기보다 마디마다 끊기는 베이스. 드론을 원하면 루프 동안 하나를 유지하고 주파수만 바꾸는 편이 자연스럽다.
6. **문서와 코드 불일치.** 1절의 류트 선율(A3-C4-B3-A3-E4-D4)과 "A 마이너 & 도리안" 설명이 실제 코드 선율(화음 아르페지오)·진행(Am-G-F-E7, 프리지안 도미넌트 색)과 다르다.
7. **대혁명 경보가 `playRevolutionBell`과 중복.** 둘 다 켜면 같은 이벤트에 두 소리가 겹친다 — 교체할지 하나를 고를지 결정 필요.
8. **스케줄러가 `setTimeout` 45ms + lookahead 0.12s**로 백그라운드 탭에서 스로틀되면 음이 몰려 재생된다. 탭 비활성 시 일시정지 처리가 필요.

## 4. 구현 시 권장 방향 (결정 대기)

- `dalmuti.mp3` 대신 **이 신디 BGM을 달무티 BGM 소스로** 쓰되, 전역 `soundEngine`/`audioSettings`(BGM 볼륨·음소거)에 연결하고 `playing` 페이즈에서만 재생.
- 별도 HUD 버튼은 추가하지 않고 기존 보드 음소거 토글·헤더 전역 토글을 그대로 사용 (추가한다면 1번 버그 수정 필수).
- SFX는 **신규 2종만 추가**: 달무티(1번) 팡파르, 조커 단독 "삐빅". 패스/제출/대혁명은 기존 소리 유지 또는 교체 여부를 따로 결정.
- 탬버린은 노이즈 기반으로 재설계, 볼륨 하향.
- 로직은 결정론과 무관한 순수 연출이므로 lockstep 엔진(`engine.ts`)은 건드리지 않고, 기존처럼 보드의 상태 diff 지점에서 재생.

## 5. 결정이 필요한 항목

1. 신디 BGM으로 mp3 슬롯을 대체할지 (mp3를 나중에 넣을 계획이 있는지)
2. 대혁명 소리: 기존 종소리 유지 / 명세 경보로 교체 / 둘 다
3. 카드 제출음: 기존 양피지음 유지 / "촤르륵"으로 교체
4. 전용 🪕 HUD 버튼을 따로 둘지
