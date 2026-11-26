import {
  CONFIGURED, ROOM, rref, onValue, set, get, update, now, GAMES, TEAM, HANDS,
  moleSchedule, MOLE_POINTS, TAP_CAP_PER_SEC, REACT_PENALTY, esc, setupWarning, HAND_ICON, moleSvg, moleLegend,
  DEFAULT_TITLE, dungiSvg, TTEOK_ROUNDS, tteokRoundCfg, tteokSceneHtml, dungiArt, TTEOK_ART,
  STOP_TARGETS, STOP_SHOW_MS, fmtSec, SHAKE_CAP_PER_SEC
} from "./common.js";
import { play, toggleSfx, isSfxOn } from "./sound.js";

const app = document.getElementById("app");
if (!CONFIGURED) { app.innerHTML = setupWarning(); throw new Error("not configured"); }

const LS = `boa-${ROOM}-pid`;
let pid = localStorage.getItem(LS);
if (!pid) { pid = "p" + Math.random().toString(36).slice(2, 10); localStorage.setItem(LS, pid); }

let me = null;          // {name, team}
let state = null;       // 현재 게임 상태
let stateKey = "";
let ctrl = null;        // 현재 게임 컨트롤러 (정리 함수 보유)
let playerCount = 0;
let rpsAlive = {};
let rpsElim = {};
let joinTeam = null;

// 타이틀은 진행자가 언제든 바꿀 수 있어서 실시간으로 받아 온다
let TITLE = DEFAULT_TITLE;
onValue(rref("title"), (s) => {
  TITLE = s.val() || DEFAULT_TITLE;
  document.title = TITLE;
  const el = document.getElementById("ttl");
  if (el) el.textContent = TITLE;
});

// ---------- 화면 틀 ----------
function shell(inner) {
  const team = me ? TEAM[me.team] : null;
  app.innerHTML = `
    <div class="top">
      <span id="ttl" class="serif gold" style="font-size:18px;font-weight:700">${esc(TITLE)}</span>
      <span style="display:flex;align-items:center;gap:10px">${me ? esc(me.name) : ""}<button id="snd" class="snd-btn" aria-label="효과음 켜기/끄기">${isSfxOn() ? "🔊" : "🔇"}</button></span>
    </div>
    <div class="stage">${inner}</div>`;
  return app.querySelector(".stage");
}

// 효과음 켜기/끄기 (화면이 자주 다시 그려져서 이벤트는 위임으로 받는다)
app.addEventListener("click", (e) => {
  const b = e.target.closest("#snd");
  if (b) { const on = toggleSfx(); b.textContent = on ? "🔊" : "🔇"; if (on) play("click"); }
});

// ---------- 화면 꺼짐 방지 ----------
let wake = null;
async function keepAwake() {
  try { if ("wakeLock" in navigator && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => { wake = null; }); } } catch (e) {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && me) keepAwake(); });

// ---------- 입장 ----------
function renderJoin(msg = "") {
  stopCtrl();
  const st = shell(`
    <p class="serif gold" style="font-size:42px;font-weight:700">BOA</p>
    <p class="title">연말 게임에 참가하기</p>
    <div class="field">
      <label for="nick" class="muted">별명 (2~8자)</label>
      <input id="nick" maxlength="8" autocomplete="off" placeholder="예: 절세왕">
    </div>
    <p class="err" id="err">${esc(msg)}</p>
    <button class="btn" id="go" style="width:100%;max-width:360px">입장하기</button>`);
  const nick = st.querySelector("#nick");
  st.querySelector("#go").addEventListener("click", async () => {
    const name = nick.value.trim();
    const err = st.querySelector("#err");
    if (name.length < 2) return (err.textContent = "별명을 2자 이상 입력해 주세요.");
    if (/[.#$\[\]\/]/.test(name)) return (err.textContent = "특수문자 . # $ [ ] / 는 쓸 수 없어요.");
    const btn = st.querySelector("#go"); btn.disabled = true;
    try {
      const owner = (await get(rref(`names/${name}`))).val();
      if (owner && owner !== pid) {
        const other = (await get(rref(`players/${owner}`))).val();
        if (other && other.allowRejoin) {
          pid = owner; localStorage.setItem(LS, pid);
          await update(rref(`players/${pid}`), { allowRejoin: null });
          keepAwake(); listenMe(); return;
        }
        if (other) { btn.disabled = false; return (err.textContent = "이미 쓰는 별명이에요. 다른 별명을 입력해 주세요."); }
      }
      await set(rref(`names/${name}`), pid);
      await set(rref(`players/${pid}`), { name, joinedAt: now() });
      keepAwake(); listenMe();
    } catch (e) {
      btn.disabled = false; err.textContent = "연결이 불안정해요. 다시 눌러 주세요.";
    }
  });
}

// ---------- 내 정보 / 상태 구독 ----------
let listening = false;
function listenMe() {
  if (listening) return; listening = true;
  onValue(rref(`players/${pid}`), (s) => {
    const v = s.val();
    if (!v) { me = null; renderJoin(); return; }
    const first = !me; me = v;
    if (first) render(true);
  });
  onValue(rref("players"), (s) => { playerCount = Object.keys(s.val() || {}).length; if (state?.phase === "lobby" || !state) render(true); });
  onValue(rref("state"), (s) => { state = s.val() || { phase: "lobby" }; render(false); });
  onValue(rref("rps"), (s) => { const v = s.val() || {}; rpsAlive = v.alive || {}; rpsElim = v.elim || {}; if (state?.game === "rps") { stopCtrl(); render(true); } });
}

function keyOf(s) { return [s.phase, s.game, s.round, s.q, s.startAt].join("|"); }

function render(force) {
  if (!me) return;
  if (!state) state = { phase: "lobby" };
  const k = keyOf(state);
  if (!force && k === stateKey) return;
  if (k !== stateKey) stopCtrl();
  stateKey = k;
  const s = state;
  if (s.phase === "lobby") return lobby();
  if (s.phase === "intro") return intro(s);
  if (s.phase === "play") {
    if (s.game === "tap") return startCtrl(tapGame, s);
    if (s.game === "mole") return startCtrl(moleGame, s);
    if (s.game === "react") return startCtrl(reactGame, s);
    if (s.game === "minority") return startCtrl(minorityGame, s);
    if (s.game === "rps") return startCtrl(rpsGame, s);
    if (s.game === "tteok") return startCtrl(tteokGame, s);
    if (s.game === "stop") return startCtrl(stopGame, s);
    if (s.game === "shake") return startCtrl(shakeGame, s);
  }
  if (s.phase === "reveal" && s.game === "stop") return stopReveal(s);
  if (s.phase === "reveal" && s.game === "minority") return minorityReveal(s);
  if (s.phase === "reveal" && s.game === "rps") return rpsReveal(s);
  if (s.phase === "reveal" && s.game === "tteok") return tteokReveal(s);
  if (s.phase === "wait") return shell(`<p class="title">${esc(GAMES[s.game]?.name || "")}</p><p class="muted">다음 라운드를 기다리는 중…</p>`);
  if (s.phase === "result") return gameResult(s);
  if (s.phase === "final") return finalResult();
}

function stopCtrl() { if (ctrl) { ctrl.stop?.(); ctrl = null; } }
function startCtrl(fn, s) { if (ctrl) return; ctrl = fn(s) || {}; }

// ---------- 대기 화면 ----------
function lobby() {
  shell(`
    <p class="muted">입장 완료</p>
    <p class="big gold" style="font-size:44px">${esc(me.name)}</p>
    <p class="muted" style="margin-top:12px">현재 ${playerCount}명 입장<br>진행자가 시작하면 화면이 자동으로 바뀌어요.</p>
    <p class="muted" style="font-size:13px">화면을 켜 둔 채로 기다려 주세요.</p>`);
}

function intro(s) {
  const g = GAMES[s.game];
  const st = shell(`<p class="muted">곧 시작</p><p class="big" style="font-size:40px">${esc(g.name)}</p><p class="title" style="font-size:20px;line-height:1.6">${esc(g.rule)}</p>${s.game === "mole" ? moleLegend(82, 15) : ""}${s.game === "tteok" ? `<div class="dungi-preview">${dungiArt(TTEOK_ART.dungi, "happy")}</div>` : ""}${s.game === "stop" ? `<p class="muted">목표: ${STOP_TARGETS.map((t) => t + "초").join(" → ")}</p>` : ""}${s.game === "shake" ? shakeReadyHtml() : ""}`);
  if (s.game === "shake") bindShakeReady(st);
}

// ---------- 흔들기 센서 준비 (아이폰은 버튼을 눌러 허용해야 함) ----------
let motionState = "unknown";   // unknown | granted | denied | none
const needsMotionPermission = () => typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function";
function shakeReadyHtml() {
  if (typeof DeviceMotionEvent === "undefined") { motionState = "none"; return `<p class="muted">이 폰은 흔들기 센서가 없어서 화면 연타로 참여해요</p>`; }
  if (!needsMotionPermission()) { motionState = "granted"; return `<p class="title" style="font-size:22px;color:var(--good)">📳 준비 완료! 시작하면 흔드세요</p>`; }
  if (motionState === "granted") return `<p class="title" style="font-size:22px;color:var(--good)">📳 센서 허용 완료!</p>`;
  return `<button class="btn" id="motion-ok" style="width:100%;max-width:360px;font-size:20px">📳 흔들기 준비하기 (센서 허용)</button><p class="muted" id="motion-msg" style="font-size:14px">아이폰은 이 버튼을 눌러 ‘동작 및 방향’ 접근을 허용해 주세요</p>`;
}
function bindShakeReady(st) {
  const b = st.querySelector("#motion-ok");
  if (!b) return;
  b.addEventListener("click", async () => {
    try {
      const r = await DeviceMotionEvent.requestPermission();
      motionState = r === "granted" ? "granted" : "denied";
    } catch (e) { motionState = "denied"; }
    if (motionState === "granted") { play("correct"); b.outerHTML = `<p class="title" style="font-size:22px;color:var(--good)">📳 센서 허용 완료!</p>`; st.querySelector("#motion-msg")?.remove(); }
    else { play("wrong"); st.querySelector("#motion-msg").textContent = "허용되지 않았어요. 게임 중에는 화면을 연타해서 참여할 수 있어요."; }
  });
}

// 공통: 카운트다운 문구
function countdownText(startAt) {
  const left = Math.ceil((startAt - now()) / 1000);
  return left > 0 ? String(left) : null;
}
function late(s) { return s.endAt && now() > s.endAt + 1500; }

// ---------- 게임 1 : 연타 달리기 ----------
function tapGame(s) {
  if (late(s)) { shell(`<p class="title">이번 게임은 이미 진행 중이에요</p><p class="muted">다음 게임부터 참여해요.</p>`); return; }
  const st = shell(`
    <p class="muted" id="info">준비</p>
    <p class="big" id="cnt">0</p>
    <button class="tap-btn" id="tap" style="background:var(--gold)">TAP</button>`);
  const info = st.querySelector("#info"), cnt = st.querySelector("#cnt"), btn = st.querySelector("#tap");
  let count = 0, sent = -1, done = false, raf = 0;
  const recent = [];
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const t = now();
    if (done || t < s.startAt || t >= s.endAt) return;
    while (recent.length && recent[0] < t - 1000) recent.shift();
    if (recent.length >= TAP_CAP_PER_SEC) return;
    recent.push(t); count++; cnt.textContent = count; play("tap");
    if (navigator.vibrate) navigator.vibrate(8);
  });
  const iv = setInterval(() => { if (count !== sent && !done) { sent = count; set(rref(`live/tap/${pid}`), count); } }, 250);
  const loop = () => {
    const t = now();
    const cd = countdownText(s.startAt);
    if (cd) info.textContent = `${cd}초 후 시작`;
    else if (t < s.endAt) info.textContent = `남은 시간 ${((s.endAt - t) / 1000).toFixed(1)}초`;
    else if (!done) {
      done = true; info.textContent = "끝!"; btn.disabled = true; btn.textContent = "완료";
      set(rref(`live/tap/${pid}`), count); set(rref(`results/tap/${pid}`), count);
    }
    raf = requestAnimationFrame(loop);
  };
  loop();
  return { stop() { cancelAnimationFrame(raf); clearInterval(iv); } };
}

// ---------- 게임 2 : 두더지잡기 ----------
function moleGame(s) {
  if (late(s)) { shell(`<p class="title">이번 게임은 이미 진행 중이에요</p><p class="muted">다음 게임부터 참여해요.</p>`); return; }
  const ev = moleSchedule(s.seed, s.endAt - s.startAt);
  const st = shell(`
    <p class="muted" id="info">준비</p>
    <p class="big" id="sc">0</p>
    <div class="grid9">${Array.from({ length: 9 }, (_, i) => `<button class="hole" data-h="${i}"></button>`).join("")}</div>`);
  const info = st.querySelector("#info"), sc = st.querySelector("#sc");
  const holes = [...st.querySelectorAll(".hole")];
  const hit = new Set();
  let score = 0, sent = null, done = false, raf = 0;
  const active = (h, el) => ev.find((e) => e.hole === h && !hit.has(e.id) && el >= e.t && el < e.t + e.dur);
  holes.forEach((b) => b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (done) return;
    const el = now() - s.startAt;
    const a = active(Number(b.dataset.h), el);
    if (!a) return;
    hit.add(a.id); score += MOLE_POINTS[a.type]; sc.textContent = score;
    play(a.type === "bomb" ? "bomb" : a.type === "gold" ? "gold" : "hit");
    b.classList.add("hit"); setTimeout(() => b.classList.remove("hit"), 120);
    if (navigator.vibrate) navigator.vibrate(a.type === "bomb" ? 80 : 10);
  }));
  const iv = setInterval(() => { if (score !== sent && !done) { sent = score; set(rref(`live/mole/${pid}`), score); } }, 300);
  const pics = { mole: moleSvg("mole"), gold: moleSvg("gold"), bomb: moleSvg("bomb") };
  const loop = () => {
    const t = now();
    const cd = countdownText(s.startAt);
    const el = t - s.startAt;
    if (cd) info.textContent = `${cd}초 후 시작`;
    else if (t < s.endAt) info.textContent = `남은 시간 ${Math.ceil((s.endAt - t) / 1000)}초`;
    holes.forEach((b, h) => {
      const a = !cd && t < s.endAt ? active(h, el) : null;
      const cls = a ? a.type : "";
      if (b.dataset.cls !== cls) {
        b.dataset.cls = cls; b.className = "hole" + (cls ? " " + cls : ""); b.innerHTML = a ? pics[a.type] : "";
      }
    });
    if (t >= s.endAt && !done) {
      done = true; info.textContent = "끝!";
      set(rref(`live/mole/${pid}`), score); set(rref(`results/mole/${pid}`), score);
    }
    raf = requestAnimationFrame(loop);
  };
  loop();
  return { stop() { cancelAnimationFrame(raf); clearInterval(iv); } };
}

// ---------- 게임 3 : 번개 터치 ----------
function reactGame(s) {
  if (late(s)) { shell(`<p class="title">이번 라운드는 지나갔어요</p><p class="muted">다음 라운드를 기다려 주세요.</p>`); return; }
  const st = shell(`<p class="muted">번개 터치 · 라운드 ${s.round}/3</p><div class="react-pad" id="pad"><span id="msg">준비</span><small id="sub" class="muted" style="font-size:16px;font-weight:500"></small></div>`);
  const pad = st.querySelector("#pad"), msg = st.querySelector("#msg"), sub = st.querySelector("#sub");
  let shownAt = 0, done = false, raf = 0;
  const finish = (ms, text) => {
    done = true; msg.textContent = text; sub.textContent = "다음 라운드를 기다려 주세요";
    pad.style.background = "var(--panel)"; pad.style.color = "var(--text)";
    set(rref(`results/react/r${s.round}/${pid}`), ms);
  };
  pad.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (done) return;
    const t = now();
    if (t < s.startAt) return;
    if (!shownAt) { play("wrong"); return finish(REACT_PENALTY, "부정출발!"); }
    const ms = Math.round(performance.now() - shownAt);
    play("correct");
    finish(ms, `${ms} ms`);
  });
  const loop = () => {
    const t = now();
    if (!done) {
      const cd = countdownText(s.startAt);
      if (cd) { msg.textContent = cd; pad.style.background = "var(--panel)"; }
      else if (t < s.goAt) { msg.textContent = "기다리세요…"; pad.style.background = "#4A4458"; pad.style.color = "var(--text)"; }
      else if (t < s.endAt) {
        if (!shownAt) { pad.style.background = "var(--gold)"; pad.style.color = "#1C1029"; msg.textContent = "눌러!"; msg.style.fontSize = "80px"; shownAt = performance.now(); }
      } else finish(REACT_PENALTY, "시간 초과");
    }
    raf = requestAnimationFrame(loop);
  };
  loop();
  return { stop() { cancelAnimationFrame(raf); } };
}

// ---------- 게임 4 : 눈치 소수결 ----------
function minorityGame(s) {
  if (late(s)) { shell(`<p class="title">이번 문제는 지나갔어요</p><p class="muted">다음 문제를 기다려 주세요.</p>`); return; }
  const st = shell(`
    <p class="muted">문제 ${s.q + 1}/${s.total}</p>
    <p class="title" style="font-size:24px;line-height:1.4">${esc(s.question)}</p>
    <div class="choice-row">
      <button class="choice" data-c="a">${esc(s.a)}</button>
      <button class="choice" data-c="b">${esc(s.b)}</button>
    </div>
    <p class="muted" id="info"></p>`);
  const info = st.querySelector("#info");
  const btns = [...st.querySelectorAll(".choice")];
  let pick = null, raf = 0;
  btns.forEach((b) => b.addEventListener("click", () => {
    const t = now();
    if (t < s.startAt || t >= s.endAt) return;
    pick = b.dataset.c; play("click");
    btns.forEach((x) => x.classList.toggle("on", x === b));
    set(rref(`results/minority/q${s.q}/${pid}`), pick);
  }));
  const loop = () => {
    const t = now();
    const cd = countdownText(s.startAt);
    if (cd) info.textContent = `${cd}초 후 선택 시작`;
    else if (t < s.endAt) info.textContent = `남은 시간 ${Math.ceil((s.endAt - t) / 1000)}초 · 바꿀 수 있어요`;
    else { info.textContent = pick ? "선택 완료 · 결과를 기다리는 중" : "시간 종료 · 선택하지 않았어요"; btns.forEach((x) => (x.disabled = true)); }
    raf = requestAnimationFrame(loop);
  };
  loop();
  return { stop() { cancelAnimationFrame(raf); } };
}

async function minorityReveal(s) {
  const mine = (await get(rref(`results/minority/q${s.q}/${pid}`))).val();
  if (keyOf(state) !== keyOf(s)) return;
  const label = mine ? (mine === "a" ? s.a : s.b) : "선택 안 함";
  const won = mine && s.winner === mine;
  play(won ? "correct" : "wrong");
  shell(`
    <p class="muted">문제 ${s.q + 1} 결과</p>
    <p class="title">${esc(s.a)} ${s.countA}명 · ${esc(s.b)} ${s.countB}명</p>
    <p class="muted">내 선택: ${esc(label)}</p>
    <p class="big" style="color:${won ? "var(--good)" : "var(--muted)"}">${won ? "+1점" : "0점"}</p>
    <p class="muted">${s.winner ? "" : "동점이라 모두 0점"}</p>`);
}

// ---------- 게임 5 : 가위바위보 서바이벌 ----------
function rpsGame(s) {
  if (!rpsAlive[pid]) {
    shell(`<p class="title">탈락</p><p class="muted">${rpsElim[pid] ? rpsElim[pid] + "라운드에서 탈락했어요." : "이번 게임에 참가하지 못했어요."}<br>화면에서 생존자를 응원해 주세요!</p>`);
    return;
  }
  if (late(s)) { shell(`<p class="title">이번 라운드는 지나갔어요</p>`); return; }
  const st = shell(`
    <p class="muted">라운드 ${s.round} · 생존 ${Object.keys(rpsAlive).length}명</p>
    <p class="big" id="cd" style="font-size:40px">가위바위…</p>
    <div class="choice-row" style="grid-template-columns:repeat(3,1fr)">
      <button class="choice hand" data-h="scissors"><span class="hand-ic">${HAND_ICON.scissors}</span>가위</button>
      <button class="choice hand" data-h="rock"><span class="hand-ic">${HAND_ICON.rock}</span>바위</button>
      <button class="choice hand" data-h="paper"><span class="hand-ic">${HAND_ICON.paper}</span>보</button>
    </div>
    <p class="muted" id="info"></p>`);
  const cdEl = st.querySelector("#cd"), info = st.querySelector("#info");
  const btns = [...st.querySelectorAll(".choice")];
  let raf = 0, pick = null;
  btns.forEach((b) => b.addEventListener("click", () => {
    const t = now();
    if (t < s.startAt || t >= s.endAt) return;
    pick = b.dataset.h; play("click");
    btns.forEach((x) => x.classList.toggle("on", x === b));
    set(rref(`results/rps/r${s.round}/${pid}`), pick);
  }));
  const loop = () => {
    const t = now();
    const cd = countdownText(s.startAt);
    if (cd) { cdEl.textContent = cd; info.textContent = "곧 고를 수 있어요"; }
    else if (t < s.endAt) { cdEl.textContent = "골라요!"; info.textContent = `남은 시간 ${Math.ceil((s.endAt - t) / 1000)}초`; }
    else { cdEl.textContent = "보!"; info.textContent = pick ? `${HANDS[pick]} 냈어요 · 결과를 기다리는 중` : "선택하지 않았어요"; btns.forEach((x) => (x.disabled = true)); }
    raf = requestAnimationFrame(loop);
  };
  loop();
  return { stop() { cancelAnimationFrame(raf); } };
}

async function rpsReveal(s) {
  const mine = (await get(rref(`results/rps/r${s.round}/${pid}`))).val();
  if (keyOf(state) !== keyOf(s)) return;
  const alive = !!rpsAlive[pid];
  const wasIn = alive || rpsElim[pid] === s.round;
  if (!wasIn) { shell(`<p class="title">탈락</p><p class="muted">화면에서 생존자를 응원해 주세요!</p>`); return; }
  play(alive ? "correct" : "wrong");
  shell(`
    <p class="muted">라운드 ${s.round} 결과</p>
    <p style="font-size:72px;line-height:1">${HAND_ICON[s.hostHand]}</p>
    <p class="title">노트북: ${HANDS[s.hostHand]}</p>
    <p class="muted">나: ${mine ? HAND_ICON[mine] + " " + HANDS[mine] : "선택 안 함"}</p>
    <p class="big" style="color:${alive ? "var(--good)" : "var(--bad)"}">${alive ? "생존!" : "탈락"}</p>
    <p class="muted">${s.revived ? "모두 탈락해서 전원 부활!" : `남은 인원 ${Object.keys(rpsAlive).length}명`}</p>`);
}

// ---------- 게임 7 : 정지! 타이머 ----------
function stopGame(s) {
  if (late(s)) { shell(`<p class="title">이번 라운드는 지나갔어요</p><p class="muted">다음 라운드를 기다려 주세요.</p>`); return; }
  const st = shell(`
    <p class="muted">정지! 타이머 · 라운드 ${s.round}/${STOP_TARGETS.length}</p>
    <p class="title">목표 <span class="gold">${s.target}.00</span>초</p>
    <p class="big" id="clk" style="font-size:64px;font-variant-numeric:tabular-nums">0.00</p>
    <button class="tap-btn" id="stop" style="background:var(--bad);color:#fff;font-size:44px" disabled>STOP</button>
    <p class="muted" id="info"></p>`);
  const clk = st.querySelector("#clk"), btn = st.querySelector("#stop"), info = st.querySelector("#info");
  let done = false, raf = 0;
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const t = now();
    if (done || t < s.startAt || t >= s.endAt) return;
    done = true;
    const ms = Math.round(t - s.startAt);
    set(rref(`results/stop/r${s.round}/${pid}`), ms);
    play("click"); if (navigator.vibrate) navigator.vibrate(30);
    btn.disabled = true; btn.textContent = "완료";
    clk.textContent = fmtSec(ms); clk.style.color = "var(--gold)";
    info.textContent = `${fmtSec(ms)}초에 멈췄어요! 결과는 화면에서`;
  });
  const loop = () => {
    const t = now(), ms = t - s.startAt;
    if (!done) {
      if (ms < 0) { clk.textContent = String(Math.ceil(-ms / 1000)); info.textContent = "곧 시작!"; }
      else if (t < s.endAt) {
        btn.disabled = false;
        clk.textContent = ms < STOP_SHOW_MS ? fmtSec(ms) : "??.??";
        info.textContent = ms < STOP_SHOW_MS ? "곧 숫자가 사라져요" : "마음속으로 세다가 목표 시간에 STOP!";
      } else { done = true; btn.disabled = true; clk.textContent = "시간 초과"; info.textContent = "이번 라운드는 못 멈췄어요"; play("wrong"); }
    }
    raf = requestAnimationFrame(loop);
  };
  loop();
  return { stop() { cancelAnimationFrame(raf); } };
}

async function stopReveal(s) {
  const mine = (await get(rref(`results/stop/r${s.round}/${pid}`))).val();
  if (keyOf(state) !== keyOf(s)) return;
  const err = mine == null ? null : mine - s.target * 1000;
  const good = err != null && Math.abs(err) < 500;
  play(good ? "correct" : "wrong");
  shell(`
    <p class="muted">라운드 ${s.round} 결과 · 목표 ${s.target}.00초</p>
    <p class="big" style="font-size:56px">${mine == null ? "못 멈춤" : fmtSec(mine) + "초"}</p>
    <p class="title" style="color:${good ? "var(--good)" : "var(--muted)"}">${err == null ? "오차 5초로 계산돼요" : `오차 ${err >= 0 ? "+" : "−"}${fmtSec(Math.abs(err))}초`}</p>
    <p class="muted">순위는 노트북 화면에서 확인하세요</p>`);
}

// ---------- 게임 8 : 폰 흔들기 레이스 ----------
function shakeGame(s) {
  if (late(s)) { shell(`<p class="title">이번 게임은 이미 진행 중이에요</p><p class="muted">다음 게임부터 참여해요.</p>`); return; }
  const st = shell(`
    <p class="muted" id="info">준비</p>
    <p style="font-size:84px;line-height:1" id="horse">🏇</p>
    <p class="big" id="cnt">0</p>
    <p class="title" id="msg" style="font-size:20px">폰을 꼭 쥐고 흔들 준비!</p>
    <button class="tap-btn" id="tapalt" style="background:var(--panel-2);color:var(--text);font-size:22px;display:none">센서가 안 되면<br>여기를 연타!</button>`);
  const info = st.querySelector("#info"), cnt = st.querySelector("#cnt"), msg = st.querySelector("#msg"), alt = st.querySelector("#tapalt"), horse = st.querySelector("#horse");
  let count = 0, sent = -1, done = false, raf = 0, lastShake = 0, gotMotion = false, lastMag = 9.8;
  const recent = [];
  const add = () => {
    const t = now();
    if (done || t < s.startAt || t >= s.endAt) return;
    while (recent.length && recent[0] < t - 1000) recent.shift();
    if (recent.length >= SHAKE_CAP_PER_SEC) return;
    recent.push(t); count++; cnt.textContent = count; play("tap");
    horse.style.transform = `translateX(${count % 2 ? 6 : -6}px)`;
  };
  const onMotion = (e) => {
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a || a.x == null) return;
    gotMotion = true;
    const mag = Math.sqrt(a.x * a.x + a.y * a.y + (a.z || 0) * (a.z || 0));
    const t = performance.now();
    // 세게 흔들 때만 1번으로 센다 (가속도 급변 + 0.12초 간격)
    if (Math.abs(mag - lastMag) > 11 && t - lastShake > 120) { lastShake = t; add(); }
    lastMag = mag;
  };
  window.addEventListener("devicemotion", onMotion);
  alt.addEventListener("pointerdown", (e) => { e.preventDefault(); add(); });
  const iv = setInterval(() => { if (count !== sent && !done) { sent = count; set(rref(`live/shake/${pid}`), count); } }, 300);
  const loop = () => {
    const t = now();
    const cd = countdownText(s.startAt);
    if (cd) info.textContent = `${cd}초 후 시작`;
    else if (t < s.endAt) {
      info.textContent = `남은 시간 ${Math.ceil((s.endAt - t) / 1000)}초`;
      msg.textContent = "흔들어! 흔들어!";
      // 시작 2초가 지나도 센서 신호가 없으면 연타 버튼을 보여 준다
      if (!gotMotion && t - s.startAt > 2000) alt.style.display = "";
    } else if (!done) {
      done = true; info.textContent = "끝!"; msg.textContent = `${count}번 흔들었어요!`; alt.disabled = true;
      set(rref(`live/shake/${pid}`), count); set(rref(`results/shake/${pid}`), count);
    }
    raf = requestAnimationFrame(loop);
  };
  loop();
  return { stop() { cancelAnimationFrame(raf); clearInterval(iv); window.removeEventListener("devicemotion", onMotion); } };
}

// ---------- 게임 6 : 떡먹은둥이찾기 ----------
function tteokGame(s) {
  const cfg = tteokRoundCfg(s.seed, s.round);
  if (now() > s.endAt + 1500) { shell(`<p class="title">이번 라운드는 지나갔어요</p><p class="muted">다음 라운드를 기다려 주세요.</p>`); return; }
  const st = shell(`
    <p class="muted">떡먹은둥이찾기 · 라운드 ${s.round}/${TTEOK_ROUNDS}</p>
    <div id="scene" class="scene-wrap"></div>
    <p class="title" id="msg" style="font-size:22px"></p>
    <div class="tt-slots" style="grid-template-columns:repeat(${cfg.n},1fr)">${Array.from({ length: cfg.n }, (_, i) => `<button class="tt-slot" data-s="${i}" disabled>${i + 1}</button>`).join("")}</div>
    <p class="muted" id="info"></p>`);
  const scene = st.querySelector("#scene"), msg = st.querySelector("#msg"), info = st.querySelector("#info");
  const slots = [...st.querySelectorAll(".tt-slot")];
  let picked = null, raf = 0;
  slots.forEach((b) => b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const ms = now() - s.startAt;
    if (picked !== null || ms < cfg.ansAt || ms >= cfg.total) return;
    picked = Number(b.dataset.s); play("click");
    slots.forEach((x) => x.classList.toggle("on", x === b));
    set(rref(`results/tteok/r${s.round}/${pid}`), { s: picked, t: Math.round(ms - cfg.ansAt) });
    if (navigator.vibrate) navigator.vibrate(10);
  }));
  const loop = () => {
    const ms = now() - s.startAt;
    const cd = countdownText(s.startAt);
    scene.innerHTML = tteokSceneHtml(cfg, Math.max(0, ms));
    const inAnswer = !cd && ms >= cfg.ansAt && ms < cfg.total;
    slots.forEach((b) => (b.disabled = !(inAnswer && picked === null)));
    if (cd) { msg.textContent = "곧 시작!"; info.textContent = `${cd}초 후 시작`; }
    else if (ms < cfg.dropEnd) { msg.textContent = "둥이가 떡을 먹어요!"; info.textContent = ""; }
    else if (ms < cfg.ansAt) { msg.textContent = "둥이들이 섞여요! 잘 보세요"; info.textContent = ""; }
    else if (ms < cfg.total) { msg.textContent = "떡을 먹은 둥이는 어디?"; info.textContent = picked === null ? `남은 시간 ${Math.ceil((cfg.total - ms) / 1000)}초` : "답을 보냈어요"; }
    else { msg.textContent = picked === null ? "시간 종료" : "답을 보냈어요"; info.textContent = "결과는 화면에서 확인하세요"; }
    raf = requestAnimationFrame(loop);
  };
  loop();
  return { stop() { cancelAnimationFrame(raf); } };
}

async function tteokReveal(s) {
  const cfg = tteokRoundCfg(s.seed, s.round);
  const mine = (await get(rref(`results/tteok/r${s.round}/${pid}`))).val();
  if (keyOf(state) !== keyOf(s)) return;
  const ok = !!mine && mine.s === cfg.answer;
  play(ok ? "correct" : "wrong");
  shell(`
    <p class="muted">라운드 ${s.round} 결과</p>
    <p class="title">정답은 ${cfg.answer + 1}번 자리!</p>
    <p class="big" style="color:${ok ? "var(--good)" : "var(--bad)"};font-size:52px">${ok ? "정답!" : mine ? "아쉬워요" : "답 안 함"}</p>
    <p class="muted">${mine ? `내 답: ${mine.s + 1}번` : "노트북 화면에서 순위를 확인하세요"}</p>`);
}

// ---------- 결과 ----------
async function gameResult(s) {
  const list = (await get(rref(`gameResults/${s.game}`))).val() || [];
  if (keyOf(state) !== keyOf(s)) return;
  const mine = list.find((x) => x.pid === pid);
  shell(`
    <p class="muted">${esc(GAMES[s.game].name)} 결과</p>
    ${mine ? `<p class="big">${mine.rank}위</p><p class="title">+${mine.points}점</p><p class="muted">${esc(mine.label || "")}</p>`
           : `<p class="title">이번 게임 기록이 없어요</p>`}
    <p class="muted">노트북 화면에서 순위를 확인하세요</p>`);
}

async function finalResult() {
  const list = (await get(rref("final"))).val() || [];
  if (state.phase !== "final") return;
  const mine = list.find((x) => x.pid === pid);
  shell(`
    <p class="serif gold" style="font-size:28px">FINAL</p>
    ${mine ? `<p class="big">${mine.rank}위</p><p class="title">총 ${mine.total}점</p>` : `<p class="title">최종 결과</p>`}
    <p class="muted">함께해 주셔서 감사합니다!<br>Cheers to 2026</p>`);
}

// ---------- 시작 ----------
(async () => {
  const v = (await get(rref(`players/${pid}`))).val();
  if (v) { me = v; keepAwake(); listenMe(); } else renderJoin();
})();
