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
Wikimedia Commons의 CC0/퍼블릭 도메인 파일(1280px 축소본)이라 표기 의무는 없지만 출처를 기록해 둡니다.
간판·상호가 없는 피사체만 골랐습니다 — 라이선스가 자유여도 사진 속 상표는 별개입니다.

| 파일 | 카지노 | 원본 | 작가 | 라이선스 |
|---|---|---|---|---|
| `casino-1-chandelier.jpg` | 1 황금 샹들리에 | https://commons.wikimedia.org/wiki/File:Chandelier_of_the_Crystal_Staircase,_Dolmabah%C3%A7e_Palace,_Istanbul.jpg | Julian Lupyan | CC0 |
| `casino-2-yacht.jpg` | 2 리비에라 요트 클럽 | https://commons.wikimedia.org/wiki/File:Samsara_Yacht.jpg | Davidley | CC0 |
| `casino-3-lagoon.jpg` | 3 몰디브 라군 | https://commons.wikimedia.org/wiki/File:Boathouse_neighborhood_(Unsplash).jpg | Ishan @seefromthesky (Unsplash) | CC0 |
| `casino-4-mirrors.jpg` | 4 거울의 궁전 | https://commons.wikimedia.org/wiki/File:Palace_of_Versailles_Hall_of_Mirrors_(27738100023).jpg | Gary Todd | CC0 |
| `casino-5-santorini.jpg` | 5 산토리니 선셋 | https://commons.wikimedia.org/wiki/File:Santorini_Sunset_(26536503).jpeg | Reid Gower | CC0 |
| `casino-6-champagne.jpg` | 6 샴페인 라운지 | https://commons.wikimedia.org/wiki/File:Champagne-glasses-1940262_1920.jpg | Myriam Zilles | CC0 |

자체 제작 SVG(`CasinoEmblem.tsx`)는 사진이 없는 카지노용 대체 이미지로 남아 있습니다.
