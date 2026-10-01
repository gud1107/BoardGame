# 소셜 로그인 (Kakao / Google / GitHub / Discord)

Supabase Auth OAuth(PKCE) 기반. 2026-10-02 추가.

## 흐름

```
/login · /signup 의 소셜 버튼 (SocialLoginButtons)
  → supabase.auth.signInWithOAuth({ provider, redirectTo: /auth/callback?next=... })
  → 카카오/구글/깃허브/디스코드 인증창
  → https://<ref>.supabase.co/auth/v1/callback
  → /auth/callback (route.ts: exchangeCodeForSession → 세션 쿠키를 리디렉트 응답에 기록)
  → bootstrapProfile(): profiles + 60일 Lite 체험 (이메일 있고 service role 있을 때만)
  → DB 트리거 handle_new_user(): public.user_profiles 에 닉네임/아바타 저장
  → next (기본 "/")
```

## 파일

| 파일 | 역할 |
| --- | --- |
| `src/components/auth/SocialLoginButtons.tsx` | 버튼. GoTrue 공개 엔드포인트 `/auth/v1/settings`의 `external`을 읽어 **대시보드에서 켜진 프로바이더만** 표시. 하나도 없으면 아무것도 렌더링 안 함 |
| `src/app/auth/callback/route.ts` | 코드 → 세션 교환. 실패 시 `/login?error=oauth`. `next`는 같은 오리진 상대경로만 허용(오픈 리디렉트 방지) |
| `src/lib/auth/bootstrapProfile.ts` | `/api/auth/bootstrap`과 콜백이 공유하는 profiles/체험 생성 로직 |
| `supabase/social_auth.sql` | `user_profiles` 테이블 + RLS + 트리거 + 기존 유저 백필 |

## 설계 메모

- 명세의 `user_profiles`는 기존 비공개 `profiles`(email/role, 본인만 읽기)와 **별도의 공개 프로필 카드**로 두었다. `profiles.email`이 NOT NULL이라 이메일 동의를 안 한 카카오 계정은 profiles에 못 들어가기 때문.
- 트리거는 `exception when others`로 감싸 실패해도 가입 자체는 막지 않는다(auth.users 트리거 에러 = 로그인 불가). `set search_path = public` 추가(SECURITY DEFINER 하드닝).
- 명세의 "소셜 로그인 모달"은 만들지 않고 기존 `/login`, `/signup` 페이지 상단에 버튼을 넣었다(별도 진입점이 필요해지면 컴포넌트 그대로 모달에 넣으면 됨).
- 헤더는 여전히 등급(Lite/게스트) 라벨만 보여준다. 닉네임/아바타 표시는 `user_profiles`를 읽어 붙이면 되는 후속 작업.

## 운영 적용 체크리스트 (사람이 해야 함)

1. Supabase SQL Editor에서 `supabase/social_auth.sql` 실행.
2. Supabase → Authentication → URL Configuration
   - Site URL: 운영 도메인
   - Redirect URLs: `https://<운영도메인>/auth/callback`, `http://localhost:3000/auth/callback` 추가 (없으면 Site URL로 튕김)
3. Authentication → Providers 에서 프로바이더 활성화. 각 개발자 콘솔의 Redirect URI에는 `https://<ref>.supabase.co/auth/v1/callback` 등록.
   - **Kakao**: Kakao Developers → 앱 → 플랫폼 Web 도메인 등록, 카카오 로그인 ON, Redirect URI 등록, 동의항목(닉네임·프로필사진, 이메일 선택). Supabase에 REST API 키 + Client Secret. 비즈앱이 아니라 이메일 동의를 못 받으면 Supabase Kakao 설정의 "Allow users without an email" 을 켤 것.
   - **Google**: Cloud Console OAuth 클라이언트 ID → 승인된 리디렉션 URI 등록 → Client ID/Secret.
   - **GitHub**: Settings → Developer settings → OAuth Apps → Authorization callback URL.
   - **Discord**: Developer Portal → OAuth2 → Redirects.
4. 끝. 켜는 순간 버튼이 자동으로 나타난다(재배포 불필요).
