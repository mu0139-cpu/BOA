// ---- 효과음 · 배경음 (음원 파일 없이 브라우저에서 직접 만듦) ----
// 브라우저 정책상 화면을 한 번 누른 뒤부터 소리가 납니다.

let ctx = null, master = null, sfxBus = null, bgmBus = null;
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
let sfxOn = store("boa-sfx") !== "0";
let bgmOn = store("boa-bgm") !== "0";
let wantBgm = null;          // 지금 틀어야 할 배경음 이름
let bgm = null;              // { name, step, next, timer }

function ensure() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn ? 0.55 : 0; sfxBus.connect(master);
  bgmBus = ctx.createGain(); bgmBus.gain.value = bgmOn ? 0.16 : 0; bgmBus.connect(master);
  return true;
}

export function unlock() {
  if (!ensure()) return;
  if (ctx.state === "suspended") ctx.resume();
  if (wantBgm && !bgm) startBgm(wantBgm);
}
["pointerdown", "keydown", "touchstart"].forEach((ev) => document.addEventListener(ev, unlock, { capture: true, passive: true }));

const ready = () => ctx && ctx.state === "running";

// 단음 하나
function tone(freq, dur, o = {}) {
  if (!ready()) return;
  const t = o.t ?? ctx.currentTime + (o.at || 0);
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = o.type || "sine";
  osc.frequency.setValueAtTime(freq, t);
  if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
  const v = o.vol ?? 0.4;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + Math.min(0.012, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(o.bus || sfxBus);
  osc.start(t); osc.stop(t + dur + 0.05);
}

// 잡음 (북·바람 소리)
let noiseBuf = null;
function noise(dur, o = {}) {
  if (!ready()) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = o.t ?? ctx.currentTime + (o.at || 0);
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = o.hp ? "highpass" : "lowpass"; f.frequency.value = o.hp || o.lp || 2000;
  if (o.sweep) f.frequency.exponentialRampToValueAtTime(o.sweep, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(o.vol ?? 0.3, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(o.bus || sfxBus);
  src.start(t); src.stop(t + dur + 0.05);
}

const arp = (notes, gap, o) => notes.forEach((f, i) => tone(f, o.dur || 0.16, { ...o, at: (o.at || 0) + i * gap }));

export const sfx = {
  tap:     () => tone(880, 0.05, { type: "square", vol: 0.12 }),
  click:   () => tone(660, 0.07, { type: "triangle", vol: 0.35 }),
  hit:     () => tone(500, 0.09, { type: "triangle", vol: 0.45, slide: 1100 }),
  gold:    () => arp([1047, 1319, 1568, 2093], 0.05, { type: "triangle", vol: 0.3, dur: 0.14 }),
  bomb:    () => { noise(0.45, { vol: 0.7, lp: 700, sweep: 80 }); tone(130, 0.4, { type: "sawtooth", vol: 0.25, slide: 40 }); },
  beep:    () => tone(660, 0.14, { type: "square", vol: 0.18 }),
  go:      () => tone(990, 0.4, { type: "square", vol: 0.22 }),
  end:     () => { tone(440, 0.5, { type: "sawtooth", vol: 0.18 }); tone(330, 0.5, { type: "sawtooth", vol: 0.18 }); },
  whoosh:  () => noise(0.22, { vol: 0.22, hp: 900, sweep: 4000 }),
  drop:    () => tone(1200, 0.5, { type: "sine", vol: 0.25, slide: 300 }),
  chomp:   () => { tone(220, 0.07, { type: "square", vol: 0.2 }); tone(180, 0.07, { type: "square", vol: 0.2, at: 0.11 }); tone(220, 0.07, { type: "square", vol: 0.2, at: 0.22 }); },
  ask:     () => arp([660, 880], 0.09, { type: "triangle", vol: 0.3 }),
  correct: () => arp([784, 1047, 1319], 0.08, { type: "triangle", vol: 0.32, dur: 0.2 }),
  wrong:   () => tone(320, 0.35, { type: "sawtooth", vol: 0.16, slide: 150 }),
  reveal:  () => { noise(0.08, { vol: 0.3, lp: 1500 }); arp([523, 659, 784, 1047], 0.07, { type: "triangle", vol: 0.3, dur: 0.22, at: 0.05 }); },
  fanfare: () => {
    arp([523, 659, 784], 0.12, { type: "square", vol: 0.16, dur: 0.14 });
    tone(1047, 0.7, { type: "square", vol: 0.18, at: 0.4 }); tone(784, 0.7, { type: "triangle", vol: 0.22, at: 0.4 }); tone(659, 0.7, { type: "triangle", vol: 0.2, at: 0.4 });
  },
  drumroll: (sec = 1.6) => {
    if (!ready()) return;
    const n = Math.round(sec * 22);
    for (let i = 0; i < n; i++) noise(0.05, { vol: 0.12 + 0.3 * (i / n), lp: 900, at: i / 22 });
    noise(0.6, { vol: 0.6, lp: 3000, at: sec }); tone(90, 0.5, { type: "sine", vol: 0.5, at: sec, slide: 50 });
  }
};
export function play(name, ...a) { try { sfx[name]?.(...a); } catch (e) {} }

// ---- 배경음: 화음 진행 위에 아르페지오 (calm: 대기·결과 / game: 게임 중) ----
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const SONGS = {
  calm: { bpm: 88,  prog: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], drums: false },
  game: { bpm: 128, prog: [[48, 52, 55], [57, 60, 64], [53, 57, 60], [55, 59, 62]], drums: true }
};
function stepNote(song, step, t) {
  const spb = 60 / song.bpm / 2;                 // 8분음표 길이
  const chord = song.prog[Math.floor(step / 8) % song.prog.length];
  const bus = bgmBus;
  if (step % 4 === 0) tone(midi(chord[0] - 12), spb * 3.6, { type: "triangle", vol: 0.55, t, bus });
  const order = [0, 1, 2, 1, 0, 2, 1, 2];
  tone(midi(chord[order[step % 8]] + 12), spb * 0.95, { type: "sine", vol: 0.28, t, bus });
  if (song.drums) {
    if (step % 4 === 0) tone(110, 0.16, { type: "sine", vol: 0.6, slide: 45, t, bus });
    if (step % 4 === 2) noise(0.1, { vol: 0.25, hp: 1500, t, bus });
    noise(0.03, { vol: 0.08, hp: 6000, t, bus });
  }
  return spb;
}
function startBgm(name) {
  stopBgm();
  if (!name || !SONGS[name] || !ready()) return;
  const song = SONGS[name];
  bgm = { name, step: 0, next: ctx.currentTime + 0.1, timer: null };
  bgm.timer = setInterval(() => {
    if (!bgm || !ready()) return;
    while (bgm.next < ctx.currentTime + 0.2) {
      bgm.next += stepNote(song, bgm.step, bgm.next);
      bgm.step++;
    }
  }, 40);
}
function stopBgm() { if (bgm) { clearInterval(bgm.timer); bgm = null; } }

// 원하는 배경음을 지정 (null = 끄기). 같은 곡이면 이어서 재생
export function setBgm(name) {
  wantBgm = name || null;
  if (bgm?.name === wantBgm) return;
  if (!wantBgm) return stopBgm();
  if (ready()) startBgm(wantBgm);
}

// ---- 켜고 끄기 ----
export const isSfxOn = () => sfxOn;
export const isBgmOn = () => bgmOn;
export function toggleSfx() {
  sfxOn = !sfxOn; store("boa-sfx", sfxOn ? "1" : "0");
  if (sfxBus) sfxBus.gain.value = sfxOn ? 0.55 : 0;
  return sfxOn;
}
export function toggleBgm() {
  bgmOn = !bgmOn; store("boa-bgm", bgmOn ? "1" : "0");
  if (bgmBus) bgmBus.gain.value = bgmOn ? 0.16 : 0;
  return bgmOn;
}
