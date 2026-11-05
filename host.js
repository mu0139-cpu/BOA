import {
  CONFIGURED, ROOM, rref, onValue, set, update, remove, now,
  GAMES, GAME_ORDER, TEAM, HANDS, HAND_ICON, beats, rankEntries, REACT_ROUNDS, REACT_PENALTY, esc, setupWarning
} from "./common.js";

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
  const k = keyOf(s);
  if (k !== curKey) { curKey = k; view = build(s); }
  view?.update?.();
}

function build(s) {
  if (s.phase === "lobby") return lobbyView();
  if (s.phase === "intro") return introView(s);
  if (s.phase === "play") return ({ tap: raceView, mole: moleView, react: reactPlayView, minority: minorityPlayView, rps: rpsPlayView })[s.game](s);
  if (s.phase === "wait") return reactWaitView(s);
  if (s.phase === "reveal") return s.game === "minority" ? minorityRevealView(s) : rpsRevealView(s);
  if (s.phase === "result") return resultView(s);
  if (s.phase === "final") return finalView();
  return null;
}

// ---------- 진행 동작 ----------
async function startGame(g) {
  const t = now();
  if (g === "tap" || g === "mole") {
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
  if (g === "tap" || g === "mole") {
    entries = ps.map((p) => ({ pid: p.pid, v: R[g]?.[p.pid] ?? L[g]?.[p.pid] ?? (g === "tap" ? 0 : -99) }));
    better = (a, b) => b.v - a.v;
    label = (v) => (g === "tap" ? `${v}회` : `${v === -99 ? 0 : v}점`);
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
  } else {
    entries = ps.map((p) => ({ pid: p.pid, v: D.rps?.alive?.[p.pid] ? 999 : (D.rps?.elim?.[p.pid] || 0) }));
    better = (a, b) => b.v - a.v;
    label = (v) => (v === 999 ? "최후의 생존" : v ? `${v}라운드 탈락` : "불참");
  }
  return rankEntries(entries, better).map((e) => ({ ...e, name: nameOf(e.pid), team: D.players?.[e.pid]?.team || "", label: label(e.v) }));
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
  if (done.has(k)) return;
  if (s.phase === "play" && t > s.endAt + 1200) {
    done.add(k);
    if (s.game === "tap" || s.game === "mole") finishGame(s.game);
    else if (s.game === "react") {
      if (s.round < REACT_ROUNDS) setState({ phase: "wait", game: "react", round: s.round, nextAt: t + 5000 });
      else finishGame("react");
    } else if (s.game === "minority") revealMinority(s);
    else if (s.game === "rps") revealRps(s);
  }
  if (s.phase === "wait" && t > s.nextAt) { done.add(k); startReactRound(s.round + 1); }
}, 200);

// ---------- 화면: 로비 ----------
function lobbyView() {
  const url = new URL("index.html", location.href).href;
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
  const btns = [{ label: `게임 시작 · ${GAMES[GAME_ORDER[0]].name}`, on: () => setState({ phase: "intro", game: GAME_ORDER[0] }) }];
  GAME_ORDER.slice(1).forEach((g) => btns.push({ label: `${gameNo(g)}. ${GAMES[g].name}`, cls: "ghost", on: () => setState({ phase: "intro", game: g }) }));
  btns.push({ label: "종합 결과", cls: "ghost", on: showFinal });
  setControls("", btns.reverse());
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
function podium(list, valKey) {
  const top = [list.find((e) => e.rank === 2) || list[1], list[0], list.find((e) => e.rank === 3) || list[2]];
  const h = [150, 210, 110];
  return `<div class="podium">${top.map((e, i) => e ? `<div class="pod"><p class="nm" style="color:var(--text)">${esc(e.name)}</p>
    <p class="muted" style="margin-bottom:8px">${esc(valKey(e))}</p><div class="blk" style="height:${h[i]}px">${e.rank}</div></div>` : "").join("")}</div>`;
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
function finalView() {
  const list = D.final || [];
  const champ = list.filter((e) => e.rank === 1).map((e) => e.name).join(", ");
  stage.innerHTML = `<p class="serif gold" style="font-size:32px;text-align:center">FINAL</p>
    <p class="h-title" style="text-align:center;margin-bottom:16px">${champ ? `우승 ${esc(champ)}!` : "최종 순위"}</p>
    ${podium(list, (e) => `${e.total}점`)}
    <div class="rows">${list.slice(3).map((e) => `<div class="row"><span class="rk">${e.rank}</span><span class="nm">${esc(e.name)}</span><span></span><span class="val">${e.total}점</span></div>`).join("")}</div>`;
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
  if (!confirm("참가자와 점수를 모두 지우고 처음부터 시작할까요?")) return;
  await remove(rref());
  location.reload();
});
