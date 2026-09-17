# 끝말잇기 — AI + 온라인 2인 + 랭킹

## 데이터
- `data/word.txt`: 전체 단어 목록 (548,575개)
- `data/attack.txt`: 공격 단어 및 깊이 (3,595개)

서버가 이 두 파일을 시작할 때 직접 읽습니다.

## 기능
- 끝말잇기 기본 규칙 + 두음법칙
- 랜덤 시작 단어 (공격 단어/한방단어 제외)
- 공격 단어 깊이 표시
- 인간 수준 AI (단일)
- AI 승률/승패/평균 턴 localStorage 저장
- 온라인 2인 방 코드
- Socket.IO 실시간 턴 동기화
- 서버 측 단어/중복/끝 글자/턴 검증
- 하트 시스템 (2개)
- Elo Rating 시스템
- 랭크 등급 (Bronze ~ Challenger)
- PostgreSQL 영구 저장 (JSON 파일 폴백)
- 반응형 모바일/PC UI

## 랭크 등급
| Rating | 등급 |
|--------|------|
| 0~999 | Bronze III~I |
| 1000~1199 | Silver III~I |
| 1200~1399 | Gold III~I |
| 1400~1599 | Platinum III~I |
| 1600~1799 | Diamond III~I |
| 1800~1999 | Master |
| 2000~2199 | Grandmaster |
| 2200+ | Challenger |

## Windows 실행
1. Node.js LTS를 설치합니다.
2. 이 폴더에서 명령 프롬프트/PowerShell을 엽니다.
3. `npm install`
4. `npm start`
5. 브라우저에서 `http://localhost:3000` 접속

## Render 배포
- Start Command: `npm start`
- Build Command: `npm install`
- 환경 변수 `DATABASE_URL`: PostgreSQL 연결 문자열 (선택사항)

## 데이터 저장 (초기화 방지)
서버는 플레이어·시즌·친구·관리자 설정·단어 신청·버그 제보 데이터를 저장합니다.
Render 등 **임시 파일 시스템** 환경에서는 기본 JSON 파일 저장 방식이 재배포/재시작 시 초기화되므로 아래 설정을 사용하세요.

- **`DATABASE_URL` 지정 시 (권장)**: 모든 데이터를 PostgreSQL `players` 테이블과 `kv_store` 테이블에 저장합니다. JSON 파일 저장과 자동 동기화됩니다.
- **`KK_DATA_DIR` 지정 시**: 설정한 디렉터리에 JSON 파일들을 보존합니다. (예: `/app/data`)
- 두 설정이 모두 없으면 기본 JSON 파일(`data/*.json`)에 저장하며, 안정성을 위해 `.bak` 파일이 자동 생성되고 원본 손상 시 복원됩니다.
- 단어 목록(`word.txt`, `attack.txt`)은 git에 포함되어 있어 초기화되지 않습니다.
