import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, onValue, set, update, get, remove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig, ROOM_CODE } from "./firebase-config.js";

export const CONFIGURED = !String(firebaseConfig.apiKey).startsWith("PASTE");
export const ROOM = ROOM_CODE;

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
export const GAME_ORDER = ["tap", "mole", "react", "minority", "rps"];
export const GAMES = {
  tap:      { name: "연타 달리기",   sec: 10, rule: "10초 동안 버튼을 최대한 많이 누르세요. 한 손가락만!" },
  mole:     { name: "두더지잡기",     sec: 30, rule: "두더지 +1점 · 황금 두더지 +5점 · 폭탄은 -3점" },
  react:    { name: "번개 터치",      sec: 0,  rule: "화면이 금색으로 바뀌는 순간 터치! 먼저 누르면 부정출발 (3라운드 평균)" },
  minority: { name: "눈치 소수결",    sec: 10, rule: "둘 중 하나를 고르세요. 덜 고른 쪽이 1점!" },
  rps:      { name: "가위바위보 서바이벌", sec: 5, rule: "노트북과 가위바위보! 지거나 안 고르면 탈락" }
};

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
