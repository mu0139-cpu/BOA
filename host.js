import {
  CONFIGURED, ROOM, rref, onValue, set, update, get, remove, now,
  GAMES, GAME_ORDER, TEAM, HANDS, HAND_ICON, moleLegend, beats, rankEntries, REACT_ROUNDS, REACT_PENALTY, esc, setupWarning,
  DEFAULT_TITLE, dungiSvg, TTEOK_ROUNDS, tteokRoundCfg, tteokSceneHtml, tteokFrame, dungiArt, TTEOK_ART,
  STOP_TARGETS, STOP_SHOW_MS, STOP_MISS, STOP_GRACE, fmtSec
} from "./common.js";
import { play, setBgm, toggleSfx, toggleBgm, isSfxOn, isBgmOn } from "./sound.js";

const $ = (q) => document.querySelector(q);
const stage = $("#stage"), controls = $("#controls"), meta = $("#meta");
if (!CONFIGURED) { stage.innerHTML = setupWarning(); throw new Error("not configured"); }

const DEFAULT_QUESTIONS = [
  "점심 메뉴는? | 짜장 | 짬뽕",
  "휴가를 간다면? | 여름 휴가 | 겨울 휴가",
  "오늘의 한 잔은? | 레드 와인 | 화이트 와인",
  "여행을 간다면? | 부산 | 제주",
  "나는 어떤 사람? | 아침형 | 저녁형"
].join("\n");

let D = { state: { phase: "lobby" } };
let curKey = "";
let view = null;
const done = new Set();   // 자동 진행이 한 번만 일어나게

onValue(rref(), (s) => {
  D = s.val() || {};
  if (!D.state) D.state = { phase: "lobby" };
  queueDraw();
});

// ---------- 공통 도우미 ----------
const plist = () => Object.entries(D.players || {}).map(([pid, p]) => ({ pid, ...p })).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
const nameOf = (pid) => D.players?.[pid]?.name || "?";
const teamColor = () => "var(--gold)";
const keyOf = (s) => [s.phase, s.game, s.round, s.q, s.startAt].join("|");
const setState = (s) => set(rref("state"), s);
const gameNo = (g) => GAME_ORDER.indexOf(g) + 1;
const nextGame = (g) => GAME_ORDER[GAME_ORDER.indexOf(g) + 1];

function setControls(hint, buttons) {
  controls.innerHTML = `<span class="hint">${esc(hint || "")}</span>`;
  buttons.forEach(({ label, cls = "", on }) => {
    const b = document.createElement("button");
    b.className = "btn " + cls; b.textContent = label;
    b.addEventListener("click", () => { b.disabled = true; on(); });
    controls.appendChild(b);
  });
}

function clockText(s) {
  const t = now();
  if (t < s.startAt) return String(Math.ceil((s.startAt - t) / 1000));
  if (t < s.endAt) return Math.ceil((s.endAt - t) / 1000) + "초";
  return "끝!";
}

let drawQueued = false;
function queueDraw() { if (!drawQueued) { drawQueued = true; setTimeout(draw, 16); } }
function draw() {
  drawQueued = false;
  const s = D.state;
  meta.textContent = `방 코드 ${ROOM} · 참가자 ${plist().length}명`;
  $("#logo").textContent = D.title || DEFAULT_TITLE;
  const k = keyOf(s);
  if (k !== curKey) { const first = !curKey; curKey = k; view = build(s); soundFor(s, first); }
  view?.update?.();
  renderGameList();
}

// ---------- 소리: 화면이 바뀔 때 ----------
function soundFor(s, first) {
  const p = s.phase;
  if (p === "play") setBgm(s.game === "react" ? null : "game");   // 번개 터치는 긴장감 있게 조용히
  else setBgm("calm");
  if (first) return;                                // 처음 열었을 때는 효과음 생략
  if (p === "intro") play("ask");
  else if (p === "reveal") play("reveal");
  else if (p === "result") play("fanfare");
  else if (p === "final") play("drumroll", 1.6);
}

// 카운트다운 삐-삐-삐-시작, 끝 버저
let cdMark = "";
function countdownSound(s, t) {
  if (s.phase !== "play" || !s.startAt) return;
  const k = keyOf(s);
  const left = Math.ceil((s.startAt - t) / 1000);
  if (left >= 1 && left <= 3 && cdMark !== `${k}|${left}`) { cdMark = `${k}|${left}`; play("beep"); }
  if (t >= s.startAt && t < s.startAt + 600 && cdMark !== `${k}|go`) { cdMark = `${k}|go`; play("go"); }
  const timed = ["tap", "mole", "minority", "rps", "shake"].includes(s.game);
  if (timed && s.endAt && t >= s.endAt && t < s.endAt + 800 && cdMark !== `${k}|end`) { cdMark = `${k}|end`; play("end"); }
}

// ---------- 오른쪽 게임 목록 ----------
let glKey = "";
function renderGameList() {
  const s = D.state;
  const cur = ["intro", "play", "wait", "reveal", "result"].includes(s.phase) ? s.game : null;
  const doneG = GAME_ORDER.filter((g) => D.gameResults?.[g]);
  const key = [s.phase, cur, doneG.join(",")].join("|");
  if (key === glKey) return;
  glKey = key;
  const item = (g) => {
    const now_ = g === cur, fin = !now_ && doneG.includes(g);
    const tag = now_ ? (s.phase === "result" ? "결과" : s.phase === "intro" ? "준비" : "진행 중") : fin ? "완료 ✓" : "";
    return `<button class="gl-item${now_ ? " now" : ""}${fin ? " done" : ""}" data-g="${g}">
      <span class="gl-no">${gameNo(g)}</span><span>${esc(GAMES[g].name)}</span><span class="gl-tag">${tag}</span></button>`;
  };
  $("#glist").innerHTML = `<p class="gl-head serif">GAME LIST</p>${GAME_ORDER.map(item).join("")}
    <div class="gl-sep"></div>
    <button class="gl-item extra${s.phase === "lobby" ? " now" : ""}" data-x="lobby"><span class="gl-no">📱</span><span>로비 · QR</span><span class="gl-tag"></span></button>
    <button class="gl-item extra${s.phase === "final" ? " now" : ""}" data-x="final"><span class="gl-no">🏆</span><span>종합 결과</span><span class="gl-tag"></span></button>`;
}
$("#glist").addEventListener("click", (e) => {
  const b = e.target.closest(".gl-item");
  if (!b) return;
  const busy = ["play", "wait", "reveal"].includes(D.state.phase);
  if (busy && !confirm("진행 중인 게임을 멈추고 이동할까요?")) return;
  if (b.dataset.g) setState({ phase: "intro", game: b.dataset.g });
  else if (b.dataset.x === "lobby") setState({ phase: "lobby" });
  else if (b.dataset.x === "final") showFinal();
});

// ---------- 소리 켜기/끄기 버튼 ----------
const paintSnd = () => {
  $("#bgm-btn").classList.toggle("off", !isBgmOn()); $("#bgm-btn").textContent = "🎵";
  $("#sfx-btn").classList.toggle("off", !isSfxOn()); $("#sfx-btn").textContent = isSfxOn() ? "🔊" : "🔇";
};
$("#bgm-btn").addEventListener("click", () => { toggleBgm(); paintSnd(); });
$("#sfx-btn").addEventListener("click", () => { toggleSfx(); paintSnd(); });
paintSnd();

function build(s) {
  if (s.phase === "lobby") return lobbyView();
  if (s.phase === "intro") return introView(s);
  if (s.phase === "play") return ({ tap: raceView, mole: moleView, react: reactPlayView, minority: minorityPlayView, rps: rpsPlayView, tteok: tteokHostView, stop: stopPlayView, shake: shakeView })[s.game](s);
  if (s.phase === "wait") return reactWaitView(s);
  if (s.phase === "reveal") return s.game === "minority" ? minorityRevealView(s) : s.game === "tteok" ? tteokRevealView(s) : s.game === "stop" ? stopRevealView(s) : rpsRevealView(s);
  if (s.phase === "result") return resultView(s);
  if (s.phase === "final") return finalView();
  return null;
}

// ---------- 진행 동작 ----------
async function startGame(g) {
  const t = now();
  if (g === "tteok") {
    const seed = Math.floor(Math.random() * 1e9);
    await update(rref(), { "results/tteok": null, "tteok/seed": seed });
    startTteokRound(1, seed);
  }
  if (g === "stop") { await update(rref(), { "results/stop": null, "stop/rounds": 0 }); startStopRound(1); }
  if (g === "tap" || g === "mole" || g === "shake") {
    await update(rref(), {
      [`live/${g}`]: null, [`results/${g}`]: null,
      state: { phase: "play", game: g, startAt: t + 3500, endAt: t + 3500 + GAMES[g].sec * 1000, seed: Math.floor(Math.random() * 1e9) }
    });
  }
  if (g === "react") { await set(rref("results/react"), null); startReactRound(1); }
  if (g === "minority") {
    const text = $("#qs")?.value || DEFAULT_QUESTIONS;
    const qs = text.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p.length >= 3 && p[0] && p[1] && p[2]);
    await update(rref(), { "minority/questions": qs, "minority/pts": null, "results/minority": null, "minority/text": text });
    startMinorityQ(0, qs);
  }
  if (g === "rps") {
    const alive = {}; plist().forEach((p) => (alive[p.pid] = true));
    await update(rref(), { "rps/alive": alive, "rps/elim": null, "results/rps": null });
    startRpsRound(1);
  }
}

function startReactRound(n) {
  const s = now() + 3000, go = s + 2000 + Math.floor(Math.random() * 3000);
  setState({ phase: "play", game: "react", round: n, startAt: s, goAt: go, endAt: go + 2500 });
}

function startStopRound(r) {
  const target = STOP_TARGETS[r - 1];
  const s = now() + 3500;
  update(rref(), { "stop/rounds": r, state: { phase: "play", game: "stop", round: r, target, startAt: s, endAt: s + target * 1000 + STOP_GRACE } });
}

function startTteokRound(r, seed = D.tteok?.seed) {
  const cfg = tteokRoundCfg(seed, r);
  const s = now() + 3000;
  setState({ phase: "play", game: "tteok", round: r, seed, startAt: s, endAt: s + cfg.total });
}

function revealTteok(s) {
  const cfg = tteokRoundCfg(s.seed, s.round);
  update(rref(), { state: { ...s, phase: "reveal", answer: cfg.answer } });
}

function startMinorityQ(i, qs = D.minority?.questions || []) {
  const q = qs[i]; if (!q) return finishGame("minority");
  const s = now() + 3000;
  setState({ phase: "play", game: "minority", q: i, total: qs.length, question: q[0], a: q[1], b: q[2], startAt: s, endAt: s + GAMES.minority.sec * 1000 });
}

function startRpsRound(n) {
  const s = now() + 3000;
  setState({ phase: "play", game: "rps", round: n, startAt: s, endAt: s + GAMES.rps.sec * 1000 });
}

function revealMinority(s) {
  const picks = D.results?.minority?.[`q${s.q}`] || {};
  let countA = 0, countB = 0;
  Object.values(picks).forEach((v) => (v === "a" ? countA++ : v === "b" ? countB++ : 0));
  const winner = countA < countB ? "a" : countB < countA ? "b" : null;
  const up = {};
  if (winner) Object.entries(picks).forEach(([pid, v]) => { if (v === winner) up[`minority/pts/${pid}`] = (D.minority?.pts?.[pid] || 0) + 1; });
  up.state = { ...s, phase: "reveal", countA, countB, winner };
  update(rref(), up);
}

function revealRps(s) {
  const alive = Object.keys(D.rps?.alive || {});
  const picks = D.results?.rps?.[`r${s.round}`] || {};
  const hostHand = ["rock", "paper", "scissors"][Math.floor(Math.random() * 3)];
  const strict = alive.length <= 3;
  const surv = alive.filter((pid) => {
    const p = picks[pid];
    if (!p) return false;
    return beats(p, hostHand) || (!strict && p === hostHand);
  });
  const up = {};
  const revived = surv.length === 0;
  if (!revived) {
    const a = {}; surv.forEach((pid) => (a[pid] = true));
    up["rps/alive"] = a;
    alive.filter((pid) => !surv.includes(pid)).forEach((pid) => (up[`rps/elim/${pid}`] = s.round));
  }
  up.state = { ...s, phase: "reveal", hostHand, revived, out: revived ? [] : alive.filter((pid) => !surv.includes(pid)) };
  update(rref(), up);
}

function computeList(g) {
  const ps = plist();
  const R = D.results || {}, L = D.live || {};
  let entries, better, label;
  if (g === "tap" || g === "mole" || g === "shake") {
    entries = ps.map((p) => ({ pid: p.pid, v: R[g]?.[p.pid] ?? L[g]?.[p.pid] ?? (g === "mole" ? -99 : 0) }));
    better = (a, b) => b.v - a.v;
    label = (v) => (g === "tap" ? `${v}회` : g === "shake" ? `${v}번 흔듦` : `${v === -99 ? 0 : v}점`);
  } else if (g === "stop") {
    const rounds = D.stop?.rounds || 0;
    entries = ps.map((p) => {
      let err = 0;
      for (let r = 1; r <= rounds; r++) {
        const t = R.stop?.[`r${r}`]?.[p.pid];
        err += t == null ? STOP_MISS : Math.abs(t - STOP_TARGETS[r - 1] * 1000);
      }
      return { pid: p.pid, v: err };
    });
    better = (a, b) => a.v - b.v;
    label = (v) => `오차 합계 ${fmtSec(v)}초`;
  } else if (g === "react") {
    entries = ps.map((p) => {
      let sum = 0;
      for (let i = 1; i <= REACT_ROUNDS; i++) sum += R.react?.[`r${i}`]?.[p.pid] ?? REACT_PENALTY;
      return { pid: p.pid, v: Math.round(sum / REACT_ROUNDS) };
    });
    better = (a, b) => a.v - b.v;
    label = (v) => `평균 ${v}ms`;
  } else if (g === "minority") {
    entries = ps.map((p) => ({ pid: p.pid, v: D.minority?.pts?.[p.pid] || 0 }));
    better = (a, b) => b.v - a.v;
    label = (v) => `${v}점`;
  } else if (g === "tteok") {
    entries = ps.map((p) => {
      let correct = 0, time = 0;
      for (let r = 1; r <= TTEOK_ROUNDS; r++) {
        const pick = R.tteok?.[`r${r}`]?.[p.pid];
        if (!pick || D.tteok?.seed == null) continue;
        if (pick.s === tteokRoundCfg(D.tteok.seed, r).answer) { correct++; time += pick.t || 0; }
      }
      return { pid: p.pid, v: correct * 1e7 - time, label: `${correct}/${TTEOK_ROUNDS}회 정답` };
    });
    better = (a, b) => b.v - a.v;
    label = () => "";
  } else {
    entries = ps.map((p) => ({ pid: p.pid, v: D.rps?.alive?.[p.pid] ? 999 : (D.rps?.elim?.[p.pid] || 0) }));
    better = (a, b) => b.v - a.v;
    label = (v) => (v === 999 ? "최후의 생존" : v ? `${v}라운드 탈락` : "불참");
  }
  return rankEntries(entries, better).map((e) => ({ ...e, name: nameOf(e.pid), team: D.players?.[e.pid]?.team || "", label: e.label ?? label(e.v) }));
}

async function finishGame(g) {
  const list = computeList(g);
  const up = { [`gameResults/${g}`]: list, state: { phase: "result", game: g } };
  list.forEach((e) => (up[`scores/${e.pid}/${g}`] = e.points));
  await update(rref(), up);
}

async function showFinal() {
  const ps = plist();
  const entries = ps.map((p) => ({ pid: p.pid, v: Object.values(D.scores?.[p.pid] || {}).reduce((a, b) => a + b, 0) }));
  const list = rankEntries(entries, (a, b) => b.v - a.v).map((e) => ({ pid: e.pid, rank: e.rank, total: e.v, name: nameOf(e.pid), team: D.players?.[e.pid]?.team || "" }));
  await update(rref(), { final: list, state: { phase: "final" } });
}

// ---------- 자동 진행 (0.2초마다 확인) ----------
setInterval(() => {
  const s = D.state, t = now(), k = keyOf(s);
  view?.tick?.();
  countdownSound(s, t);
  if (done.has(k)) return;
  if (s.phase === "play" && t > s.endAt + 1200) {
    done.add(k);
    if (s.game === "tap" || s.game === "mole" || s.game === "shake") finishGame(s.game);
    else if (s.game === "stop") setState({ ...s, phase: "reveal" });
    else if (s.game === "react") {
      if (s.round < REACT_ROUNDS) setState({ phase: "wait", game: "react", round: s.round, nextAt: t + 5000 });
      else finishGame("react");
    } else if (s.game === "minority") revealMinority(s);
    else if (s.game === "rps") revealRps(s);
    else if (s.game === "tteok") revealTteok(s);
  }
  if (s.phase === "wait" && t > s.nextAt) { done.add(k); startReactRound(s.round + 1); }
}, 200);

// ---------- 화면: 로비 ----------
function lobbyView() {
  const u = new URL("index.html", location.href);
  u.search = "";
  if (ROOM !== "BOA26") u.searchParams.set("room", ROOM);
  const url = u.href;
  stage.innerHTML = `
    <div class="lobby">
      <div style="text-align:center">
        <div class="qr" id="qr"></div>
        <p class="muted" style="margin-top:12px;font-size:16px;max-width:300px;word-break:break-all">${esc(url)}</p>
      </div>
      <div>
        <p class="h-sub">폰 카메라로 QR을 찍고 별명을 입력하세요</p>
        <p class="h-title" style="margin:8px 0 24px">참가자 <span id="cnt">0</span>명</p>
        <div class="chips" id="pt"></div>
      </div>
    </div>`;
  new QRCode($("#qr"), { text: url, width: 280, height: 280, colorDark: "#1C1029", colorLight: "#ffffff" });
  const firstG = GAME_ORDER.find((g) => !D.gameResults?.[g]) || GAME_ORDER[0];
  setControls("오른쪽 목록에서 원하는 게임을 바로 고를 수도 있어요", [
    { label: `게임 시작 · ${GAMES[firstG].name}`, on: () => setState({ phase: "intro", game: firstG }) }
  ]);
  return {
    update() {
      const ps = plist();
      $("#cnt").textContent = ps.length;
      const chip = (p) => `<span class="chip gold">${esc(p.name)}</span>`;
      $("#pt").innerHTML = ps.map(chip).join("") || `<span class="muted">아직 없어요</span>`;
    }
  };
}

// ---------- 화면: 게임 소개 ----------
function introView(s) {
  const g = GAMES[s.game];
  stage.innerHTML = `
    <div class="center">
      <p class="serif gold" style="font-size:32px">GAME ${gameNo(s.game)}</p>
      <p class="h-title" style="font-size:88px">${esc(g.name)}</p>
      <p class="h-sub" style="font-size:30px">${esc(g.rule)}</p>
      ${s.game === "minority" ? `<div style="width:100%;max-width:800px;text-align:left;margin-top:12px">
        <p class="muted" style="margin-bottom:8px">문제 목록 (한 줄에 하나: 질문 | 보기A | 보기B)</p>
        <textarea id="qs">${esc(D.minority?.text || DEFAULT_QUESTIONS)}</textarea></div>` : ""}
      ${s.game === "rps" ? `<p class="muted" style="font-size:22px">4명 이상일 땐 비겨도 생존, 3명 이하부터는 이긴 사람만 생존</p>` : ""}
      ${s.game === "mole" ? moleLegend(150, 26) : ""}
      ${s.game === "stop" ? `<p class="h-sub" style="font-size:26px">목표 시간: ${STOP_TARGETS.map((t) => `${t}초`).join(" → ")}</p>` : ""}
      ${s.game === "shake" ? `<p style="font-size:120px;line-height:1">📳🏇</p><p class="h-sub" style="font-size:24px">아이폰은 폰 화면의 <b class="gold">‘흔들기 준비’</b> 버튼을 먼저 눌러 센서를 허용해 주세요</p>` : ""}
      ${s.game === "tteok" ? `<div style="width:240px;height:240px">${dungiArt(TTEOK_ART.dungi, "happy")}</div>` : ""}
    </div>`;
  setControls("모두의 폰에 규칙이 표시되고 있어요", [
    { label: "로비로", cls: "ghost", on: () => setState({ phase: "lobby" }) },
    { label: "시작하기", on: () => startGame(s.game) }
  ]);
  return {};
}

// ---------- 화면: 연타 달리기 (경주) ----------
function raceView(s) {
  stage.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:20px">
      <p class="h-title">연타 달리기</p><p class="clock" id="clk"></p></div><div class="rows" id="rows"></div>`;
  setControls("10초 동안 폰 버튼을 연타!", [{ label: "중단하고 로비로", cls: "ghost", on: () => setState({ phase: "lobby" }) }]);
  return {
    tick() { $("#clk").textContent = clockText(s); },
    update() {
      const ps = plist();
      const v = (pid) => D.results?.tap?.[pid] ?? D.live?.tap?.[pid] ?? 0;
      const max = Math.max(10, ...ps.map((p) => v(p.pid)));
      $("#rows").innerHTML = ps.map((p) => `<div class="row"><span class="rk"></span><span class="nm">${esc(p.name)}</span>
        <div class="track"><i style="width:${(v(p.pid) / max) * 100}%;background:${teamColor(p.pid)}"></i></div><span class="val">${v(p.pid)}회</span></div>`).join("");
      this.tick();
    }
  };
}

// ---------- 화면: 두더지잡기 ----------
function moleView(s) {
  stage.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:20px">
      <p class="h-title">두더지잡기</p><p class="clock" id="clk"></p></div><div class="rows" id="rows"></div>`;
  setControls("실시간 점수", [{ label: "중단하고 로비로", cls: "ghost", on: () => setState({ phase: "lobby" }) }]);
  return {
    tick() { $("#clk").textContent = clockText(s); },
    update() {
      const ps = plist().map((p) => ({ ...p, v: D.results?.mole?.[p.pid] ?? D.live?.mole?.[p.pid] ?? 0 })).sort((a, b) => b.v - a.v);
      const max = Math.max(5, ...ps.map((p) => p.v));
      $("#rows").innerHTML = ps.map((p, i) => `<div class="row"><span class="rk">${i + 1}</span><span class="nm">${esc(p.name)}</span>
        <div class="track"><i style="width:${(Math.max(0, p.v) / max) * 100}%;background:${teamColor(p.pid)}"></i></div><span class="val">${p.v}점</span></div>`).join("");
      this.tick();
    }
  };
}

// ---------- 화면: 정지! 타이머 ----------
function stopPlayView(s) {
  stage.innerHTML = `<div class="center">
      <p class="serif gold" style="font-size:32px">ROUND ${s.round} / ${STOP_TARGETS.length}</p>
      <p class="h-title" style="font-size:72px">목표 <span class="gold">${s.target}.00</span>초</p>
      <p class="clock stop-clock" id="clk" style="font-size:180px"></p>
      <p class="h-sub" id="sub" style="font-size:30px"></p>
      <p class="h-sub" id="cnt"></p></div>`;
  setControls("숫자는 3초 뒤에 사라져요. 마음속으로 세고 폰의 STOP!", [{ label: "중단하고 로비로", cls: "ghost", on: () => setState({ phase: "lobby" }) }]);
  const loop = () => {
    const el = document.querySelector("#clk");
    if (!el || keyOf(D.state) !== keyOf(s)) return;
    const t = now(), ms = t - s.startAt;
    if (ms < 0) { el.textContent = String(Math.ceil(-ms / 1000)); $("#sub").textContent = "곧 시작!"; }
    else if (ms < STOP_SHOW_MS) { el.textContent = fmtSec(ms); $("#sub").textContent = "잘 보세요… 곧 사라져요"; }
    else if (t < s.endAt) { el.textContent = "??.??"; $("#sub").textContent = "지금부터는 감으로! 목표 시간에 STOP"; }
    else { el.textContent = "끝!"; $("#sub").textContent = ""; }
    const n = Object.keys(D.results?.stop?.[`r${s.round}`] || {}).length;
    $("#cnt").textContent = `멈춘 사람 ${n} / ${plist().length}`;
    requestAnimationFrame(loop);
  };
  loop();
  return {};
}

function stopRevealView(s) {
  const res = D.results?.stop?.[`r${s.round}`] || {};
  const goal = s.target * 1000;
  const rows = plist().map((p) => {
    const t = res[p.pid];
    return { ...p, t, err: t == null ? Infinity : t - goal };
  }).sort((a, b) => Math.abs(a.err) - Math.abs(b.err));
  const last = s.round >= STOP_TARGETS.length;
  const best = rows[0] && rows[0].t != null ? rows[0] : null;
  stage.innerHTML = `<p class="serif gold" style="font-size:28px;text-align:center">ROUND ${s.round} 결과 · 목표 ${s.target}.00초</p>
    <p class="h-title" style="text-align:center;margin:6px 0 18px">${best ? `가장 가까운 사람: ${esc(best.name)} (${fmtSec(best.t)}초)` : "아무도 멈추지 않았어요"}</p>
    <div class="rows">${rows.map((p, i) => `<div class="row"><span class="rk">${i + 1}</span><span class="nm">${esc(p.name)}</span>
      <span class="muted">${p.t == null ? "못 멈춤" : `${fmtSec(p.t)}초에 STOP`}</span>
      <span class="val" style="color:${p.t == null ? "var(--bad)" : Math.abs(p.err) < 300 ? "var(--good)" : "var(--text)"}">${p.t == null ? "-" : (p.err >= 0 ? "+" : "−") + fmtSec(Math.abs(p.err))}</span></div>`).join("")}</div>`;
  const btns = [];
  if (!last) btns.push({ label: "여기서 끝내기", cls: "ghost", on: () => finishGame("stop") });
  btns.push(last ? { label: "결과 보기", on: () => finishGame("stop") } : { label: `다음 라운드 · 목표 ${STOP_TARGETS[s.round]}초`, on: () => startStopRound(s.round + 1) });
  setControls("오차가 작을수록 좋아요 · 못 누르면 오차 5초", btns);
  return {};
}

// ---------- 화면: 폰 흔들기 레이스 ----------
function shakeView(s) {
  stage.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:16px">
      <p class="h-title">폰 흔들기 레이스</p><p class="clock" id="clk"></p></div>
    <div class="lanes" id="lanes"></div>`;
  setControls("폰을 꼭 쥐고 힘차게 흔드세요! (손목 스트랩·주변 조심)", [{ label: "중단하고 로비로", cls: "ghost", on: () => setState({ phase: "lobby" }) }]);
  return {
    tick() { $("#clk").textContent = clockText(s); },
    update() {
      const ps = plist();
      const v = (pid) => D.results?.shake?.[pid] ?? D.live?.shake?.[pid] ?? 0;
      const max = Math.max(40, ...ps.map((p) => v(p.pid)));
      const lead = Math.max(0, ...ps.map((p) => v(p.pid)));
      $("#lanes").innerHTML = ps.map((p) => {
        const pct = Math.min(100, (v(p.pid) / max) * 100);
        return `<div class="lane"><span class="nm">${esc(p.name)}</span>
          <div class="lane-track"><i style="width:${pct}%"></i><span class="horse${v(p.pid) === lead && lead > 0 ? " lead" : ""}" style="left:${pct}%">🏇</span><span class="flag">🏁</span></div>
          <span class="val">${v(p.pid)}</span></div>`;
      }).join("");
      this.tick();
    }
  };
}

// ---------- 화면: 떡먹은둥이찾기 ----------
function tteokHostView(s) {
  const cfg = tteokRoundCfg(s.seed, s.round);
  stage.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:8px">
      <p class="h-title">떡먹은둥이찾기 <span class="gold" style="font-size:36px">ROUND ${s.round} / ${TTEOK_ROUNDS}</span></p>
      <p class="clock" id="clk" style="font-size:90px"></p></div>
    <p class="h-sub" id="sub" style="font-size:32px"></p>
    <div id="scene" style="display:flex;justify-content:center;margin-top:28px"></div>`;
  setControls("TV 화면을 보며 폰으로 답을 고르세요", [{ label: "중단하고 로비로", cls: "ghost", on: () => setState({ phase: "lobby" }) }]);
  const fired = new Set();
  const once = (k, name) => { if (!fired.has(k)) { fired.add(k); play(name); } };
  const loop = () => {
    const el = document.querySelector("#scene");
    if (!el || keyOf(D.state) !== keyOf(s)) return;   // 다른 화면으로 바뀌면 멈춤
    const t = now(), ms = t - s.startAt;
    if (ms >= 0 && ms < cfg.dropEnd) once("drop", "drop");
    if (ms >= cfg.dropEnd && ms < cfg.dropEnd + 600) once("chomp", "chomp");
    cfg.swaps.forEach((_, i) => { const t0 = cfg.shuffleStart + i * cfg.shufDur; if (ms >= t0 && ms < t0 + cfg.shufDur) once("sw" + i, "whoosh"); });
    if (ms >= cfg.ansAt && ms < cfg.ansAt + 600) once("ask", "ask");
    let phase = "", clk = "";
    if (ms < 0) { phase = "곧 시작!"; clk = String(Math.ceil(-ms / 1000)); }
    else if (ms < cfg.ansAt) { phase = ms < cfg.dropEnd ? "둥이가 떡을 먹어요!" : "둥이들이 자리를 바꿔요! 잘 보세요"; }
    else if (ms < cfg.total) {
      const n = Object.keys(D.results?.tteok?.[`r${s.round}`] || {}).length;
      phase = `떡을 먹은 둥이는 어디? 번호를 고르세요 (답 ${n}/${plist().length})`;
      clk = Math.ceil((cfg.total - ms) / 1000) + "초";
    }
    else phase = "답 마감!";
    $("#sub").textContent = phase;
    $("#clk").textContent = clk;
    el.innerHTML = tteokSceneHtml(cfg, Math.max(0, ms));
    requestAnimationFrame(loop);
  };
  loop();
  return {};
}

function tteokRevealView(s) {
  const cfg = tteokRoundCfg(s.seed, s.round);
  const picks = D.results?.tteok?.[`r${s.round}`] || {};
  const ok = plist().filter((p) => picks[p.pid]?.s === cfg.answer);
  const last = s.round >= TTEOK_ROUNDS;
  stage.innerHTML = `<div class="center">
      <p class="serif gold" style="font-size:28px">ROUND ${s.round} 결과</p>
      <p class="h-title">정답은 ${cfg.answer + 1}번 자리!</p>
      <div style="width:100%;max-width:960px;display:flex;justify-content:center">${tteokSceneHtml(cfg, cfg.total, { mark: cfg.answer })}</div>
      <p class="h-sub" style="font-size:32px">정답 ${ok.length} / ${plist().length}명</p>
      <div class="chips" style="justify-content:center;max-width:1100px">${ok.map((p) => `<span class="chip gold">${esc(p.name)}</span>`).join("")}</div></div>`;
  const btns = [];
  if (!last) btns.push({ label: "여기서 끝내기", cls: "ghost", on: () => finishGame("tteok") });
  btns.push(last ? { label: "결과 보기", on: () => finishGame("tteok") } : { label: "다음 라운드", on: () => startTteokRound(s.round + 1) });
  setControls(last ? "마지막 라운드예요" : `다음 라운드는 둥이가 ${s.round + 1 > 3 ? 5 : 3}마리예요`, btns);
  return {};
}

// ---------- 화면: 번개 터치 ----------
function reactPlayView(s) {
  stage.innerHTML = `<div class="center">
      <p class="serif gold" style="font-size:32px">ROUND ${s.round} / ${REACT_ROUNDS}</p>
      <p class="h-title" style="font-size:96px">폰 화면을 보세요!</p>
      <p class="h-sub" style="font-size:30px">금색으로 바뀌는 순간 터치 · 먼저 누르면 부정출발</p>
      <p class="clock" id="clk" style="font-size:80px"></p>
      <p class="h-sub" id="cnt"></p></div>`;
  setControls("TV에는 신호가 나오지 않아요. 폰에만 집중!", [{ label: "중단하고 로비로", cls: "ghost", on: () => setState({ phase: "lobby" }) }]);
  return {
    tick() { const t = now(); $("#clk").textContent = t < s.startAt ? String(Math.ceil((s.startAt - t) / 1000)) : t < s.endAt ? "…" : "끝!"; },
    update() { const n = Object.keys(D.results?.react?.[`r${s.round}`] || {}).length; $("#cnt").textContent = `기록 ${n} / ${plist().length}`; this.tick(); }
  };
}

function reactWaitView(s) {
  stage.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:20px">
      <p class="h-title">라운드 ${s.round} 기록</p><p class="h-sub" id="nx"></p></div><div class="rows" id="rows"></div>`;
  setControls("잠시 후 다음 라운드가 자동으로 시작돼요", [{ label: "중단하고 로비로", cls: "ghost", on: () => setState({ phase: "lobby" }) }]);
  return {
    tick() { $("#nx").textContent = `다음 라운드 ${Math.max(0, Math.ceil((s.nextAt - now()) / 1000))}초 후`; },
    update() {
      const r = D.results?.react?.[`r${s.round}`] || {};
      const ps = plist().map((p) => ({ ...p, v: r[p.pid] ?? REACT_PENALTY })).sort((a, b) => a.v - b.v);
      $("#rows").innerHTML = ps.map((p, i) => `<div class="row"><span class="rk">${i + 1}</span><span class="nm">${esc(p.name)}</span><span></span>
        <span class="val" style="color:${p.v >= REACT_PENALTY ? "var(--bad)" : "var(--text)"}">${p.v >= REACT_PENALTY ? "부정출발·미입력" : p.v + " ms"}</span></div>`).join("");
      this.tick();
    }
  };
}

// ---------- 화면: 눈치 소수결 ----------
function minorityPlayView(s) {
  stage.innerHTML = `<div class="center">
      <p class="serif gold" style="font-size:28px">QUESTION ${s.q + 1} / ${s.total}</p>
      <p class="h-title">${esc(s.question)}</p>
      <div class="vs"><div class="opt">${esc(s.a)}</div><div class="opt">${esc(s.b)}</div></div>
      <p class="clock" id="clk" style="font-size:80px"></p><p class="h-sub" id="cnt"></p></div>`;
  setControls("덜 고른 쪽이 1점! 마감 전까지 바꿀 수 있어요", [{ label: "중단하고 로비로", cls: "ghost", on: () => setState({ phase: "lobby" }) }]);
  return {
    tick() { $("#clk").textContent = clockText(s); },
    update() { const n = Object.keys(D.results?.minority?.[`q${s.q}`] || {}).length; $("#cnt").textContent = `응답 ${n} / ${plist().length}`; this.tick(); }
  };
}

function minorityRevealView(s) {
  const last = s.q + 1 >= s.total;
  stage.innerHTML = `<div class="center">
      <p class="serif gold" style="font-size:28px">QUESTION ${s.q + 1} 결과</p>
      <p class="h-title">${esc(s.question)}</p>
      <div class="vs">
        <div class="opt ${s.winner === "a" ? "win" : ""}">${esc(s.a)}<small>${s.countA}명</small></div>
        <div class="opt ${s.winner === "b" ? "win" : ""}">${esc(s.b)}<small>${s.countB}명</small></div>
      </div>
      <p class="h-sub" style="font-size:32px">${s.winner ? `소수 승리! ‘${esc(s.winner === "a" ? s.a : s.b)}’ 선택자 +1점` : "동점! 이번 문제는 모두 0점"}</p></div>`;
  setControls("", [
    last ? { label: "결과 보기", on: () => finishGame("minority") } : { label: "다음 문제", on: () => startMinorityQ(s.q + 1) }
  ]);
  return {};
}

// ---------- 화면: 가위바위보 서바이벌 ----------
function rpsPlayView(s) {
  const alive = Object.keys(D.rps?.alive || {});
  stage.innerHTML = `<div class="center">
      <p class="serif gold" style="font-size:28px">ROUND ${s.round} · 생존 ${alive.length}명</p>
      <p style="font-size:110px;line-height:1">${HAND_ICON.scissors} ${HAND_ICON.rock} ${HAND_ICON.paper}</p>
      <p class="h-title" style="font-size:80px">가위바위보!</p>
      <p class="clock" id="clk" style="font-size:80px"></p><p class="h-sub" id="cnt"></p>
      ${alive.length <= 3 ? `<p class="h-sub" style="color:var(--gold)">이제 이긴 사람만 살아남아요</p>` : ""}</div>`;
  setControls("폰에서 가위·바위·보 중 하나를 고르세요", [{ label: "중단하고 로비로", cls: "ghost", on: () => setState({ phase: "lobby" }) }]);
  return {
    tick() { $("#clk").textContent = clockText(s); },
    update() { const n = Object.keys(D.results?.rps?.[`r${s.round}`] || {}).length; $("#cnt").textContent = `응답 ${n} / ${alive.length}`; this.tick(); }
  };
}

function rpsRevealView(s) {
  const alive = Object.keys(D.rps?.alive || {});
  const out = s.out || [];
  const chip = (pid, cls) => `<span class="chip gold ${cls}">${esc(nameOf(pid))}</span>`;
  stage.innerHTML = `<div class="center">
      <p class="serif gold" style="font-size:28px">ROUND ${s.round} 결과</p>
      <p class="h-sub" style="font-size:32px">노트북이 낸 손</p>
      <p style="font-size:180px;line-height:1">${HAND_ICON[s.hostHand]}</p>
      <p class="h-title" style="color:var(--gold)">${HANDS[s.hostHand]}</p>
      <p class="h-sub">${s.revived ? "모두 탈락! 이번 라운드는 전원 부활" : `생존 ${alive.length}명 · 탈락 ${out.length}명`}</p>
      <div class="chips" style="justify-content:center;max-width:1100px">${alive.map((p) => chip(p, "")).join("")}${out.map((p) => chip(p, "out")).join("")}</div></div>`;
  const btns = [];
  if (alive.length > 1) {
    btns.push({ label: "여기서 끝내기", cls: "ghost", on: () => finishGame("rps") });
    btns.push({ label: "다음 라운드", on: () => startRpsRound(s.round + 1) });
  } else btns.push({ label: "결과 보기", on: () => finishGame("rps") });
  setControls(alive.length === 1 ? `최후의 생존자: ${nameOf(alive[0])}!` : "", btns);
  return {};
}

// ---------- 화면: 게임 결과 ----------
function podium(list, valKey, opt = {}) {
  const top = [list.find((e) => e.rank === 2) || list[1], list[0], list.find((e) => e.rank === 3) || list[2]];
  const h = opt.heights || [150, 210, 110];
  const medal = opt.medal ? ["🥈", "🥇", "🥉"] : null;
  return `<div class="podium${opt.medal ? " medal" : ""}">${top.map((e, i) => e ? `<div class="pod"><p class="nm" style="color:var(--text)">${medal ? `<span style="font-size:40px">${medal[i]}</span><br>` : ""}${esc(e.name)}</p>
    <p class="muted" style="margin-bottom:8px">${esc(valKey(e))}</p><div class="blk" style="height:${h[i]}px">${e.rank}위</div></div>` : "").join("")}</div>`;
}

function resultView(s) {
  const list = D.gameResults?.[s.game] || [];
  stage.innerHTML = `<p class="serif gold" style="font-size:28px;text-align:center">GAME ${gameNo(s.game)} RESULT</p>
    <p class="h-title" style="text-align:center">${esc(GAMES[s.game].name)}</p>
    ${podium(list, (e) => e.label)}
    <div class="rows">${list.slice(3).map((e) => `<div class="row"><span class="rk">${e.rank}</span><span class="nm">${esc(e.name)}</span><span class="muted">${esc(e.label)}</span><span class="val">+${e.points}점</span></div>`).join("")}</div>`;
  const ng = nextGame(s.game);
  setControls("순위대로 점수가 쌓여요 (1위 = 참가자 수만큼)", [
    { label: "로비로", cls: "ghost", on: () => setState({ phase: "lobby" }) },
    ng ? { label: `다음 게임 · ${GAMES[ng].name}`, on: () => setState({ phase: "intro", game: ng }) } : { label: "종합 결과 발표", on: showFinal }
  ]);
  return {};
}

// ---------- 화면: 종합 결과 ----------
const GAME_COLORS = { tap: "#D9B872", mole: "#B98A5E", react: "#8B5CC9", minority: "#5FB3A1", rps: "#6E9BE0", tteok: "#E07FA8", stop: "#E8955A", shake: "#9FD36B" };
function finalView() {
  const list = D.final || [];
  const champ = list.filter((e) => e.rank === 1).map((e) => e.name).join(", ");
  const played = GAME_ORDER.filter((g) => list.some((e) => D.scores?.[e.pid]?.[g] != null));
  const max = Math.max(1, ...list.map((e) => e.total));
  const bars = list.map((e) => {
    const segs = played.map((g) => {
      const v = D.scores?.[e.pid]?.[g] || 0;
      return v ? `<i data-w="${(v / max) * 100}" style="background:${GAME_COLORS[g]}" title="${esc(GAMES[g].name)} ${v}점"></i>` : "";
    }).join("");
    return `<div class="bar-row"><span class="rk">${e.rank}</span><span class="nm">${esc(e.name)}</span><div class="bar-track">${segs}</div><span class="val">${e.total}</span></div>`;
  }).join("");
  stage.innerHTML = `<p class="serif gold" style="font-size:30px;text-align:center">FINAL</p>
    <p class="h-title" style="text-align:center;margin-bottom:8px">${champ ? `우승 ${esc(champ)}!` : "최종 순위"}</p>
    <div class="final-wrap">
      <div>${podium(list, (e) => `${e.total}점`, { medal: true, heights: [170, 230, 130] })}</div>
      <div>
        <p class="h-sub" style="margin-bottom:12px">전체 점수</p>
        <div class="bars">${bars || `<p class="muted">아직 점수가 없어요</p>`}</div>
        ${played.length ? `<div class="bar-legend">${played.map((g) => `<span><i style="background:${GAME_COLORS[g]}"></i>${esc(GAMES[g].name)}</span>`).join("")}</div>` : ""}
      </div>
    </div>`;
  setTimeout(() => stage.querySelectorAll(".bar-track > i").forEach((el, i) => { el.style.transitionDelay = `${1.4 + i * 0.03}s`; el.style.width = el.dataset.w + "%"; }), 50);
  setTimeout(() => { if (D.state.phase === "final") play("fanfare"); }, 1650);
  setControls("Cheers to 2026!", [{ label: "로비로", cls: "ghost", on: () => setState({ phase: "lobby" }) }]);
  return {};
}

// ---------- 참가자 관리 ----------
const dlg = $("#dlg");
function renderManage() {
  $("#mlist").innerHTML = plist().map((p) => `<div class="mrow"><span class="dot" style="background:${teamColor(p.pid)}"></span>
    <span>${esc(p.name)} ${p.allowRejoin ? '<small class="gold">(재입장 대기)</small>' : ""}</span>
    <button class="btn ghost" data-re="${p.pid}">재입장 허용</button><button class="btn danger" data-del="${p.pid}">삭제</button></div>`).join("") || `<p class="muted">참가자가 없어요</p>`;
}
$("#manage").addEventListener("click", () => { renderManage(); dlg.showModal(); });
$("#edit-title").addEventListener("click", () => {
  $("#title-in").value = D.title || "";
  dlg.showModal(); $("#title-in").focus();
});
$("#save-title").addEventListener("click", async () => {
  const t = $("#title-in").value.trim().slice(0, 30);
  await set(rref("title"), t || null);   // 비우면 기본 타이틀
  $("#save-title").textContent = "저장됨 ✓";
  setTimeout(() => ($("#save-title").textContent = "타이틀 저장"), 1200);
});
$("#close").addEventListener("click", () => dlg.close());
$("#mlist").addEventListener("click", async (e) => {
  const re = e.target.dataset.re, del = e.target.dataset.del;
  if (re) await update(rref(`players/${re}`), { allowRejoin: true });
  if (del && confirm(`${nameOf(del)} 님을 삭제할까요? 점수도 사라져요.`)) {
    await update(rref(), { [`players/${del}`]: null, [`names/${nameOf(del)}`]: null, [`scores/${del}`]: null });
  }
  renderManage();
});
$("#reset").addEventListener("click", async () => {
  if (!confirm("참가자와 점수를 모두 지우고 처음부터 시작할까요? (타이틀은 유지돼요)")) return;
  const title = D.title || null;
  await remove(rref());
  if (title) await set(rref("title"), title);
  location.reload();
});
