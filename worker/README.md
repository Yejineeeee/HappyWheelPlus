# happywheel-ai (AI 조건 해석 서버)

## 무엇을 하나

웹앱의 "문장으로 조건 입력"을 받아 OpenAI에 보내고, 경로 탐색에 쓸 가중치(경사·노면·턱·불확실성), 꼭 필요한 편의시설(화장실·엘리베이터·벤치·식수대), 한 줄 설명을 돌려주는 Cloudflare Worker입니다. OpenAI 키를 브라우저에 두지 않으려고 이 서버가 중간에서 대신 호출합니다. 엔드포인트는 `POST /weights` 하나입니다.

## 비용과 보호 장치

- 허용된 Origin에서 온 요청만 받습니다. 기본값은 `https://yejineeeee.github.io`, `http://localhost:5173`, `http://localhost:4173`이고 `wrangler.toml`의 `ALLOWED_ORIGINS`(쉼표 구분)에서 바꿀 수 있습니다. 그 외는 403입니다.
- IP당 하루 5회(`DAILY_LIMIT_PER_IP`), 전체 하루 300회(`DAILY_LIMIT_TOTAL`)까지만 처리하고 넘으면 429입니다. 횟수는 KV(`LIMITS`)에 기록하고, UTC 자정(한국 시간 오전 9시)에 초기화됩니다.
- 입력 문장은 300자까지, 요청 본문은 4 KB까지입니다.
- Origin 검사는 브라우저용 보호일 뿐 curl 등으로는 우회할 수 있습니다. 실제 비용 보호는 하루 한도와 OpenAI 월 예산이에요.
- 마지막 안전망은 OpenAI 쪽 월 사용 한도입니다. OpenAI 대시보드(Settings → Limits)에서 월 예산을 직접 정해 두세요. 서버 한도를 뚫려도 이 금액 이상은 나가지 않습니다.

## 배포 순서

사전 준비: Cloudflare 계정, OpenAI API 키, OpenAI 월 예산 설정. 명령은 Git Bash와 PowerShell에서 쓸 수 있습니다. PowerShell에서 `npx`가 "스크립트를 실행할 수 없으므로 ... npx.ps1" 오류로 실패하면 시스템 정책을 바꾸지 말고 `npx.cmd`를 쓰세요(예: `npx.cmd wrangler login`).

```
cd worker
npm ci
npx wrangler login
npx wrangler kv namespace create LIMITS
```

마지막 명령이 출력한 `id`를 `wrangler.toml`의 `[[kv_namespaces]]` 아래 `id = "REPLACE_WITH_KV_ID"` 자리에 붙여 넣습니다.

```
npx wrangler secret put OPENAI_API_KEY
```

프롬프트가 뜨면 키를 붙여 넣습니다. 키는 저장소에 올라가는 파일(wrangler.toml 등)에는 적지 않아요.

```
npx wrangler deploy
```

출력되는 `https://happywheel-ai.<sub>.workers.dev` 주소를 적어 둡니다. 이 주소를 두 곳에 넣습니다.

1. GitHub 저장소 Settings → Secrets and variables → Actions → Variables에 `VITE_AI_ENDPOINT`로 추가합니다. 다음 배포부터 사이트에 AI 입력창이 나타납니다. 값이 없으면 입력창은 숨겨집니다. 변수를 추가한 뒤 Actions에서 pages 워크플로를 수동 실행(Run workflow)하거나 main에 푸시해야 반영돼요.
2. 로컬 개발용으로 `web/.env.local`에 `VITE_AI_ENDPOINT=<주소>`를 적습니다.

## 로컬 개발

`cp .dev.vars.example .dev.vars`(PowerShell: `Copy-Item .dev.vars.example .dev.vars`)로 `worker/.dev.vars` 파일(git 제외)을 만들고 키를 적습니다.

```
OPENAI_API_KEY=sk-...
```

```
cd worker
npx wrangler dev
```

기본 주소는 `http://localhost:8787`입니다. 웹에서는 `web/.env.local`에 `VITE_AI_ENDPOINT=http://localhost:8787`을 적고 `npm run dev`로 띄웁니다(`localhost:5173`은 허용 Origin에 들어 있습니다). 서버 테스트는 `npm test`입니다.

## 확인

배포한 주소로 직접 호출해 봅니다.

```
URL=https://happywheel-ai.<sub>.workers.dev
curl -X POST "$URL/weights" -H "Origin: https://yejineeeee.github.io" -H "Content-Type: application/json" -d '{"city":"paris","text":"경사가 힘들어요"}'
```

`weights`, `required_pois`, `explanation`이 든 JSON이 오면 정상입니다. PowerShell에서는 `curl` 대신 `curl.exe`를 쓰고 `$URL` 대신 `$env:URL`을 쓰거나 주소를 그대로 적으세요. JSON 따옴표는 `'{\"city\":...}'`처럼 이스케이프해야 할 수 있습니다.

## 키 교체와 한도 변경

- 키 교체: OpenAI에서 새 키를 만들고 `npx wrangler secret put OPENAI_API_KEY`를 다시 실행한 뒤 이전 키를 폐기합니다. 재배포는 필요 없습니다.
- 횟수·Origin·모델 변경: `wrangler.toml`의 `[vars]`(`DAILY_LIMIT_PER_IP`, `DAILY_LIMIT_TOTAL`, `ALLOWED_ORIGINS`, `OPENAI_MODEL`)를 고치고 `npx wrangler deploy`를 다시 실행합니다. 모델은 `temperature`, `max_tokens`를 받는 것만 쓸 수 있습니다(gpt-5, o 시리즈는 `src/openai.ts`도 함께 고쳐야 합니다).
- 월 예산 변경: OpenAI 대시보드에서 합니다.

## 문제 해결

- 403 `forbidden`: 요청의 Origin이 `ALLOWED_ORIGINS`에 없습니다. 배포 사이트나 개발 서버 주소가 목록에 있는지, 끝에 `/`가 붙지 않았는지 확인하세요. curl로 확인할 때는 `-H "Origin: ..."`을 꼭 넣어야 합니다.
- 429 `rate_limited`: 오늘 IP당 5회 또는 전체 300회를 다 썼습니다. UTC 자정(한국 시간 오전 9시)에 풀립니다. 급하면 `wrangler.toml`의 한도를 올려 다시 배포합니다.
- 502 `upstream`: OpenAI 호출이 실패했거나 시간이 초과됐거나 응답 형식이 맞지 않습니다. 키 유효성, OpenAI 월 한도 소진 여부, 모델 이름을 확인하고 `npx wrangler tail`로 로그를 봅니다.
- 500 `server`: 보통 `OPENAI_API_KEY`가 설정되지 않았습니다. `npx wrangler secret put OPENAI_API_KEY`를 실행하세요.
- 503 `server`: KV 오류입니다. `wrangler.toml`의 LIMITS `id`와 바인딩 이름을 확인하고 `npx wrangler tail`로 로그를 봅니다.
- 400 `bad_request` / `bad_city`: JSON이 아니거나 `city`·`text`가 비었거나, 알 수 없는 도시입니다.
- 413 `too_long`: 문장이 300자를 넘었거나 본문이 4 KB를 넘었습니다.
- 배포 단계에서 KV 오류: `id`를 `REPLACE_WITH_KV_ID` 그대로 두지 않았는지 확인하세요.
