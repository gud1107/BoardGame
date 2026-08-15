# Project Workflow Rules

## 1. Session Initialization (새 대화 시작 시 필수 실행)
- **자동 맥락 파악:** 모든 새로운 대화 세션이 시작되면, 사용자의 질문에 답변하기 전에 항상 프로젝트 루트의 `HANDOFF.md` 파일이 존재하는지 확인하고 그 내용을 가장 먼저 읽어서 이전 작업 맥락, 최근 변경 사항, 진행 상황을 파악해야 합니다.
- `HANDOFF.md`가 업데이트되어 있다면 해당 내용을 기준으로 이전 세션의 작업을 이어서 진행하세요.

## 2. Task Completion & Deployment Protocol (작업 완료 및 배포 자동화)
사용자가 "마무리해줘", "완료해줘", "커밋하고 배포해줘" 등의 요청을 하거나 작업이 끝났을 때, 다음 순서로 작업을 자동 완수해야 합니다:

1. **검증 (Verification):**
   - 타입 체크(`npx tsc --noEmit`) 및 테스트(`npm test` / `npx vitest run`)를 실행하여 오류가 없는지 확인합니다.
2. **인수인계 문서 업데이트 (HANDOFF.md):**
   - 이번 세션에서 새로 진행한 작업 내용, 변경된 파일, 테스트 결과 등을 `HANDOFF.md`에 자동으로 업데이트하여 기록합니다.
3. **Git Commit & Push:**
   - 작업 내용에 맞는 직관적인 커밋 메시지(Conventional Commits)를 작성합니다.
   - `git add .`, `git commit -m "..."`, `git push origin <현재 브랜치>`를 실행합니다.
4. **배포 (Deployment):**
   - 프로젝트 배포 명령어(예: `npm run deploy` 등)가 제공되어 있거나 자동 배포 환경인 경우 배포 프로세스를 수행/확인합니다.
5. **최종 보고:**
   - 실행한 검증 결과, 커밋 내역, 푸시 상태, 배포 상태를 간략히 요약하여 사용자에게 보고합니다.