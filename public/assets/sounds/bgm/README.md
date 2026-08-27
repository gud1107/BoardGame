# 테마 BGM 파일 위치

이 폴더는 `src/lib/audio/bgmManager.ts`가 재생하는 6개 게임별 테마 배경음악
mp3 파일이 들어갈 자리입니다. **저장소에는 실제 오디오 파일이 포함되어 있지
않습니다** — 이 프로젝트는 지금까지 저작권 리스크 때문에 실제 음원 파일을 쓴
적이 없고(`저작권, 상표권.md` 참고), 이번 세션에서도 사용자가 직접 라이선스를
확인하고 다운로드해 아래 경로에 넣는 것으로 합의되었습니다.

각 파일이 없으면 해당 게임은 자동으로 무음 처리되며(콘솔 경고 1회만 출력),
다른 게임이나 효과음에는 아무 영향이 없습니다. 파일을 넣으면 재배포 없이 바로
적용됩니다.

| 파일명 | 게임 | 원하는 분위기 | 2026-08-26 세션에서 제안한 후보 (Pixabay Content License) |
|---|---|---|---|
| `lobby.mp3` | 게임 허브(`/`) | Lo-fi / Jazz Hop | [Lofi Jazz Trio Sunny Cafe — alex-morgan](https://pixabay.com/music/lofi-lofi-jazz-trio-sunny-cafe-560051/) |
| `destiny-war-39.mp3` | 운명전쟁39 | 사이버펑크 네온 | [Cyberpunk, synthwave — fidelfortune](https://pixabay.com/music/synthwave-cyberpunk-synthwave-351505/) |
| `las-vegas.mp3` | 라스베가스 | 화려한 스윙 재즈 | [Swing Jazz Midnight Club — alex-morgan](https://pixabay.com/music/modern-jazz-swing-jazz-midnight-club-568167/) |
| `grid-poker.mp3` | 그리드포커 | 딥 하우스 | [Upbeat Deep House — Kulakovka](https://pixabay.com/music/upbeat-deep-house-295874/) |
| `mal-dalli-ja.mp3` | 말달리자 | 빠른 오케스트라 레이싱 | [Epic Action Trailer — echoes_of_lumen](https://pixabay.com/music/orchestral-epic-action-trailer-583435/) |
| `dalmuti.mp3` | 달무티 | 중세풍 하프시코드 | [Harpsichord Mania (Fast action beat) — Montogoronto](https://pixabay.com/music/upbeat-harpsichord-maniafast-action-beat-248619/) |

**주의**: 위 Pixabay 트랙은 Pixabay Content License(상업적 사용 무료, 크레딧
표시 불필요, 재판매/NFT 금지)이며 CC0/퍼블릭도메인은 아닙니다. 다른 트랙으로
바꾸고 싶다면 파일명만 위 표와 맞추면 됩니다. 각 링크 페이지의 Download
버튼으로 mp3를 받아 이 폴더에 그대로 저장하세요.

전체 아티스트/라이선스 상세 크레딧은 프로젝트 루트의
[`CREDITS.md`](../../../../CREDITS.md) 참고 — `lobby.mp3`/`destiny-war-39.mp3`
두 트랙은 Pixabay 페이지에 "AI generated"로 표시되어 있고, `dalmuti.mp3`는
원본 46초로 가장 짧다는 점(루프 재생 자체엔 문제 없음)도 그쪽에 기록해뒀습니다.

**2026-08-27 세션에서 6개 링크 전부 재확인**: 6개 페이지 모두 여전히 살아있고
(404 아님) 위 표의 트랙명·아티스트가 그대로 일치함을 `WebFetch`로 확인했습니다.
mp3 바이너리 자체는 이 세션에서도 여전히 자동 다운로드가 불가능해(Pixabay가
프로그래밍적 요청을 차단) 사용자가 직접 Download 버튼으로 받아야 합니다.
