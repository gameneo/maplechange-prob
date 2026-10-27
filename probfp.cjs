// C15a·C15c 확률표 지문 공개 검증 — 게임 Prob/ProbLogic.Build()와 같은 정규 문자열을 CSV에서 다시 만들고 SHA-256을 낸다.
//   node probfp.cjs                 → 지문 + 줄 수 (게임 저장소 안에서는 RootDesk 표, 공개 저장소에서는 ./tables 표를 읽음)
//   node probfp.cjs --text          → 정규 문자열 전체(무엇이 해시되는지 그대로)
//   node probfp.cjs --scroll        → 주문서 지문 정규 문자열(게임 [확률 공시] 창 아래 두 줄 = scroll sha256)
//   node probfp.cjs --dir <폴더>     → 그 폴더의 ScrollTable.csv · PetScrollTable.csv · GameConfig.csv · GuildConfig.csv · DropTable.csv · BossTable.csv · BossDiffTable.csv · SlotStarTable.csv · MyHuntDropTable.csv · MobSpecTable.csv(나만의 사냥터 단계 몹 HP — hunt200 줄만) 로
//   node probfp.cjs --test          → 테스트 월드 보기(dev=1 보스도 넣음, test_* 시험 보스 빼고 — 테스트 월드 서버 [TAG:prob.fp] · 메이커 [TAG:prob.boss_h]와 같은 값)
// 지문 두 개: 전체(mc-prob-v4 — 주문서·드롭·보스·슬롯 강화·나만의 사냥터, 서버 로그 [TAG:prob.fp]) · 주문서(mc-prob-scroll-v3 — S 줄 + 슬롯 강화 T 줄 + 귀한 드롭 M|rare 줄, 게임 창에 보이는 값).
//   rp-slot-grow-prob(D188 · 오너 장부 2270 "당연히 슬롯강화는 확률검증할수있어야됨"): 새 줄 종류 T = 슬롯 강화 별마다(v2 → v3 · scroll v1 → v2)
//     T|<별 n>|<성공 기준 1~10000 중 이하>|<실패하면 별>|<n성 시도 비용>|<n성 돌려받기> — 비용 = 10만 × 2^(n-1) · 돌려받기 = n × 2ⁿ × 10만(SlotGrowLogic.CostOf·RefundOf 식)
//     · 별 수 = min(GameConfig slotMaxStar(없으면 20), SlotStarTable 줄 수) · 성공 기준 = min(GameConfig slotRateBp(없으면 5000), 5000)(SlotGrowLogic.MaxStar·RateBp와 같음)
//   rp-hr-myhunt-drop(highrate plan §4-8): 새 줄 종류 M = 나만의 사냥터 고를 수 있는 드롭 줄(v3 → v4 · 주문서 지문 그대로)
//     M|<kind>|<아이템 id>|<실효 ppm>|<고르는 개수> — MyHuntDropTable 줄마다 · 실효 = D 줄과 같은 식 · kind = eq(장비 3 고름) · sc10·sc60·sc100(성공률마다 1) · pot(공통 · 0 = 늘)
//   rp-bossreset-drop(D191 ⑤ · 장부 2385 · 승인 문구 wording ②-9): MyHuntDropTable kind rare = 보스 보상 초기화권(고르기 없이 모든 나만의 사냥터 · M|rare|…|0) —
//     게임 창 [주문서] 탭 끝 줄로 보이므로 주문서 지문에도 넣음(scroll v2 → v3 · 전체 v4 그대로 — 줄 모양 같음)
//   rp-prob-myhunt-tier-1025(장부 5950): 나만의 사냥터 1·2단계 = 모든 M 줄 확률 × 단계 배율(그 단계 몹 HP ÷ 3단계 몹 HP · MobSpecTable.csv hunt200·hunt200t1·hunt200t2 hp)
//     C|myhuntTierDrop<단계>|<배율 ×1000> (전체만) · M|rare_t<단계>|<아이템>|<ppm>|0 (전체 + 주문서 — 창 단계별 줄 · ppm = rate × 배율 ÷ 1000 × dropRate) · 줄 모양 같아 버전 그대로
//   rp-prob-nodrop(오너 2026-09-30): 게임 창 = 주문서·캐시 확률만, 몬스터·보스 드롭 확률은 길라잡이에 → 드롭 줄은 전체 지문(이 저장소)에만.
// 규칙 = Docs/research/prob/spec.md.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VERSION_BASE = "mc-prob-v4";
const SCROLL_VERSION_BASE = "mc-prob-scroll-v3";
let VERSION = VERSION_BASE;
let SCROLL_VERSION = SCROLL_VERSION_BASE;
const argDir = process.argv.indexOf("--dir") >= 0 ? process.argv[process.argv.indexOf("--dir") + 1] : null;
const GAME = path.join(__dirname, "..", "..", "..");
const LOCAL = path.join(__dirname, "tables");
// 표 위치: --dir > 이 파일 옆 tables/(공개 저장소) > 게임 저장소
const SRC = {
  ScrollTable: "RootDesk/MyDesk/Enhance/ScrollTable.csv",
  GameConfig: "RootDesk/MyDesk/Data/GameConfig.csv",
  GuildConfig: "RootDesk/MyDesk/Guild/GuildConfig.csv",
  DropTable: "RootDesk/MyDesk/Data/DropTable.csv",
  BossTable: "RootDesk/MyDesk/Hunt/BossTable.csv",
  BossDiffTable: "RootDesk/MyDesk/Boss/BossDiffTable.csv",
  SlotStarTable: "RootDesk/MyDesk/Data/SlotStarTable.csv",
  MyHuntDropTable: "RootDesk/MyDesk/MyHunt/MyHuntDropTable.csv",
  PetScrollTable: "RootDesk/MyDesk/Pet/PetScrollTable.csv",
  MobSpecTable: "RootDesk/MyDesk/MobSpec/MobSpecTable.csv",
};
const testView = process.argv.includes("--test");
function tablePath(name) {
  if (argDir && fs.existsSync(path.join(argDir, name + ".csv"))) return path.join(argDir, name + ".csv");
  if (argDir) return path.join(argDir, name + ".csv");
  if (fs.existsSync(path.join(LOCAL, name + ".csv"))) return path.join(LOCAL, name + ".csv");
  return path.join(GAME, SRC[name]);
}

// CSV 한 줄 → 칸(큰따옴표 안의 쉼표·"" 처리)
function split(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function csv(name) {
  const p = tablePath(name);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l !== "");
  const head = split(lines[0]);
  return lines.slice(1).map((l) => {
    const c = split(l);
    const o = {};
    head.forEach((h, i) => (o[h] = c[i] === undefined ? "" : c[i]));
    return o;
  });
}
const num = (v) => {
  const n = Number(v);
  return v === "" || v === undefined || !Number.isFinite(n) ? 0 : n;
};
const ppm = (p) => Math.floor(Math.max(0, Math.min(1, p)) * 1000000 + 0.5);

function build() {
  const rows = [];
  const srows = [];
  // 주문서 — EnhanceLogic.Load: success/destroy = floor(number) · base가 다른 줄 id면 그 줄 값을 복사
  //   파괴율 뜻 = ScrollTable kind대로: dark(어둠) = 실패했을 때 nonce + "-d"로 한 번 더 굴려 roll ≤ 파괴율×100이면 파괴 ·
  //   white(백의) = 같은 굴림 한 번에서 성공(roll ≤ 성공률×100) 다음 구간 roll ≤ (성공률 + 파괴율)×100이면 파괴, 나머지 = 아무 일 없음
  // GameConfig(첫 칸 = 키, 둘째 칸 = 값) — 드롭 배율 + H4 나중 BM 카드 스위치(BmCardLogic · 기본 꺼짐 = 키가 없거나 0 = 표 값 그대로)
  const cfg = {};
  for (const r of csv("GameConfig")) {
    const k = Object.keys(r);
    cfg[r[k[0]]] = r[k[1]];
  }
  const cardOn = (key) => Math.floor(num(cfg[key])) === 1;
  const cfgStr = (key, def) => (cfg[key] === undefined || cfg[key] === "" ? def : cfg[key]);
  const sc = {};
  for (const r of csv("ScrollTable")) sc[r.id] = { success: Math.floor(num(r.success)), destroy: Math.floor(num(r.destroy)), base: r.base || "", kind: r.kind || "" };
  const eff = {};
  for (const [id, s] of Object.entries(sc)) {
    const v = (s.base !== "" && sc[s.base]) || s;
    let destroy = v.destroy;
    // 백의 파괴 확률 내리기(whiteDownOn) — EnhanceLogic.CardRows/BmCardLogic.WhiteDestroy: 백의 줄(캐시 복사 포함) 파괴율 = min(표 값, whiteDownPct)
    if (cardOn("whiteDownOn") && v.kind === "white" && destroy > 0) destroy = Math.min(destroy, Math.max(0, Math.floor(num(cfgStr("whiteDownPct", String(destroy))))));
    eff[id] = { success: v.success, destroy };
  }
  // 파괴 없는 백의(whiteSafeOn) — 표에 그 id 줄이 없으면 sc_white와 같은 성공률 · 파괴 0 줄을 더함
  const safeId = cfgStr("whiteSafeId", "cash_white_nobreak");
  if (cardOn("whiteSafeOn") && !eff[safeId] && sc.sc_white) eff[safeId] = { success: sc.sc_white.success, destroy: 0 };
  for (const [id, v] of Object.entries(eff)) {
    rows.push(`S|${id}|${v.success}|${v.destroy}`);
    srows.push(`S|${id}|${v.success}|${v.destroy}`);
  }
  // 펫 장비 주문서(PetScrollTable · 드롭 · rp-q429-prob-petscroll 오너 장부 3571) = 같은 S 줄 꼴 · 파괴 0(PetGearLogic.RunScroll — 실패 = 횟수만 줄어듦) · 줄 모양 같아 버전 그대로
  for (const r of csv("PetScrollTable")) {
    if (!r.id) continue;
    rows.push(`S|${r.id}|${Math.floor(num(r.success))}|0`);
    srows.push(`S|${r.id}|${Math.floor(num(r.success))}|0`);
  }
  // 드롭 — DropTable × dropRate
  const mul = cfg.dropRate === undefined ? 1 : num(cfg.dropRate);
  rows.push(`C|dropRate|${Math.floor(mul * 1000 + 0.5)}`);
  // 길드 축복 드롭 +x%(켠 사람만 — 표 값엔 안 곱하고 줄로만, ProbLogic과 같이) · GuildConfig blessing.drop, 없으면 5
  let gb = 5;
  for (const r of csv("GuildConfig")) if (r.key === "blessing.drop" && r.value !== "" && Number.isFinite(Number(r.value))) gb = Number(r.value);
  rows.push(`C|guildBlessDrop|${Math.floor(gb * 1000 + 0.5)}`);
  for (const r of csv("DropTable")) {
    if (!r.monster || !r.itemId) continue;
    rows.push(`D|${r.monster}|${r.itemId}|${ppm(num(r.rate) * mul)}`);
  }
  // 나만의 사냥터(v4) — MyHuntDropTable 줄마다 M|kind|아이템|ppm|고르는 개수(MyHuntDrop.Load와 같이: kind·아이템 빈 줄 · 같은 id 두 번째 줄 뺌 ·
  //   그 kind 첫 줄의 pick = 그 kind 개수) · 실효 = D 줄과 같은 식(× dropRate) · 규칙 밖 줄은 tools/dropgen/myhunt.cjs --check가 표에서 막음
  // 나만의 사냥터 1~3단계(rp-prob-myhunt-tier-1025) — 1·2단계 복제 = 모든 M 줄 확률 × 단계 배율(MyHuntLogic.DropMulOf = 그 단계 몹 HP ÷ 3단계 몹 HP ·
  //   MobSpecTable hunt200t1·hunt200t2 ÷ hunt200) → C|myhuntTierDrop<단계>|<배율 ×1000 반올림> · 단계 줄이 없거나 배율 1 이상 = 그 단계 줄 없음(게임도 곱하지 않음)
  const specHp = {};
  for (const r of csv("MobSpecTable")) if (r.id) specHp[r.id] = num(r.hp);
  const tiers = [];
  for (const t of [1, 2]) {
    const base = specHp.hunt200;
    const hp = specHp["hunt200t" + t];
    if (!(base > 0) || hp === undefined) continue;
    const m = Math.floor(Math.max(0, Math.min(1, hp / base)) * 1000 + 0.5);
    if (m > 0 && m < 1000) tiers.push({ t, m });
  }
  for (const tm of tiers) rows.push(`C|myhuntTierDrop${tm.t}|${tm.m}`);
  const mhPick = {};
  const mhSeen = new Set();
  for (const r of csv("MyHuntDropTable")) {
    if (!r.kind || !r.itemId || mhSeen.has(r.itemId)) continue;
    mhSeen.add(r.itemId);
    if (mhPick[r.kind] === undefined) mhPick[r.kind] = Math.floor(num(r.pick));
    const line = `M|${r.kind}|${r.itemId}|${ppm(num(r.rate) * mul)}|${mhPick[r.kind]}`;
    rows.push(line);
    if (r.kind === "rare") srows.push(line);
    // 귀한 드롭 단계 줄(아래 tiers) — 1·2단계 복제 = 확률 × 단계 배율 · 창 [주문서] 탭 끝 단계별 줄이라 주문서 지문에도
    if (r.kind === "rare") {
      for (const tm of tiers) {
        const tl = `M|rare_t${tm.t}|${r.itemId}|${ppm(num(r.rate) * tm.m / 1000 * mul)}|0`;
        rows.push(tl);
        srows.push(tl);
      }
    }
  }
  // 보스 보상(v2) — 보스 처치 굴림이 읽는 표(BossLogic.RowD) "아이템:수량:확률%"(확률 없으면 100) · 배율 없음
  //   NORMAL = B|<id>|… : BossDiffTable N 줄 rewards, 비면 BossTable rewards
  //   HARD   = B|<id>_h|… : BossDiffTable H 줄이 있는 보스만 — 그 줄 rewards, 비면 BossTable rewards (rp-prob-boss-hard · 줄 모양 그대로라 v2)
  //   dev=1(아직 안 연 보스) 제외 · --test = 테스트 월드 보기(dev=1도 넣음, test_* 빼고 — BossLogic.DevWhy "test")
  //   H4 120제 장갑·장신구 보스 드롭 상향(bossAccUpOn) — BmCardLogic.BossRate: bossAccUpIds 안의 id = min(100, 확률 × bossAccUpX(1 미만 = 1))
  const accIds = new Set(cfgStr("bossAccUpIds", "").split("|").filter(Boolean));
  const accX = Math.max(1, cfg.bossAccUpX === undefined || cfg.bossAccUpX === "" ? 1 : num(cfg.bossAccUpX));
  const diffs = {};
  for (const r of csv("BossDiffTable")) {
    const d = (r.diff || "").toUpperCase();
    if (r.boss && (d === "N" || d === "H")) (diffs[r.boss] = diffs[r.boss] || {})[d] = r;
  }
  const bossOpen = (r) => r.dev !== "1" || (testView && !r.id.startsWith("test_"));
  for (const r of csv("BossTable")) {
    if (!r.id || !bossOpen(r)) continue;
    const per = diffs[r.id] || {};
    const sets = [[r.id, per.N && per.N.rewards ? per.N.rewards : r.rewards]];
    if (per.H) sets.push([r.id + "_h", per.H.rewards ? per.H.rewards : r.rewards]);
    for (const [key, rewards] of sets) {
      for (const part of (rewards || "").split("|").filter(Boolean)) {
        const m = /^([^:]+):?(\d*):?([\d.]*)$/.exec(part);
        if (!m) continue;
        let rate = m[3] === "" ? 100 : num(m[3]);
        if (cardOn("bossAccUpOn") && accIds.has(m[1])) rate = Math.min(100, rate * accX);
        rows.push(`B|${key}|${m[1]}|${ppm(rate / 100)}`);
      }
    }
  }
  // 슬롯 강화(v3) — SlotGrowLogic: n성 시도 = roll ≤ 성공 기준이면 n성 · 아니면 0성 · 비용·돌려받기 = 식(표 값이 식과 다르면 게임은 식 값 + 오류 로그 → 여기도 식 값 + 경고)
  const slotRows = csv("SlotStarTable");
  let slotRead = 0;
  for (const r of slotRows) {
    if (Math.floor(num(r.star)) !== slotRead + 1) break;
    slotRead++;
  }
  const slotMax = Math.max(0, Math.min(Math.floor(num(cfgStr("slotMaxStar", "20"))), slotRead));
  const slotBp = Math.min(Math.floor(num(cfgStr("slotRateBp", "5000"))), 5000);
  for (let n = 1; n <= slotMax; n++) {
    const cost = 100000 * 2 ** (n - 1);
    const refund = n * 2 ** n * 100000;
    const r = slotRows[n - 1];
    if (Math.floor(num(r.cost)) !== cost || Math.floor(num(r.refund)) !== refund) console.error(`⚠ SlotStarTable ${n}성 cost=${r.cost} refund=${r.refund} ≠ 식 ${cost}·${refund} (게임 = 식 값)`);
    const line = `T|${n}|${slotBp}|0|${cost}|${refund}`;
    rows.push(line);
    srows.push(line);
  }
  // Lua table.sort(문자열) = 바이트 순
  const byte = (a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  rows.sort(byte);
  srows.sort(byte);
  const text = VERSION + "\n" + rows.join("\n");
  const stext = SCROLL_VERSION + "\n" + srows.join("\n");
  const sha = (t) => crypto.createHash("sha256").update(t, "utf8").digest("hex");
  return { rows, text, sha: sha(text), scroll: { rows: srows, text: stext, sha: sha(stext) } };
}

if (require.main === module) {
  const r = build();
  if (process.argv.includes("--text")) process.stdout.write(r.text + "\n");
  if (process.argv.includes("--scroll")) process.stdout.write(r.scroll.text + "\n");
  console.log(`${VERSION} lines=${r.rows.length} bytes=${Buffer.byteLength(r.text)} sha256=${r.sha}`);
  console.log(`${SCROLL_VERSION} lines=${r.scroll.rows.length} bytes=${Buffer.byteLength(r.scroll.text)} sha256=${r.scroll.sha}  ← 게임 [확률 공시] 창 아래 두 줄`);
}
module.exports = { build, VERSION: VERSION_BASE, SCROLL_VERSION: SCROLL_VERSION_BASE };
