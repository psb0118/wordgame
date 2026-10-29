/* 플레이어 전체 삭제 도구 (운영 PostgreSQL)
   사용법:
     DATABASE_URL=<External Database URL> node tools/purge-player.js 정재           # dry-run (보고만)
     DATABASE_URL=<External Database URL> node tools/purge-player.js 정재 --apply   # 백업 후 실제 삭제
     DATABASE_URL=<External Database URL> node tools/purge-player.js --placeholders          # 입력창 안내문이 이름이 된 행 전체
     DATABASE_URL=<External Database URL> node tools/purge-player.js --placeholders --apply  # 위 대상 실제 삭제

   TLS는 기본적으로 시스템 CA로 서버 인증서를 검증한다. URL에 sslmode=no-verify /
   disable이 있어도 무시하고 항상 검증한다. 사설 CA를 쓰는 DB라면
   DATABASE_CA_CERT에 PEM 문자열 또는 인증서 파일 경로를 지정한다.
     DATABASE_CA_CERT=./ca.pem DATABASE_URL=... node tools/purge-player.js 정재

   삭제 대상:
     - players 테이블: id/nickname 정규화 일치 행 + 같은 firebase_uid 행
     - players.recent_games(타 유저 전적)에서 해당 유저와의 경기 기록
     - kv_store: friends / bugReports / adminConfig.watchlist /
                 customWords / customDict / season(champion·top)
   참고: 다른 kv 키에 언급되면 "보고만" 출력 (임의 수정 없음)
*/
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

/* 입력창 안내문이 그대로 계정 이름이 된 행 — 실행할 때마다 손으로 나열하지 않도록 한 번에 처리한다.
   '플레이어'(이름을 정하지 않은 게스트)는 전적이 있을 수 있어 여기 넣지 않는다. */
const PLACEHOLDER_NICKS = [
  "닉네임", "닉네임입력", "닉네임을입력하세요", "이름", "이름입력", "정보", "undefined", "null"
];
const PURGE_PLACEHOLDERS = process.argv.includes("--placeholders");
const rawArg = String(process.argv[2] || "").trim();
const target = rawArg.startsWith("--") ? "" : rawArg;
const APPLY = process.argv.includes("--apply");
const normKey = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
const T = normKey(target);

if (!target && !PURGE_PLACEHOLDERS) {
  console.error("사용법: node tools/purge-player.js <닉네임|--placeholders> [--apply]");
  process.exit(2);
}
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL 환경변수가 없습니다. (Render > DB > External Database URL)"); process.exit(2); }

const deepHas = (v) => {
  if (typeof v === "string") return normKey(v) === T;
  if (Array.isArray(v)) return v.some(deepHas);
  if (v && typeof v === "object") return Object.values(v).some(deepHas);
  return false;
};
const filterArrays = (obj) => {           /* 객체의 모든 배열에서 대상 문자열 값 항목 제거 */
  const out = {};
  let changed = false;
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      const f = v.filter((e) => !deepHas(e));
      if (f.length !== v.length) changed = true;
      out[k] = f;
    } else out[k] = v;
  }
  return { value: out, changed };
};

function resolveSslConfig() {
  const caInput = String(process.env.DATABASE_CA_CERT || process.env.PGSSLROOTCERT || "").trim();
  if (!caInput) return true;   /* 시스템 CA로 검증 (rejectUnauthorized 기본값 true) */
  const ca = caInput.includes("BEGIN CERTIFICATE")
    ? caInput
    : fs.readFileSync(path.resolve(caInput), "utf8");
  return { ca, rejectUnauthorized: true };
}

/* pg는 connectionString의 sslmode를 파싱해 명시한 ssl 설정을 덮어쓴다.
   sslmode=no-verify/disable로 검증을 끄지 못하도록 SSL 관련 쿼리를 제거한다. */
function secureConnectionString(connectionString) {
  try {
    const url = new URL(connectionString);
    for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey", "ssl", "sslnegotiation"]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch (error) {
    return connectionString;   /* Unix 소켓 경로 등 URL이 아닌 형식 */
  }
}

async function main() {
  let ssl;
  try {
    ssl = resolveSslConfig();
  } catch (error) {
    console.error("DATABASE_CA_CERT 인증서를 읽지 못했습니다:", error.message);
    process.exit(2);
  }
  const db = new Client({ connectionString: secureConnectionString(process.env.DATABASE_URL), ssl });
  await db.connect();
  const plan = { players: [], recentScrub: [], kv: {}, kvOtherHits: [] };

  /* 1) players — id/정규화 nickname 일치 */
  const q = `SELECT * FROM players
             WHERE id = $1
                OR regexp_replace(lower(trim(nickname)), '\\s+', '', 'g') = $1`;
  const matched = (await db.query(q, [T])).rows;
  const uids = [...new Set(matched.map((r) => r.firebase_uid).filter(Boolean))];
  let extra = [];
  if (uids.length) {
    extra = (await db.query(
      `SELECT * FROM players WHERE firebase_uid = ANY($1) AND NOT (id = ANY($2))`,
      [uids, matched.map((r) => r.id)]
    )).rows;
  }
  const delRows = [...matched, ...extra.filter((e) => !matched.some((m) => m.id === e.id))];
  plan.players = delRows.map((r) => ({ id: r.id, nickname: r.nickname, firebase_uid: r.firebase_uid || "" }));

  /* 2) 다른 유저 전적 속 해당 유저와의 경기 */
  const rgRows = (await db.query(
    `SELECT id, recent_games FROM players WHERE recent_games LIKE '%' || $1 || '%'`, [target]
  )).rows;
  for (const r of rgRows) {
    let arr = [];
    try { arr = JSON.parse(r.recent_games || "[]"); } catch { continue; }
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const f = arr.filter((g) => !deepHas(g));
    if (f.length !== arr.length) plan.recentScrub.push({ id: r.id, removed: arr.length - f.length, next: f });
  }

  /* 3) kv_store 전체 스캔 */
  const kvRows = (await db.query(`SELECT key, value FROM kv_store`)).rows;
  const kvMap = new Map(kvRows.map((r) => [r.key, r.value]));
  const parsed = (k) => { try { return JSON.parse(kvMap.get(k) ?? "null"); } catch { return null; } };

  /* friends */
  const friends = parsed("friends");
  if (friends && typeof friends === "object") {
    const out = {};
    for (const [k, arr] of Object.entries(friends)) {
      if (k === "_requests") {
        const f = (arr || []).filter(([a, b]) => normKey(a) !== T && normKey(b) !== T);
        if (f.length) out[k] = f;
      } else if (normKey(k) !== T) {
        const f = (Array.isArray(arr) ? arr : []).filter((x) => normKey(x) !== T);
        if (f.length) out[k] = f;
      }
    }
    if (JSON.stringify(out) !== JSON.stringify(friends)) plan.kv.friends = out;
  }
  /* bugReports / adminConfig / customWords / customDict — 배열 필터 */
  for (const key of ["bugReports", "customWords", "customDict"]) {
    const v = parsed(key);
    if (v && typeof v === "object") {
      if (Array.isArray(v)) {
        const f = v.filter((e) => !deepHas(e));
        if (f.length !== v.length) plan.kv[key] = f;
      } else {
        const { value, changed } = filterArrays(v);
        if (changed) plan.kv[key] = value;
      }
    }
  }
  const adminCfg = parsed("adminConfig");
  if (adminCfg && typeof adminCfg === "object" && Array.isArray(adminCfg.watchlist)) {
    const f = adminCfg.watchlist.filter((w) => normKey(w) !== T);
    if (f.length !== adminCfg.watchlist.length) plan.kv.adminConfig = { ...adminCfg, watchlist: f };
  }
  /* season — champion 널화 + top 항목 제거(시즌 기록 자체는 유지) */
  const season = parsed("season");
  if (season && typeof season === "object" && Array.isArray(season.history)) {
    let changed = false;
    const hist = season.history.map((h) => {
      const c = { ...h };
      if (typeof c.champion === "string" && normKey(c.champion) === T) { c.champion = null; changed = true; }
      if (Array.isArray(c.top)) {
        const f = c.top.filter((t) => !deepHas(t));
        if (f.length !== c.top.length) { c.top = f; changed = true; }
      }
      return c;
    });
    if (changed) plan.kv.season = { ...season, history: hist };
  }
  /* 처리하지 않는 다른 kv 키 — 보고만 */
  const HANDLED = new Set(["friends", "bugReports", "adminConfig", "customWords", "customDict", "season"]);
  for (const r of kvRows) {
    if (HANDLED.has(r.key)) continue;
    let v = null; try { v = JSON.parse(r.value ?? "null"); } catch { v = null; }
    if (v !== null && deepHas(v)) plan.kvOtherHits.push(r.key);
  }

  /* 결과 출력 */
  console.log(`\n=== 대상: '${target}' (normKey='${T}') | 모드: ${APPLY ? "APPLY" : "DRY-RUN"} ===`);
  console.log(`players 삭제 후보: ${plan.players.length}건`);
  plan.players.forEach((p) => console.log(`   - id=${p.id} nickname=${p.nickname} uid=${p.firebase_uid || "-"}`));
  console.log(`타 유저 전적에서 경기 기록 제거: ${plan.recentScrub.length}명 (총 ${plan.recentScrub.reduce((s, x) => s + x.removed, 0)}건)`);
  plan.recentScrub.forEach((p) => console.log(`   - ${p.id}: ${p.removed}건`));
  console.log(`kv_store 수정: ${Object.keys(plan.kv).map((k) => `${k}(${APPLY ? "수정" : "수정예정"})`).join(", ") || "없음"}`);
  for (const [k, v] of Object.entries(plan.kv)) console.log(`   - ${k}: ${JSON.stringify(v).length} bytes`);
  if (plan.kvOtherHits.length) console.log(`⚠ 처리 대상 외 kv 키에 언급(보고만): ${plan.kvOtherHits.join(", ")}`);

  const nothing = plan.players.length === 0 && plan.recentScrub.length === 0 &&
    Object.keys(plan.kv).length === 0 && plan.kvOtherHits.length === 0;
  if (nothing) { console.log("\n삭제할 데이터가 없습니다."); await db.end(); return; }

  if (!APPLY) {
    console.log("\n[DRY-RUN] 변경 없음. 실제 삭제는 --apply 를 붙여 실행하세요.");
    await db.end(); return;
  }

  /* 백업 먼저 */
  const backup = { target, normKey: T, at: new Date().toISOString(), plan };
  const bPath = path.join(__dirname, "..", `purge-backup-${Date.now()}.json`);
  fs.writeFileSync(bPath, JSON.stringify(backup, null, 2));
  console.log(`\n백업 저장: ${bPath}`);

  /* 적용 */
  await db.query("BEGIN");
  try {
    for (const p of plan.players) await db.query(`DELETE FROM players WHERE id = $1`, [p.id]);
    const purgeIds = plan.players.map((p) => p.id);
    if (purgeIds.length) {
      await db.query(`DELETE FROM economy_ledger WHERE account_id = ANY($1)`, [purgeIds]);
    }
    for (const p of plan.recentScrub) {
      await db.query(`UPDATE players SET recent_games = $2, updated_at = NOW() WHERE id = $1`,
        [p.id, JSON.stringify(p.next)]);
    }
    for (const [key, value] of Object.entries(plan.kv)) {
      await db.query(
        `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, JSON.stringify(value)]
      );
    }
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    console.error("실패(롤백):", e.message);
    await db.end(); process.exit(1);
  }

  /* 검증 */
  const leftPlayers = (await db.query(q, [T])).rows;
  const leftUid = uids.length
    ? (await db.query(`SELECT id FROM players WHERE firebase_uid = ANY($1)`, [uids])).rows : [];
  const leftRg = (await db.query(`SELECT id, recent_games FROM players WHERE recent_games LIKE '%' || $1 || '%'`, [target]))
    .rows.filter((r) => { try { return deepHas(JSON.parse(r.recent_games || "[]")); } catch { return false; } });
  const leftKv = (await db.query(`SELECT key, value FROM kv_store`)).rows
    .filter((r) => { let v = null; try { v = JSON.parse(r.value ?? "null"); } catch {} return v !== null && deepHas(v); })
    .filter((r) => !plan.kvOtherHits.includes(r.key));
  console.log(`\n검증: players 남음=${leftPlayers.length}, uid행 남음=${leftUid.length}, 전적 언급 남음=${leftRg.length}, kv 남음=${leftKv.length}`);
  console.log(leftPlayers.length + leftUid.length + leftRg.length + leftKv.length === 0
    ? "✔ 완료 — 남은 데이터 없음 (서버 캐시 초기화를 위해 Render 서비스를 Restart하세요)"
    : "⚠ 남은 데이터 존재 — 출력 확인 필요");
  await db.end();
}

/* --placeholders — DB에서 대상 행을 찾아 이름마다 기존 삭제 절차를 그대로 실행한다.
   실제 계정(firebase_uid)이 붙은 행은 건드리지 않는다. */
async function purgePlaceholders() {
  let ssl;
  try {
    ssl = resolveSslConfig();
  } catch (error) {
    console.error("DATABASE_CA_CERT 인증서를 읽지 못했습니다:", error.message);
    process.exit(2);
  }
  const db = new Client({ connectionString: secureConnectionString(process.env.DATABASE_URL), ssl });
  await db.connect();
  let rows;
  try {
    rows = (await db.query("SELECT id, nickname, firebase_uid FROM players")).rows;
  } finally {
    await db.end();
  }

  const names = [];
  const skipped = [];
  for (const row of rows) {
    const key = normKey(row.nickname);
    if (!PLACEHOLDER_NICKS.includes(key)) continue;
    if (String(row.firebase_uid || "").trim()) { skipped.push(`${row.nickname}(uid)`); continue; }
    if (names.includes(row.nickname)) continue;
    names.push(row.nickname);
  }

  console.log(`\nplaceholder 행: ${names.length}개 ${names.length ? "→ " + names.join(", ") : ""}`);
  if (skipped.length) console.log(`건너뜀(로그인 계정에 연결됨): ${skipped.join(", ")}`);
  if (!names.length) { console.log("삭제할 placeholder 행이 없습니다."); return; }

  const { spawnSync } = require("child_process");
  for (const name of names) {
    console.log(`\n### '${name}' ${APPLY ? "삭제" : "확인"}`);
    const args = [__filename, name].concat(APPLY ? ["--apply"] : []);
    const res = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
    if (res.status !== 0) {
      console.error(`'${name}' 처리 실패 (exit ${res.status})`);
      process.exitCode = 1;
    }
  }
  if (!APPLY) console.log("\n[DRY-RUN] 실제 삭제는 --apply 를 붙여 다시 실행하세요.");
}

(PURGE_PLACEHOLDERS ? purgePlaceholders : main)
  .catch((e) => { console.error("오류:", e.message); process.exit(1); });
