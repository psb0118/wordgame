# 끝말잇기 — AI + 온라인 2인 + 랭킹

## 데이터
서버가 시작할 때 `data/`에서 직접 읽는 파일:
- `word.txt`: 전체 단어 목록 (548,575개)
- `attack.txt`: 공격 단어 및 깊이 (4,098개 단어)
- `끄글_주요 루트 단어_*.txt`: AI 루트 단어
- `끄글_희귀 루트 단어_*.txt`: AI 희귀 루트 단어
- `끄글_방어 단어_*.txt`: AI 방어 단어
- `끄글_돌림 단어_*.txt`: AI 돌림 단어

`끄글_음절 목록_*.txt`, `끄글_필수 공격 단어_*.txt`는 단어 목록을 분석·생성할 때 쓰는 참고 자료이며 서버 런타임에서는 읽지 않습니다.

## 기능
- 끝말잇기 기본 규칙 + 두음법칙
- 랜덤 시작 단어 (공격 단어/한방단어 제외)
- 공격 단어 깊이 표시
- 인간 수준 AI (단일)
- AI 승률/승패/평균 턴 localStorage 저장
- 온라인 2인 방 코드
- Socket.IO 실시간 턴 동기화
- 서버 측 단어/중복/끝 글자/턴 검증
- 우리말샘 Open API로 단어 뜻 조회 (서버 측 API 키 필요)
- 보유 칭호 정렬 (장착 칭호 우선, 나머지 가나다순)
- 하트 시스템 (2개)
- Elo Rating 시스템
- 랭크 등급 (Bronze ~ Challenger)
- PostgreSQL 영구 저장 (JSON 파일 폴백)
- 반응형 모바일/PC UI

## 랭크 등급
| Rating | 등급 |
|--------|------|
| 0~999 | Bronze 5~1 |
| 1000~1399 | Silver 5~1 |
| 1400~1799 | Gold 5~1 |
| 1800~2199 | Platinum 5~1 |
| 2200~2599 | Diamond 5~1 |
| 2600~2999 | Master 5~1 |
| 3000~3399 | Grandmaster 5~1 |
| 3400+ | Challenger |

## Windows 실행
1. Node.js LTS를 설치합니다.
2. 이 폴더에서 명령 프롬프트/PowerShell을 엽니다.
3. `npm install`
4. `npm start`
5. 브라우저에서 `http://localhost:3000` 접속

## Neon PostgreSQL 연결
서버는 기존 `pg` 드라이버로 Neon PostgreSQL에 연결합니다. 별도 Neon Functions나 Data API를 사용하지 않습니다.

1. [Neon Console](https://console.neon.tech/)에서 프로젝트의 **Connect**를 눌러 브랜치, 데이터베이스, 역할을 선택하고 **pooled connection string**을 복사합니다. URL에는 보통 `-pooler`가 포함됩니다.
2. 실행 환경의 비밀 환경 변수에 `DATABASE_URL`을 설정합니다. 연결 문자열은 소스 코드나 GitHub에 커밋하지 마세요.
3. 서버가 시작될 때 `players`, `kv_store` 테이블을 자동 생성/보완합니다.
4. 배포 후 `/api/health`의 `db` 값이 `"postgres"`인지 확인합니다.

### 로컬 개발
Neon CLI로 연결된 브랜치의 데이터베이스 URL을 로컬 `.env.local`로 가져올 수 있습니다. 이 저장소는 `.env.local`을 Git에서 제외합니다.

```bash
npx neon env pull --env DATABASE_URL --file .env.local
npm run dev:neon
```

또는 `.env.local`의 `DATABASE_URL`을 Neon pooled connection string으로 직접 설정하고 `npm start`를 실행해도 됩니다. Neon의 **direct** 연결을 써야 하는 경우가 아니라면 애플리케이션 트래픽에는 pooled URL을 권장합니다.

## 우리말샘 단어 뜻 조회
단어 클릭 시 공식 [우리말샘 Open API](https://opendict.korean.go.kr/service/openApiInfo)를 통해 뜻풀이를 조회합니다. API 키를 발급받아 서버 비밀 환경 변수 `OPENDICT_API_KEY`에 설정하세요. 키는 브라우저에 전달되지 않으며, 정의가 있는 조회는 서버 메모리에 최대 6시간, 빈 결과는 10분 동안 캐시됩니다. 동시 요청은 같은 API 조회를 공유하고, 캐시는 최대 500개를 최근 사용 순으로 유지합니다. 쿼터 보호를 위해 IP당 분당 60회로 요청을 제한하며, 초과 시 `429`와 `Retry-After`를 반환합니다. 우리말샘에 항목이 없는 단어는 직접 검색 링크를 표시합니다.

- 로컬: `.env.local`에 `OPENDICT_API_KEY=발급받은키`를 설정한 뒤 `npm run dev:neon` 실행
- Render: 웹 서비스의 Environment에 `OPENDICT_API_KEY`를 비밀 변수로 추가하고 재배포
- 키 발급과 사용량 제한은 우리말샘 API 안내를 확인하세요.

## Render 배포
1. Build Command는 `npm install`, Start Command는 `npm start`로 설정합니다.
2. 웹 서비스 **Environment**에서 `DATABASE_URL`(Neon pooled connection string)과 `OPENDICT_API_KEY`(우리말샘 발급 키)를 각각 비밀 환경 변수로 설정합니다. API 키를 브라우저 코드나 Git에 넣지 마세요.
3. 저장 후 새 배포가 완료되면 `https://<서비스주소>/api/health`가 HTTP 200이고 `db`가 `"postgres"`인지 확인합니다.
4. `https://<서비스주소>/api/dictionary/definition?word=나무`를 호출해 HTTP 200과 `source: "우리말샘"`, 하나 이상의 `entries`가 반환되는지 확인합니다. `503`이면 API 키 환경 변수 저장과 새 배포 여부를 확인하세요.

## 데이터 저장 (초기화 방지)
서버는 플레이어·시즌·친구·관리자 설정·단어 신청·버그 제보 데이터를 저장합니다.
Render 등 **임시 파일 시스템** 환경에서는 기본 JSON 파일 저장 방식이 재배포/재시작 시 초기화되므로 아래 설정을 사용하세요.

- **`DATABASE_URL` 지정 시 (권장)**: 모든 데이터를 PostgreSQL `players` 테이블과 `kv_store` 테이블에 저장합니다. JSON 파일 저장과 자동 동기화됩니다.
- **`KK_DATA_DIR` 지정 시**: 설정한 디렉터리에 JSON 파일들을 보존합니다. (예: `/app/data`)
- 두 설정이 모두 없으면 기본 JSON 파일(`data/*.json`)에 저장하며, 안정성을 위해 `.bak` 파일이 자동 생성되고 원본 손상 시 복원됩니다.
- 단어·AI 목록 파일(`data/*.txt`)은 git에 포함되어 있어 초기화되지 않습니다.

### Render에서 PostgreSQL 연결하기 (무료)
1. Render 대시보드 → **New** → **PostgreSQL** → 무료 인스턴스 생성.
2. 생성된 DB의 **Internal Database URL**을 복사합니다.
3. Render 대시보드 → 본 **웹 서비스** → **Environment** → **DATABASE_URL**에 붙여넣고 저장(재배포 자동 진행).
4. 재배포 후 `https://<서비스주소>/api/health`를 열어 응답이 `"db":"postgres"`인지 확인합니다.
   - `"db":"json"`으로 나오면 환경변수가 안 들어갔거나 연결이 실패한 것이므로 Render 로그에서 `PostgreSQL 연결 실패` 오류를 확인하세요.
- 이전에 임시 파일 시스템에만 있던 데이터는 복구할 수 없지만, 연결 이후에는 재배포/재시작에도 돈·점수·시즌·친구 등이 유지됩니다.

### 플레이어 데이터 삭제 (운영 도구)
`node tools/purge-player.js <닉네임>`은 삭제 대상을 보고만 하고, `--apply`를 붙이면 JSON 백업 후 players·전적·friends·시즌 등 관련 데이터를 정리합니다. TLS는 시스템 CA로 검증하며 URL의 `sslmode=no-verify`/`disable`은 무시합니다. 사설 CA를 쓰는 DB는 `DATABASE_CA_CERT`에 PEM 문자열이나 인증서 파일 경로를 지정하세요.
