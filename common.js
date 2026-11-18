import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, onValue, set, update, get, remove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig, ROOM_CODE } from "./firebase-config.js";

export const CONFIGURED = !String(firebaseConfig.apiKey).startsWith("PASTE");
// 주소에 ?room=방이름 을 붙이면 그 방을 따로 씁니다. 없으면 기본 방(ROOM_CODE).
const roomParam = (new URLSearchParams(location.search).get("room") || "").trim();
export const ROOM = roomParam && !/[.#$\[\]\/]/.test(roomParam) ? roomParam : ROOM_CODE;

let db = null;
if (CONFIGURED) {
  db = getDatabase(initializeApp(firebaseConfig));
}
export const rref = (path = "") => ref(db, `rooms/${ROOM}${path ? "/" + path : ""}`);
export { onValue, set, update, get, remove };

// ---- 서버 기준 시계 (모든 폰이 같은 순간에 시작) ----
let offset = 0;
if (db) onValue(ref(db, ".info/serverTimeOffset"), (s) => { offset = s.val() || 0; });
export const now = () => Date.now() + offset;

// ---- 게임 목록 ----
export const GAME_ORDER = ["tap", "mole", "react", "minority", "rps", "tteok"];
export const DEFAULT_TITLE = "BOA GAME NIGHT";
export const GAMES = {
  tap:      { name: "연타 달리기",   sec: 10, rule: "10초 동안 버튼을 최대한 많이 누르세요. 한 손가락만!" },
  mole:     { name: "두더지잡기",     sec: 30, rule: "두더지 +1점 · 황금 두더지 +5점 · 폭탄은 -3점" },
  react:    { name: "번개 터치",      sec: 0,  rule: "화면이 금색으로 바뀌는 순간 터치! 먼저 누르면 부정출발 (3라운드 평균)" },
  minority: { name: "눈치 소수결",    sec: 10, rule: "둘 중 하나를 고르세요. 덜 고른 쪽이 1점!" },
  rps:      { name: "가위바위보 서바이벌", sec: 5, rule: "노트북과 가위바위보! 지거나 안 고르면 탈락" },
  tteok:    { name: "떡먹은둥이찾기", sec: 0, rule: "떡을 먹은 둥이가 어디로 갔는지 맞히세요! 둥이는 점점 많아지고 더 빨리 섞여요" }
};

// ---- 떡먹은둥이찾기 ----
// 가운데 둥이가 떡을 먹고, 둥이들이 무작위로 자리를 바꾼 뒤 '떡 먹은 둥이'가 어디 있는지 맞힌다.
export const TTEOK_ROUNDS = 6;       // 총 라운드 수
export const TTEOK_ANS_MS = 5000;    // 답 고르는 시간

// 라운드 설정 (모든 폰과 TV가 같은 seed로 똑같이 계산)
// 1~3라운드: 둥이 3마리 / 4라운드 이후: 5마리
// 자리 바꾸기 횟수는 라운드가 갈수록 늘고, 한 번 바꾸는 속도는 빨라진다.
export function tteokRoundCfg(seed, r) {
  const n = r <= 3 ? 3 : 5;
  const rnd = rng((seed >>> 0) + r * 7919);
  const shuffles = r + 1;
  const shufDur = Math.max(330, 850 - 85 * r);
  const swaps = [];
  for (let k = 0; k < shuffles; k++) {
    const a = Math.floor(rnd() * n);
    let b = Math.floor(rnd() * (n - 1));
    if (b >= a) b++;
    swaps.push([a, b]);
  }
  const eater = Math.floor(n / 2);              // 처음 가운데 둥이가 떡을 먹는다
  const shuffleStart = 1600;
  const shuffleEnd = shuffleStart + shuffles * shufDur;
  const ansAt = shuffleEnd + 400;
  const who = Array.from({ length: n }, (_, i) => i);   // 칸 → 둥이
  swaps.forEach(([a, b]) => { [who[a], who[b]] = [who[b], who[a]]; });
  return {
    n, r, eater, swaps, shufDur, shuffleStart, dropEnd: 1200, ansAt,
    total: ansAt + TTEOK_ANS_MS,
    answer: who.indexOf(eater)                  // 정답 칸 (0부터)
  };
}

// ms 시점에 각 둥이가 있는 칸(소수 가능, 자리 바꾸는 중에는 중간 위치)
export function tteokFrame(cfg, ms) {
  const slotOf = Array.from({ length: cfg.n }, (_, i) => i);
  const who = Array.from({ length: cfg.n }, (_, i) => i);
  for (let i = 0; i < cfg.swaps.length; i++) {
    const t0 = cfg.shuffleStart + i * cfg.shufDur;
    const [a, b] = cfg.swaps[i];
    const da = who[a], db = who[b];
    if (ms >= t0 + cfg.shufDur) {
      who[a] = db; who[b] = da; slotOf[da] = b; slotOf[db] = a;
      continue;
    }
    if (ms >= t0) {
      const p = (ms - t0) / cfg.shufDur, e = p * p * (3 - 2 * p);
      slotOf[da] = a + (b - a) * e; slotOf[db] = b + (a - b) * e;
    }
    break;
  }
  return slotOf;
}

// 무대 HTML (떡 떨어짐 → 둥이 먹기 → 자리 바꾸기). opts.mark = 정답 칸 표시
export function tteokSceneHtml(cfg, ms, opts = {}) {
  const slotOf = tteokFrame(cfg, ms);
  const left = (x) => ((x + 0.5) / cfg.n) * 100;
  const dungi = slotOf.map((x, d) => {
    const eating = d === cfg.eater && ms >= cfg.dropEnd && ms < cfg.dropEnd + 700;
    return `<div class="dsc" style="left:${left(x)}%">${dungiSvg(eating ? "wow" : "happy")}</div>`;
  }).join("");
  const cake = ms < cfg.dropEnd
    ? `<div class="cake" style="left:${left(cfg.eater)}%;top:${-14 + (ms / cfg.dropEnd) * 50}%"></div>`
    : "";
  const mark = opts.mark != null ? `<div class="mark" style="left:${left(opts.mark)}%">정답</div>` : "";
  return `<div class="scene">${dungi}${cake}${mark}</div>`;
}

// ---- 둥이 (비숑) 그림 · mood: happy | wow | sad ----
export function dungiSvg(mood = "happy") {
  const mouth = mood === "wow"
    ? `<circle cx="50" cy="71" r="4.5" fill="#1C1029"/>`
    : mood === "sad"
      ? `<path d="M42 73 Q50 65 58 73" stroke="#1C1029" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
      : `<path d="M42 68 Q50 76 58 68" stroke="#1C1029" stroke-width="2.5" fill="none" stroke-linecap="round"/><ellipse cx="50" cy="74" rx="4" ry="3" fill="#F29BAA"/>`;
  const eyes = mood === "sad"
    ? `<path d="M34 50 Q37 46 40 50" stroke="#1C1029" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M60 50 Q63 46 66 50" stroke="#1C1029" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
    : `<circle cx="37" cy="50" r="${mood === "wow" ? 6 : 4.5}" fill="#1C1029"/><circle cx="63" cy="50" r="${mood === "wow" ? 6 : 4.5}" fill="#1C1029"/><circle cx="38.5" cy="48.5" r="1.6" fill="#fff"/><circle cx="64.5" cy="48.5" r="1.6" fill="#fff"/>`;
  return `<svg viewBox="0 0 100 100" style="width:100%;height:100%" aria-hidden="true">
    <ellipse cx="50" cy="96" rx="30" ry="3.5" fill="#3B2A1E" opacity=".35"/>
    <ellipse cx="18" cy="50" rx="9" ry="16" fill="#F3EEF8" stroke="#E6DCEB" stroke-width="1.5"/>
    <ellipse cx="82" cy="50" rx="9" ry="16" fill="#F3EEF8" stroke="#E6DCEB" stroke-width="1.5"/>
    <circle cx="50" cy="56" r="34" fill="#FFFFFF" stroke="#E6DCEB" stroke-width="2"/>
    <circle cx="24" cy="32" r="13" fill="#FFFFFF" stroke="#E6DCEB" stroke-width="1.5"/>
    <circle cx="76" cy="32" r="13" fill="#FFFFFF" stroke="#E6DCEB" stroke-width="1.5"/>
    <circle cx="36" cy="22" r="12" fill="#FFFFFF" stroke="#E6DCEB" stroke-width="1.5"/>
    <circle cx="64" cy="22" r="12" fill="#FFFFFF" stroke="#E6DCEB" stroke-width="1.5"/>
    <circle cx="50" cy="18" r="12" fill="#FFFFFF" stroke="#E6DCEB" stroke-width="1.5"/>
    ${eyes}
    <circle cx="28" cy="63" r="5" fill="#F29BAA" opacity=".5"/>
    <circle cx="72" cy="63" r="5" fill="#F29BAA" opacity=".5"/>
    <ellipse cx="50" cy="60" rx="5" ry="3.8" fill="#1C1029"/>
    ${mouth}
  </svg>`;
}

export const TAP_CAP_PER_SEC = 15;
export const REACT_ROUNDS = 3;
export const REACT_PENALTY = 1000;

// ---- 결정적 난수 (모든 폰이 같은 두더지 패턴) ----
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function moleSchedule(seed, totalMs = 30000) {
  const rnd = rng(seed);
  const busy = new Array(9).fill(0);
  const ev = [];
  let t = 700, id = 0;
  while (t < totalMs - 600) {
    const p = t / totalMs;
    const roll = rnd();
    const type = roll < 0.08 ? "gold" : roll < 0.2 ? "bomb" : "mole";
    let dur = 950 - 450 * p;
    if (type === "gold") dur *= 0.75;
    let hole = Math.floor(rnd() * 9);
    for (let k = 0; k < 6 && busy[hole] > t; k++) hole = Math.floor(rnd() * 9);
    busy[hole] = t + dur + 80;
    ev.push({ id: id++, t, hole, type, dur });
    t += 620 - 330 * p + rnd() * 160;
  }
  return ev;
}
export const MOLE_POINTS = { mole: 1, gold: 5, bomb: -3 };

// ---- 순위 → 점수 (1위 = 참가자 수, 동점은 같은 순위) ----
// entries: [{pid, v}] , better: (a,b) => 음수면 a가 앞
export function rankEntries(entries, better) {
  const sorted = [...entries].sort(better);
  const n = sorted.length;
  let rank = 0;
  return sorted.map((e, i) => {
    if (i === 0 || better(sorted[i - 1], e) !== 0) rank = i + 1;
    return { ...e, rank, points: n - rank + 1 };
  });
}

export const HANDS = { rock: "바위", paper: "보", scissors: "가위" };
export const HAND_ICON = { rock: "✊", paper: "✋", scissors: "✌️" };

// ---- 두더지 그림 (SVG) ----
export function moleSvg(kind) {
  if (kind === "bomb") return `<svg viewBox="0 0 100 100" aria-hidden="true"><ellipse cx="50" cy="94" rx="40" ry="6" fill="#3B2A1E"/><circle cx="46" cy="60" r="30" fill="#2B2B2B"/><circle cx="35" cy="50" r="8" fill="#5A5A5A"/><rect x="52" y="26" width="14" height="12" rx="3" fill="#555" transform="rotate(35 59 32)"/><path d="M64 30 Q72 16 84 18" stroke="#C9A24E" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="86" cy="17" r="7" fill="#F07A7A"/><circle cx="86" cy="17" r="3" fill="#FFE08A"/></svg>`;
  const fur = kind === "gold" ? "#E6C26E" : "#8A5A3C";
  const belly = kind === "gold" ? "#FFF1C7" : "#C99B76";
  const crown = kind === "gold" ? `<path d="M33 26 L39 9 L50 20 L61 9 L67 26 Z" fill="#F7D774" stroke="#B88A2E" stroke-width="2" stroke-linejoin="round"/>` : "";
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><ellipse cx="50" cy="93" rx="46" ry="9" fill="#3B2A1E"/><path d="M14 93 Q12 26 50 22 Q88 26 86 93 Z" fill="${fur}"/><ellipse cx="50" cy="76" rx="22" ry="17" fill="${belly}"/><circle cx="37" cy="48" r="5" fill="#1C1029"/><circle cx="63" cy="48" r="5" fill="#1C1029"/><circle cx="38.6" cy="46.4" r="1.7" fill="#fff"/><circle cx="64.6" cy="46.4" r="1.7" fill="#fff"/><circle cx="27" cy="61" r="5" fill="#F29BAA" opacity=".55"/><circle cx="73" cy="61" r="5" fill="#F29BAA" opacity=".55"/><ellipse cx="50" cy="59" rx="9" ry="6.5" fill="#F29BAA"/><rect x="46" y="65" width="8" height="8" rx="1.5" fill="#fff"/>${crown}</svg>`;
}
// ---- 두더지잡기 규칙 그림 설명 ----
export function moleLegend(size = 90, font = 18) {
  const item = (k, label, pts, color) => `<div style="display:flex;flex-direction:column;align-items:center;gap:8px"><div style="width:${size}px;height:${size}px;box-sizing:border-box;border-radius:18px;background:var(--panel);border:2px solid ${color};display:flex;align-items:flex-end;justify-content:center;padding:4px">${moleSvg(k).replace("<svg ", '<svg style="width:92%;height:92%" ')}</div><span style="font-size:${font}px;font-weight:700">${label}</span><span style="font-size:${font + 6}px;font-weight:900;color:${color}">${pts}</span></div>`;
  return `<div style="display:flex;gap:${Math.round(size / 4)}px;justify-content:center;margin-top:8px">${item("mole", "두더지", "+1점", "var(--good)")}${item("gold", "황금 두더지", "+5점", "var(--gold)")}${item("bomb", "폭탄", "-3점", "var(--bad)")}</div>`;
}
export const beats = (a, b) =>
  (a === "rock" && b === "scissors") || (a === "scissors" && b === "paper") || (a === "paper" && b === "rock");

export const TEAM = {
  purple: { name: "퍼플팀", color: "#8B5CC9" },
  gold:   { name: "골드팀", color: "#D9B872" }
};

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function setupWarning() {
  return `<div class="card" style="max-width:640px;margin:40px auto;text-align:left">
    <h2>설정이 필요해요</h2>
    <p><b>firebase-config.js</b> 파일에 Firebase 설정값을 붙여넣은 뒤 다시 열어 주세요.
    자세한 방법은 README.md 에 있어요.</p></div>`;
}
