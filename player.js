import {
  CONFIGURED, ROOM, rref, onValue, set, get, update, now, GAMES, TEAM, HANDS,
  moleSchedule, MOLE_POINTS, TAP_CAP_PER_SEC, REACT_PENALTY, esc, setupWarning
} from "./common.js";

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

// ---------- 화면 틀 ----------
function shell(inner) {
  const team = me ? TEAM[me.team] : null;
  app.innerHTML = `
    <div class="top">
      <span class="serif gold" style="font-size:18px;font-weight:700">BOA GAME</span>
      <span>${me ? `<span class="dot" style="background:${team.color}"></span> ${esc(me.name)}` : ""}</span>
    </div>
    <div class="stage">${inner}</div>`;
  return app.querySelector(".stage");
}

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
    <div class="teams">
      <button class="team-btn" data-team="purple"><span class="team-purple">퍼플팀</span><br><small class="muted">남성</small></button>
      <button class="team-btn" data-team="gold"><span class="team-gold">골드팀</span><br><small class="muted">여성</small></button>
    </div>
    <p class="err" id="err">${esc(msg)}</p>
    <button class="btn" id="go" style="width:100%;max-width:360px">입장하기</button>`);
  const nick = st.querySelector("#nick");
  st.querySelectorAll(".team-btn").forEach((b) => {
    b.addEventListener("click", () => {
      joinTeam = b.dataset.team;
      st.querySelectorAll(".team-btn").forEach((x) => x.classList.remove("sel-purple", "sel-gold"));
      b.classList.add("sel-" + joinTeam);
    });
  });
  st.querySelector("#go").addEventListener("click", async () => {
    const name = nick.value.trim();
    const err = st.querySelector("#err");
    if (name.length < 2) return (err.textContent = "별명을 2자 이상 입력해 주세요.");
    if (/[.#$\[\]\/]/.test(name)) return (err.textContent = "특수문자 . # $ [ ] / 는 쓸 수 없어요.");
    if (!joinTeam) return (err.textContent = "팀을 골라 주세요.");
    const btn = st.querySelector("#go"); btn.disabled = true;
    try {
      const owner = (await get(rref(`names/${name}`))).val();
      if (owner && owner !== pid) {
        const other = (await get(rref(`players/${owner}`))).val();
        if (other && other.allowRejoin) {
          pid = owner; localStorage.setItem(LS, pid);
          await update(rref(`players/${pid}`), { allowRejoin: null, team: joinTeam });
          keepAwake(); listenMe(); return;
        }
        if (other) { btn.disabled = false; return (err.textContent = "이미 쓰는 별명이에요. 다른 별명을 입력해 주세요."); }
      }
      await set(rref(`names/${name}`), pid);
      await set(rref(`players/${pid}`), { name, team: joinTeam, joinedAt: now() });
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
  }
  if (s.phase === "reveal" && s.game === "minority") return minorityReveal(s);
  if (s.phase === "reveal" && s.game === "rps") return rpsReveal(s);
  if (s.phase === "wait") return shell(`<p class="title">${esc(GAMES[s.game]?.name || "")}</p><p class="muted">다음 라운드를 기다리는 중…</p>`);
  if (s.phase === "result") return gameResult(s);
  if (s.phase === "final") return finalResult();
}

function stopCtrl() { if (ctrl) { ctrl.stop?.(); ctrl = null; } }
function startCtrl(fn, s) { if (ctrl) return; ctrl = fn(s) || {}; }

// ---------- 대기 화면 ----------
function lobby() {
  const t = TEAM[me.team];
  shell(`
    <p class="muted">입장 완료</p>
    <p class="big" style="font-size:44px;color:${t.color}">${esc(me.name)}</p>
    <p class="title" style="color:${t.color}">${t.name}</p>
    <p class="muted" style="margin-top:12px">현재 ${playerCount}명 입장<br>진행자가 시작하면 화면이 자동으로 바뀌어요.</p>
    <p class="muted" style="font-size:13px">화면을 켜 둔 채로 기다려 주세요.</p>`);
}

function intro(s) {
  const g = GAMES[s.game];
  shell(`<p class="muted">곧 시작</p><p class="big" style="font-size:40px">${esc(g.name)}</p><p class="title" style="font-size:20px;line-height:1.6">${esc(g.rule)}</p>`);
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
    <button class="tap-btn" id="tap" style="background:${TEAM[me.team].color}">TAP</button>`);
  const info = st.querySelector("#info"), cnt = st.querySelector("#cnt"), btn = st.querySelector("#tap");
  let count = 0, sent = -1, done = false, raf = 0;
  const recent = [];
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const t = now();
    if (done || t < s.startAt || t >= s.endAt) return;
    while (recent.length && recent[0] < t - 1000) recent.shift();
    if (recent.length >= TAP_CAP_PER_SEC) return;
    recent.push(t); count++; cnt.textContent = count;
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
    b.classList.add("hit"); setTimeout(() => b.classList.remove("hit"), 120);
    if (navigator.vibrate) navigator.vibrate(a.type === "bomb" ? 80 : 10);
  }));
  const iv = setInterval(() => { if (score !== sent && !done) { sent = score; set(rref(`live/mole/${pid}`), score); } }, 300);
  const labels = { mole: "+1", gold: "+5", bomb: "폭탄" };
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
        b.dataset.cls = cls; b.className = "hole" + (cls ? " " + cls : ""); b.textContent = a ? labels[a.type] : "";
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
    if (!shownAt) return finish(REACT_PENALTY, "부정출발!");
    const ms = Math.round(performance.now() - shownAt);
    finish(ms, `${ms} ms`);
  });
  const loop = () => {
    const t = now();
    if (!done) {
      const cd = countdownText(s.startAt);
      if (cd) { msg.textContent = cd; pad.style.background = "var(--panel)"; }
      else if (t < s.goAt) { msg.textContent = "기다리세요…"; pad.style.background = "#4A4458"; pad.style.color = "var(--text)"; }
      else if (t < s.endAt) {
        if (!shownAt) { pad.style.background = "var(--gold)"; pad.style.color = "#1C1029"; msg.textContent = "지금!"; shownAt = performance.now(); }
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
    pick = b.dataset.c;
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
      <button class="choice" data-h="scissors">가위</button>
      <button class="choice" data-h="rock">바위</button>
      <button class="choice" data-h="paper">보</button>
    </div>
    <p class="muted" id="info"></p>`);
  const cdEl = st.querySelector("#cd"), info = st.querySelector("#info");
  const btns = [...st.querySelectorAll(".choice")];
  let raf = 0, pick = null;
  btns.forEach((b) => b.addEventListener("click", () => {
    const t = now();
    if (t < s.startAt || t >= s.endAt) return;
    pick = b.dataset.h;
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
  shell(`
    <p class="muted">라운드 ${s.round} 결과</p>
    <p class="title">노트북: ${HANDS[s.hostHand]}</p>
    <p class="muted">나: ${mine ? HANDS[mine] : "선택 안 함"}</p>
    <p class="big" style="color:${alive ? "var(--good)" : "var(--bad)"}">${alive ? "생존!" : "탈락"}</p>
    <p class="muted">${s.revived ? "모두 탈락해서 전원 부활!" : `남은 인원 ${Object.keys(rpsAlive).length}명`}</p>`);
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
