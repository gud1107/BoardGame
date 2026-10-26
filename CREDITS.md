# 오디오 크레딧 (CREDITS)

이 프로젝트가 사용하는(또는 사용을 제안한) 외부 오디오 리소스의 출처와 라이선스를
기록합니다. 효과음(SFX)은 전부 [src/lib/audio/soundEngine.ts](src/lib/audio/soundEngine.ts)에서
Web Audio API로 직접 합성하므로 별도 출처가 없습니다 — 아래는 배경음악(BGM)에만
해당합니다.

## 배경음악 (BGM)

실제 mp3 파일은 저장소에 포함되어 있지 않습니다. 각 파일이
[public/assets/sounds/bgm/](public/assets/sounds/bgm/)에 존재하지 않는 동안 해당
게임은 자동으로 무음 처리됩니다 — 자세한 내용은 그 폴더의 `README.md` 참고.

| 파일 | 게임 | 트랙명 | 아티스트 | 라이선스 | 링크 |
|---|---|---|---|---|---|
| `lobby.mp3` | 로비 | Lofi Jazz Trio Sunny Cafe | alex-morgan | Pixabay Content License | https://pixabay.com/music/lofi-lofi-jazz-trio-sunny-cafe-560051/ |
| `destiny-war-39.mp3` | 운명전쟁39 | Cyberpunk, synthwave | fidelfortune | Pixabay Content License | https://pixabay.com/music/synthwave-cyberpunk-synthwave-351505/ |
| `las-vegas.mp3` | 라스베가스 | Swing Jazz Midnight Club | alex-morgan | Pixabay Content License | https://pixabay.com/music/modern-jazz-swing-jazz-midnight-club-568167/ |
| `grid-poker.mp3` | 그리드포커 | Deep House | Kulakovka | Pixabay Content License | https://pixabay.com/music/upbeat-deep-house-295874/ |
| `mal-dalli-ja.mp3` | 말달리자 | Epic Action Trailer | echoes_of_lumen | Pixabay Content License | https://pixabay.com/music/orchestral-epic-action-trailer-583435/ |
| `dalmuti.mp3` | 달무티 | Harpsichord Mania (Fast action beat) | Montogoronto | Pixabay Content License | https://pixabay.com/music/upbeat-harpsichord-maniafast-action-beat-248619/ |

### 라이선스 조건 요약 — Pixabay Content License

- 상업적/비상업적 이용 무료, 크레딧 표시 의무 없음(단, 이 표는 투명성을 위해
  자발적으로 기록).
- **금지 사항**: 콘텐츠 자체를 다른 스톡/판매 플랫폼에 재판매·재배포, NFT로 발행,
  Pixabay와 경쟁하는 방식으로 재배포.
- 정확한 최신 조건은 반드시 https://pixabay.com/service/license-summary/ 에서
  재확인할 것 — 이 문서는 2026-08-27 기준 확인한 요약이며 법률 자문이 아닙니다.
- 엄밀한 CC0/퍼블릭도메인은 **아닙니다.** 완전한 CC0을 원하면 OpenGameArt.org
  (CC0/CC-BY 필터) 또는 Freesound.org(CC0 필터)에서 대체 트랙을 찾아 위 표를
  갱신하세요.

### 알려진 특이사항

- `lobby.mp3`(Lofi Jazz Trio Sunny Cafe), `destiny-war-39.mp3`(Cyberpunk,
  synthwave) 두 트랙은 Pixabay 페이지에 "AI generated"로 표시되어 있습니다 —
  라이선스 자체는 동일하게 적용되지만, AI 생성 음원 사용에 대한 내부 정책이
  있다면 교체를 검토하세요.
- `dalmuti.mp3`(Harpsichord Mania)는 원본 길이가 46초로 6곡 중 가장 짧습니다.
  `bgmManager.ts`가 `loop=true`로 재생하므로 기능상 문제는 없으나, 루프 지점이
  짧게 반복되는 느낌이 날 수 있습니다 — 더 긴 트랙으로 교체를 원하면 위 표의
  파일만 바꾸면 됩니다.

## 다른 트랙으로 교체하려면

1. 원하는 CC0 / Royalty-Free 트랙을 고르고 라이선스 조건을 확인합니다.
2. 파일명을 위 표의 파일명에 맞춰 [public/assets/sounds/bgm/](public/assets/sounds/bgm/)에 저장합니다.
3. 이 표의 해당 행(트랙명/아티스트/라이선스/링크)을 갱신합니다.

코드 변경은 필요 없습니다 — `bgmManager.ts`는 파일 존재 여부만으로 동작합니다.

## 이미지 (라스베가스 카지노 사진)

[src/games/lasVegas/CasinoPhotoArt.tsx](src/games/lasVegas/CasinoPhotoArt.tsx)가 쓰는 사진. 모두
Wikimedia Commons의 CC0/퍼블릭 도메인 파일(최대 1280×1400 축소본)이라 표기 의무는 없지만 출처를 기록해 둡니다.
간판·상호·기업 로고를 알아볼 수 없는 사진만 골랐습니다 — 라이선스가 자유여도 사진 속 상표는 별개입니다.

| 파일 | 카지노 | 원본 | 작가 | 라이선스 |
|---|---|---|---|---|
| `casino-1-manhattan.jpg` | 1 맨해튼 펜트하우스 | https://commons.wikimedia.org/wiki/File:City_of_lights_(Unsplash).jpg | Luca Bravo lucabravo | CC0 |
| `casino-2-harbour.jpg` | 2 빅토리아 하버 | https://commons.wikimedia.org/wiki/File:Victoria_Harbour_skyscrapers.jpg | Wilfredor | CC0 |
| `casino-3-crystal-tower.jpg` | 3 크리스털 타워 | https://commons.wikimedia.org/wiki/File:Glass_london_skyscrapers_(Unsplash).jpg | Samuel Zeller samuelzeller | CC0 |
| `casino-4-golden-curve.jpg` | 4 골든 커브 레지던스 | https://commons.wikimedia.org/wiki/File:Curved_skyscraper_in_sun_(Unsplash).jpg | Scott Webb scottwebb | CC0 |
| `casino-5-sunset-skyline.jpg` | 5 선셋 스카이라인 | https://commons.wikimedia.org/wiki/File:Best_City_in_the_World_(Unsplash).jpg | Matt Lamers lamerbrain | CC0 |
| `casino-6-harbourfront.jpg` | 6 하버프론트 타워 | https://commons.wikimedia.org/wiki/File:Hong_Kong_skyscrapers_in_a_night_of_typhoon.jpg | Wilfredor | CC0 |

자체 제작 SVG(`CasinoEmblem.tsx`)는 사진이 없는 카지노용 대체 이미지로 남아 있습니다.

## 영상 (갓생 플래너 하루 재생 브이로그)

[src/games/godLifePlanner/VlogStage.tsx](src/games/godLifePlanner/VlogStage.tsx)가 쓰는 짧은 실사 클립
(`public/assets/games/god-life-planner/vlog/<키>.webm|mp4|webp`). 5초 이하로 잘라 640×360·무음으로 다시 인코딩했습니다.
한국 사용자에게 맞게 동아시아 출연자가 나오는 클립을 골랐습니다(2026-10-21 교체 — 처음엔 Coverr 서양인 클립).

**Pexels** ([라이선스](https://www.pexels.com/license/)): 웹·앱 포함 무료 사용, 수정 허용, 출처 표기 의무 없음.
금지: 알아볼 수 있는 인물을 나쁘게·불쾌하게 묘사, 수정 없이 판매, 인물·브랜드가 제품을 보증하는 것처럼 보이게 하기,
다른 스톡 플랫폼에 재배포. 피곤함·졸음 장면은 원본 영상 자체가 그런 연출(제목 "Exhausted…", "sleeping on her desk")입니다.

| 파일 키 | 쓰는 곳 | 원본 (Pexels 영상 ID) |
|---|---|---|
| `wake` | 하루 시작 (커튼 열기, 세로 영상 얼굴 쪽 크롭) | https://www.pexels.com/video/8517524/ |
| `sleep` | 수면·낮잠 | https://www.pexels.com/video/6941196/ |
| `study` | 공부 | https://www.pexels.com/video/9198175/ |
| `exercise` | 운동 (세로 영상 + 흐린 배경 채우기) | https://www.pexels.com/video/7591713/ |
| `work` | 일(낮) | https://www.pexels.com/video/8512948/ |
| `nightWork` | 일(밤)·야근 | https://www.pexels.com/video/9364052/ |
| `meet` | 약속 성사 | https://www.pexels.com/video/5701066/ |
| `rest` | 휴식·혼자 나온 약속 | https://www.pexels.com/video/8151836/ |
| `temptation` | 유혹 (가운데 확대) | https://www.pexels.com/video/7480515/ |
| `tired` | 실패·약속 펑크 (세로 영상 크롭) | https://www.pexels.com/video/7778488/ |
| `collapse` | 탈진·번아웃·무효 (인물 쪽 확대) | https://www.pexels.com/video/7844957/ |
| `dusk` | 하루 마감 (비 오는 강남) | https://www.pexels.com/video/16046525/ |
| `idle` | 빈칸 | Coverr — https://coverr.co/videos/coverr-raindrops-on-the-window-7102 (인물 없음) |

**Coverr** ([라이선스](https://coverr.co/license)): 상업·비상업 무료, 출처 표기 의무 없음, 영상 재판매·영상 제공 서비스 금지.

## 3D 캐릭터 모델 (VRM)

3D 테이블의 인물([src/games/shared/three/VrmPerson.tsx](src/games/shared/three/VrmPerson.tsx))이 쓰는 VRM 모델입니다.
파일은 [public/models/vrm/](public/models/vrm/)에 있고, 모바일용으로 텍스처 해상도만 줄였습니다(형태·표정·뼈대는 원본 그대로).
라이선스는 각 파일에 들어 있는 VRM 메타 정보를 2026-10-27에 직접 확인한 내용입니다.

| 파일 | 모델 | 저작자 | 라이선스 | 상업 이용 | 수정 | 출처 표기 | 원본 |
|---|---|---|---|---|---|---|---|
| `pixiv-sample.vrm` | VRM1_Constraint_Twist_Sample | (c) 2022 pixiv Inc. | VRM Public License 1.0 | 법인 포함 허용 | 허용(재배포 포함) | 불필요 | https://github.com/vrm-c/vrm-specification/tree/master/samples/VRM1_Constraint_Twist_Sample |
| `three-vrm-girl.vrm` | three-vrm-girl | pixiv Inc. | VRoid Hub 라이선스 (otherPermissionUrl) | 법인 포함 허용 | 허용 | 불필요 | https://github.com/pixiv/three-vrm/tree/v0.6.11/packages/three-vrm/examples/models |
| `seed-san.vrm` | Seed-san | VirtualCast, Inc. | VRM Public License 1.0 | 법인 포함 허용 | 허용(재배포 포함) | **필요** | https://github.com/vrm-c/vrm-specification/tree/master/samples/Seed-san |

- **Seed-san은 출처 표기가 필요합니다.** 2026-10-27 패치노트(v1.100.0)와 이 문서에 "Seed-san © VirtualCast, Inc."로 표기했습니다.
- 로봇 팔(`robo_arm` 메시)은 보드게임 테이블에 맞지 않아 화면에서만 숨깁니다(파일은 그대로).

