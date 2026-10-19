#!/usr/bin/env node
// [B8] FairRng 공개 검증 스크립트 — 게임(RootDesk/MyDesk/Lib/FairRngLogic.mlua)과 같은 유도식.
//   결과 해시 = SHA256(seed + ":" + nonce)  (seed = 64 hex 소문자, nonce = 문자열 그대로, UTF-8)
//   value    = 결과 해시 앞 8 hex → 32비트 정수
//   roll     = floor(value * 10000 / 2^32) + 1   (1..10000)
//   성공     = roll <= round(성공률% * 100)        (예: 60% → roll <= 6000)
//   백의 파괴 = 성공 아님 + roll <= round((성공률% + 파괴율%) * 100)  (예: 10% · 10% → 1001~2000 = 파괴, 2001~ = 아무 일 없음 — 같은 굴림 한 번)
//   어둠 파괴 = nonce 뒤에 "-d"를 붙여 한 번 더: roll <= round(파괴율% * 100)  (--nonce <nonce>-d --rate <파괴율%>)
//   seedHash = SHA256(seed)  — 강화 전에 먼저 받은 값과 같아야 서버가 seed를 바꾸지 않은 것.
//
// 사용:
//   node tools/crypto/verify.cjs --seed <64hex> --nonce <문자열> [--hash <seedHash>] [--rate <성공률%>] [--destroy <백의 파괴율%>]
//   node tools/crypto/verify.cjs --vectors     (게임 DevSelfTest가 쓰는 기대값 출력)
//
// 보스 보상 굴림(--boss · Docs/research/transparency/boss-commit/README.md) — 게임 FairRngLogic.PpmRoll · 서버 server/transparency/bossfair.py와 같은 식.
//   원장 metrics boss_end 처치 줄(fm commit)의 seed · seedHash · nonce · rl 칸을 그대로 넣는다.
//   줄 i(1부터) 굴림 = floor(앞 8 hex of SHA256(seed + ":" + nonce + ":" + i) * 1000000 / 2^32) + 1 (1..1000000) · 나옴 = 굴림 <= ppm(확률 공시 보스 줄 값)
//   nonce = 파티원 nonce를 입장 순서대로 "." 이음(안 낸 사람 = 빈칸) — 내 nonce가 들어 있는지도 볼 것 · seedHash = 보스 시작 때 받은 값과 같아야 함.
//   node tools/crypto/verify.cjs --boss --seed <seed> --nonce "<nonce>" --rl "<rl>" [--hash <seedHash>]
//   node tools/crypto/verify.cjs --boss --vectors   (게임 DevBossCommitTest ① · test_bossfair.py와 같은 값)
//   시험 = node tools/crypto/boss_test.cjs (벡터 = tools/crypto/boss_vectors.json)
// 종료 코드: 0 = 전부 맞음 · 1 = 사용법 · 2 = 어긋남
'use strict';
const crypto = require('crypto');

const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

function derive(seed, nonce) {
  const hash = sha(seed + ':' + nonce);
  const value = parseInt(hash.slice(0, 8), 16);
  const roll = Math.floor((value * 10000) / 4294967296) + 1;
  return { seedHash: sha(seed), hash, value, roll };
}

function bossRoll(seed, nonce, i) {
  const value = parseInt(sha(seed + ':' + nonce + ':' + i).slice(0, 8), 16);
  return Math.floor((value * 1000000) / 4294967296) + 1;
}

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// 보스 보상 굴림 검증 — 종료 코드를 돌려줌(Docs/research/transparency/boss-commit/bossverify.cjs도 이 함수를 부름)
function bossMain(usage) {
  if (process.argv.includes('--vectors')) {
    const f = '0'.repeat(63) + '1';
    console.log(JSON.stringify({ seedHash: sha(f), abcdef: [1, 2, 3].map((i) => bossRoll(f, 'abc.def', i)), dotx: bossRoll(f, '.x', 1) }));
    return 0;
  }
  const s = (arg('seed') || '').toLowerCase();
  const n = arg('nonce');
  const rl = arg('rl') || '';
  if (!s || n === undefined) {
    console.log('사용: ' + usage + ' --seed <seed> --nonce "<nonce>" --rl "<rl>" [--hash <seedHash>]');
    return 1;
  }
  let bad = false;
  console.log('seedHash = ' + sha(s));
  const h = arg('hash');
  if (h) {
    const same = h.toLowerCase() === sha(s);
    console.log('seedHash 일치 = ' + (same ? '예' : '아니오 (보스 시작 때 받은 값과 다름!)'));
    if (!same) bad = true;
  }
  rl.split('|').filter(Boolean).forEach((t, k) => {
    const m = /^([^:]+):(\d+):(\d+):(\d+):([01])$/.exec(t);
    if (!m) {
      console.log(`${k + 1}. 모양 틀림: ${t}`);
      bad = true;
      return;
    }
    const roll = bossRoll(s, n, k + 1);
    const ppm = Number(m[3]);
    const hit = roll <= ppm;
    const ok = roll === Number(m[4]) && hit === (m[5] === '1');
    if (!ok) bad = true;
    console.log(`${k + 1}. ${m[1]} ×${m[2]} 확률 ${(ppm / 10000).toFixed(4)}% · 굴림 ${roll} / 1000000 → ${hit ? '나옴' : '안 나옴'} · 원장 ${m[4]}/${m[5]} ${ok ? '맞음' : '다름!'}`);
  });
  console.log(bad ? '결과: 어긋남' : '결과: 전부 맞음');
  return bad ? 2 : 0;
}

module.exports = { sha, derive, bossRoll, bossMain };
if (require.main !== module) return;
if (process.argv.includes('--help')) {
  console.log('주문서 강화 굴림: node tools/crypto/verify.cjs --seed <64hex> --nonce <문자열> [--hash <seedHash>] [--rate <성공률%>] [--destroy <백의 파괴율%>]');
  console.log('보스 보상 굴림: node tools/crypto/verify.cjs --boss --seed <seed> --nonce "<nonce>" --rl "<rl>" [--hash <보스 시작 때 받은 seedHash>]');
  console.log('  원장 보스 처치 줄의 seed · seedHash · nonce · rl 칸을 그대로 넣습니다. 줄마다 굴림 · 나옴 · 원장 값이 맞는지 보여 줍니다.');
  console.log('  nonce = 파티원 nonce를 입장 순서대로 "."으로 이은 값입니다(내지 않은 사람 = 빈칸). 내 nonce가 들어 있는지도 확인하세요.');
  console.log('기대값 출력: --vectors (주문서) · --boss --vectors (보스 보상)');
  console.log('종료 코드: 0 = 전부 맞음 · 1 = 사용법 · 2 = 어긋남');
  process.exit(0);
}
if (process.argv.includes('--boss')) process.exit(bossMain('node tools/crypto/verify.cjs --boss'));

if (process.argv.includes('--vectors')) {
  const v = {
    empty: sha(''),
    abc: sha('abc'),
    b448: sha('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    b896: sha('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'),
    a55: sha('a'.repeat(55)),
    a56: sha('a'.repeat(56)),
    a64: sha('a'.repeat(64)),
    a1000: sha('a'.repeat(1000)),
    korean: sha('메이플체인지 주문서 60%'),
    million: sha('a'.repeat(1000000)),
    fair: derive('0'.repeat(63) + '1', 'nonce-1'),
  };
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
}

const seed = arg('seed');
const nonce = arg('nonce');
if (!seed || nonce === undefined) {
  console.log('사용: node tools/crypto/verify.cjs --seed <64hex> --nonce <문자열> [--hash <seedHash>] [--rate <성공률%>] [--destroy <백의 파괴율%>]');
  console.log('보스 보상 굴림: node tools/crypto/verify.cjs --boss --seed <seed> --nonce "<nonce>" --rl "<rl>" [--hash <보스 시작 때 받은 seedHash>]');
  process.exit(1);
}
const r = derive(seed.toLowerCase(), nonce);
console.log('seedHash = ' + r.seedHash);
console.log('hash     = ' + r.hash);
console.log('value    = ' + r.value);
console.log('roll     = ' + r.roll + ' / 10000');
let bad = false;
const h = arg('hash');
if (h) {
  const same = h.toLowerCase() === r.seedHash;
  console.log('seedHash 일치 = ' + (same ? '예' : '아니오 (서버가 먼저 보여 준 값과 다름!)'));
  if (!same) bad = true;
}
const rate = arg('rate');
if (rate !== undefined) {
  const need = Math.round(Number(rate) * 100);
  console.log('성공률 ' + rate + '% → roll <= ' + need + ' → ' + (r.roll <= need ? '성공' : '실패'));
  // 백의 주문서(rp-white-destroy): 같은 roll의 성공 다음 구간 = 장비 파괴, 그 위 = 아무 일 없음
  const destroy = arg('destroy');
  if (destroy !== undefined && r.roll > need) {
    const top = need + Math.round(Number(destroy) * 100);
    console.log('백의 파괴율 ' + destroy + '% → ' + (need + 1) + ' <= roll <= ' + top + ' → ' + (r.roll <= top ? '파괴' : '아무 일 없음'));
  }
}
process.exit(bad ? 2 : 0);
