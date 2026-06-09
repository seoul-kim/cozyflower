import { FLOWERS } from "./flowers.js";
import { store } from "./store.js";
import { membersWithFlower, countByGrade } from "./aggregate.js";
import { RANKS, RANK_ORDER, rankOf } from "./ranks.js";

// 정렬본 (보기/입력 공통): 등급 우선(빨간꽃 UR → 노란꽃 SSR), 같은 등급 내 가나다 순
const GRADE_ORDER = { UR: 0, SSR: 1, SR: 2 };
const FLOWERS_SORTED = [...FLOWERS].sort((a, b) => {
  const byGrade = (GRADE_ORDER[a.grade] ?? 9) - (GRADE_ORDER[b.grade] ?? 9);
  return byGrade !== 0 ? byGrade : a.name.localeCompare(b.name, "ko");
});

let viewGrade = "all";
let inputGrade = "all";
let viewMember = "all"; // 길드원별 보기 ("all"이면 전체)
let yieldOpen = true; // 양보 안내 패널 펼침 여부 (기본 펼침)

// 길드 공용 데이터 (로그인 후 서버에서 로드). 입장 비번은 1회 입력 후 기기에 기억.
let serverMembers = null;
let serverMode = false;
let guildPw = "";
let priorityMap = {}; // { flowerId: 우선 진행자 닉네임 }
function getAllMembers() {
  return serverMembers ?? store.getAllMembers();
}
function getMemberFlowers(name) {
  const entry = getAllMembers()[String(name).trim()];
  return entry && Array.isArray(entry.flowers) ? entry.flowers.slice() : [];
}

// ── 공유 링크 인코딩 ─────────────────────────────────────────
// 링크를 짧게: (1) 콤팩트 형태로 변환 — {닉:{flowers:[id]}} → [[닉,[번호]]],
//             (2) gzip 압축(지원 시), (3) URL-safe base64.
// 접두사로 형식 구분: "g"=gzip+콤팩트, "c"=콤팩트, 그 외=구버전(전체 JSON).

function bytesToB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function gzipBytes(bytes) {
  const cs = new CompressionStream("gzip");
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(buf);
}
async function gunzipBytes(bytes) {
  const ds = new DecompressionStream("gzip");
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

function membersToCompact(members) {
  return Object.entries(members).map(([name, d]) => [
    name,
    (Array.isArray(d?.flowers) ? d.flowers : [])
      .map((id) => Number(String(id).replace(/\D/g, "")))
      .filter((n) => n > 0),
  ]);
}
function compactToMembers(arr) {
  const out = {};
  for (const [name, nums] of arr) {
    out[String(name)] = {
      flowers: (Array.isArray(nums) ? nums : []).map((n) => "flower-" + String(n).padStart(2, "0")),
    };
  }
  return out;
}

async function encodeShare(members) {
  const raw = new TextEncoder().encode(JSON.stringify(membersToCompact(members)));
  if (typeof CompressionStream !== "undefined") {
    return "g" + bytesToB64url(await gzipBytes(raw));
  }
  return "c" + bytesToB64url(raw);
}
async function decodeShare(str) {
  const tag = str[0];
  if (tag === "g" || tag === "c") {
    let raw = b64urlToBytes(str.slice(1));
    if (tag === "g") raw = await gunzipBytes(raw);
    const arr = JSON.parse(new TextDecoder().decode(raw));
    if (!Array.isArray(arr)) throw new Error("bad");
    return compactToMembers(arr);
  }
  // 구버전: 전체 JSON을 그대로 base64url 한 형식 (기존 링크 호환)
  const parsed = JSON.parse(new TextDecoder().decode(b64urlToBytes(str)));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad");
  return parsed;
}

function chipBarHtml(active, counts) {
  const defs = [
    ["all", `전체 ${counts.all}`],
    ["UR", `🔴 빨간꽃 ${counts.UR}`],
    ["SSR", `🟡 노란꽃 ${counts.SSR}`],
    ["SR", `🟣 보라꽃 ${counts.SR}`],
  ];
  return `<div class="grade-chips">` +
    defs.map(([k, l]) => `<button class="chip${active === k ? " active" : ""}" data-grade="${k}">${l}</button>`).join("") +
    `</div>`;
}

const tabs = document.querySelectorAll(".tab");
const screens = {
  view: document.getElementById("view-screen"),
  input: document.getElementById("input-screen"),
};

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle("active", key === name);
  }
  for (const tab of tabs) {
    tab.classList.toggle("active", tab.dataset.view === name);
  }
  if (name === "view") renderView();
  if (name === "input") renderInput();
}

// 보유자 있는 꽃만 (정렬: 등급 우선 → 가나다). 보기 렌더·이미지 저장 공통
function getVisibleFlowers() {
  const all = getAllMembers();
  return FLOWERS_SORTED
    .map((flower) => ({ flower, owners: membersWithFlower(all, flower.id) }))
    .filter((v) => v.owners.length > 0);
}

// 길드원 드롭다운 + 등급 색 범례
function memberBarHtml(activeMember, memberNames) {
  const opts = [`<option value="all"${activeMember === "all" ? " selected" : ""}>전체 보기</option>`]
    .concat(memberNames.map((n) =>
      `<option value="${escapeHtml(n)}"${n === activeMember ? " selected" : ""}>${escapeHtml(n)} · ${RANKS[rankOf(n)].label}</option>`));
  const legend = Object.entries(RANKS)
    .map(([k, r]) => `<span class="rank-tag" data-rank="${k}">${r.label}</span>`).join("");
  return `<div class="member-bar">
      <label>길드원별 <select id="member-filter">${opts.join("")}</select></label>
      <div class="rank-legend">${legend}</div>
    </div>`;
}

function renderView() {
  const all = getAllMembers();
  // 데이터에 꽃이 있는 길드원 목록 (등급 → 이름 순 정렬)
  const memberNames = Object.keys(all)
    .filter((n) => Array.isArray(all[n]?.flowers) && all[n].flowers.length > 0)
    .sort((a, b) => (RANK_ORDER[rankOf(a)] - RANK_ORDER[rankOf(b)]) || a.localeCompare(b, "ko"));
  if (viewMember !== "all" && !memberNames.includes(viewMember)) viewMember = "all";

  let visible = getVisibleFlowers();
  if (viewMember !== "all") visible = visible.filter((v) => v.owners.includes(viewMember));
  const counts = countByGrade(visible.map((v) => v.flower));

  const memberTitle = viewMember === "all"
    ? ""
    : `<p class="member-title"><span class="owner-tag" data-rank="${rankOf(viewMember)}">${escapeHtml(viewMember)}</span> · ${RANKS[rankOf(viewMember)].label} · 보유 ${visible.length}종</p>`;

  screens.view.innerHTML =
    yieldPanelHtml(all) +
    memberBarHtml(viewMember, memberNames) +
    memberTitle +
    chipBarHtml(viewGrade, counts) +
    `<div class="flower-grid${viewGrade === "all" ? "" : " filter-" + viewGrade}"></div>`;
  const grid = screens.view.querySelector(".flower-grid");
  wireYieldPanel(screens.view);

  for (const { flower, owners } of visible) {
    const card = document.createElement("article");
    card.className = "flower-card";
    card.dataset.grade = flower.grade;
    card.innerHTML = `
      <img class="flower-img" src="${flower.image}" alt="${flower.name}" />
      <h3 class="flower-name">${flower.name}</h3>
      <p class="owner-count">${owners.length}명 보유</p>
      <ul class="owner-list">
        ${owners.map((n) => `<li class="owner-tag" data-rank="${rankOf(n)}">${escapeHtml(n)}</li>`).join("")}
      </ul>
    `;
    grid.appendChild(card);
  }

  screens.view.querySelector("#member-filter").addEventListener("change", (e) => {
    viewMember = e.target.value;
    renderView();
  });
  screens.view.querySelector(".grade-chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    viewGrade = btn.dataset.grade;
    renderView();
  });
}

// 양보 안내 패널 HTML — 2명 이상이 가진 꽃 + 우선 진행자(👑). 접이식(기본 펼침).
function yieldPanelHtml(all) {
  const multi = FLOWERS_SORTED
    .map((flower) => ({ flower, owners: membersWithFlower(all, flower.id) }))
    .filter((v) => v.owners.length >= 2);
  if (!multi.length) return ""; // 겹치는 꽃 없으면 패널 자체를 숨김

  const staff = isStaff();
  const rows = multi.map(({ flower, owners }) => {
    const pri = priorityMap[flower.id];
    const hasPri = pri && owners.includes(pri);
    // 우선 진행자가 정해지면 그 사람만 표시 (나머지 소유자 숨김). 미정이면 전원 표시.
    const shown = hasPri ? [pri] : owners;
    const chips = shown.map((n) => {
      const isPri = pri === n;
      return `<li class="owner-tag${isPri ? " is-priority" : ""}" data-rank="${rankOf(n)}" data-flower="${escapeHtml(flower.id)}" data-member="${escapeHtml(n)}">${isPri ? "👑 " : ""}${escapeHtml(n)}</li>`;
    }).join("");
    return `<div class="yield-card" data-grade="${flower.grade}">
        <img class="yield-img" src="${flower.image}" alt="${flower.name}" />
        <div class="yield-info">
          <h3 class="flower-name">${flower.name}</h3>
          <ul class="owner-list">${chips}</ul>
        </div>
      </div>`;
  }).join("");

  return `<section class="yield-panel${yieldOpen ? "" : " collapsed"}">
      <button class="yield-head" id="yield-toggle" aria-expanded="${yieldOpen}">
        <span>🌷 다수 소유자 양보 안내 <em>${multi.length}</em></span>
        <span class="yield-arrow">${yieldOpen ? "▲" : "▼"}</span>
      </button>
      <div class="yield-body">
        <p class="yield-desc">같은 꽃을 여러 명이 가졌어요. <b>우선 진행자(👑)</b>가 먼저 진행하고 나머지는 양보해 주세요.${staff ? " 소유자를 눌러 지정 · 👑을 다시 누르면 해제." : ""}
          ${staff ? `<button class="ghost staff-btn" id="staff-lock">🔓 운영진 모드 ON · 잠그기</button>`
                  : `<button class="ghost staff-btn" id="staff-unlock">🔑 운영진 모드 (양보 지정)</button>`}
        </p>
        <div class="yield-list">${rows}</div>
      </div>
    </section>`;
}

function isStaff() {
  return !!sessionStorage.getItem("staffPw");
}

// 양보 패널 이벤트 연결 (renderView에서 호출)
function wireYieldPanel(container) {
  const toggle = container.querySelector("#yield-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      yieldOpen = !yieldOpen;
      const panel = container.querySelector(".yield-panel");
      panel.classList.toggle("collapsed", !yieldOpen);
      toggle.setAttribute("aria-expanded", String(yieldOpen));
      container.querySelector(".yield-arrow").textContent = yieldOpen ? "▲" : "▼";
    });
  }
  const unlock = container.querySelector("#staff-unlock");
  if (unlock) unlock.addEventListener("click", unlockStaff);
  const lock = container.querySelector("#staff-lock");
  if (lock) lock.addEventListener("click", () => { sessionStorage.removeItem("staffPw"); renderView(); });

  const list = container.querySelector(".yield-list");
  if (list) {
    list.addEventListener("click", (e) => {
      const li = e.target.closest(".owner-tag");
      if (!li) return;
      if (!isStaff()) { alert("양보(우선 진행자) 지정은 운영진만 가능해요. '운영진 모드'를 켜주세요 🔑"); return; }
      const flowerId = li.dataset.flower;
      const member = li.dataset.member;
      setPriority(flowerId, priorityMap[flowerId] === member ? "" : member);
    });
  }
}

async function unlockStaff() {
  const pw = window.prompt("운영진 비밀번호를 입력하세요");
  if (!pw) return;
  try {
    const res = await fetch(apiBase + "api/staff-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    if (!res.ok) { alert("운영진 비밀번호가 틀려요 🔒"); return; }
    sessionStorage.setItem("staffPw", pw);
    renderView();
  } catch (e) {
    alert("확인 실패: " + e.message);
  }
}

async function setPriority(flowerId, member) {
  try {
    const res = await fetch(apiBase + "api/priority", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: sessionStorage.getItem("staffPw") || "", flowerId, member }),
    });
    if (res.status === 401) {
      alert("운영진 비밀번호가 만료됐어요. 다시 운영진 모드를 켜주세요 🔒");
      sessionStorage.removeItem("staffPw");
      renderView();
      return;
    }
    if (!res.ok) throw new Error("server " + res.status);
    const data = await res.json();
    priorityMap = data.priority || {};
    renderView();
  } catch (e) {
    alert("우선 진행자 저장에 실패했어요: " + e.message);
  }
}

function renderInput() {
  const counts = countByGrade(FLOWERS);
  screens.input.innerHTML = `
    <div class="input-form">
      <label class="field">
        <span>닉네임</span>
        <input id="nickname" type="text" placeholder="게임 닉네임" autocomplete="off" />
      </label>
      <button id="save-btn" class="primary">저장하기</button>
      <p id="input-msg" class="msg" aria-live="polite"></p>
      ${chipBarHtml(inputGrade, counts)}
      <div class="checkbox-grid${inputGrade === "all" ? "" : " filter-" + inputGrade}" id="flower-checks">
        ${FLOWERS_SORTED.map((f) => `
          <label class="check-item" data-grade="${f.grade}">
            <input type="checkbox" value="${f.id}" />
            <img src="${f.image}" alt="${f.name}" />
            <span>${f.name}</span>
          </label>`).join("")}
      </div>
    </div>
  `;

  const nickInput = screens.input.querySelector("#nickname");
  const msg = screens.input.querySelector("#input-msg");
  const grid = screens.input.querySelector("#flower-checks");
  const checks = () => [...grid.querySelectorAll("input[type=checkbox]")];

  screens.input.querySelector(".grade-chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    inputGrade = btn.dataset.grade;
    grid.className = "checkbox-grid" + (inputGrade === "all" ? "" : " filter-" + inputGrade);
    screens.input.querySelectorAll(".grade-chips .chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.grade === inputGrade));
  });

  nickInput.addEventListener("change", () => {
    const owned = new Set(getMemberFlowers(nickInput.value));
    for (const c of checks()) c.checked = owned.has(c.value);
  });

  screens.input.querySelector("#save-btn").addEventListener("click", async () => {
    const name = nickInput.value.trim();
    if (!name) {
      msg.textContent = "닉네임을 입력해주세요 🌱";
      msg.className = "msg error";
      return;
    }
    const selected = checks().filter((c) => c.checked).map((c) => c.value);
    const saveBtn = screens.input.querySelector("#save-btn");
    saveBtn.disabled = true;
    try {
      const res = await fetch(apiBase + "api/member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: guildPw, name, flowers: selected }),
      });
      if (res.status === 401) {
        msg.textContent = "세션이 만료됐어요. 새로고침 후 다시 입장해 주세요 🔒";
        msg.className = "msg error";
        return;
      }
      if (!res.ok) throw new Error("server " + res.status);
      const data = await res.json();
      serverMembers = data.members;
      msg.textContent = `${name}님의 꽃을 저장했어요! 💐`;
      msg.className = "msg success";
    } catch (e) {
      msg.textContent = "저장에 실패했어요: " + e.message;
      msg.className = "msg error";
    } finally {
      saveBtn.disabled = false;
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

for (const tab of tabs) {
  tab.addEventListener("click", () => showScreen(tab.dataset.view));
}

document.getElementById("export-btn").addEventListener("click", () => {
  // 서버 모드면 공용 데이터를, 아니면 내 로컬 데이터를 백업
  const json = serverMode ? JSON.stringify(getAllMembers()) : store.exportData();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cozyflower-backup.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// 로그아웃: 이 기기에 기억된 입장 비번/운영진 비번 지우고 로그인 화면으로
const logoutBtn = document.getElementById("logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("guildPw");
    sessionStorage.removeItem("staffPw");
    location.reload();
  });
}

// API 기준 경로 (현재 페이지 기준 상대 → 서브디렉터리 배포에도 대응)
const apiBase = location.pathname.replace(/[^/]*$/, "");

// ── 입장(로그인) 게이트 ───────────────────────────────────────
// 입장 시 비번 1회 입력 → 맞으면 데이터 로드 후 입장, 비번은 기기에 기억.
// 비번이 바뀌면(탈퇴자 대응 등) 다음 접속 때 자동 입장 실패 → 다시 로그인.
async function tryAuth(pw) {
  try {
    const res = await fetch(apiBase + "api/data", { headers: { "x-guild-pw": pw } });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    serverMembers = data;
    serverMode = true;
    guildPw = pw;
    try {
      const pr = await fetch(apiBase + "api/priority", { headers: { "x-guild-pw": pw } });
      priorityMap = pr.ok ? await pr.json() : {};
    } catch { priorityMap = {}; }
    return true;
  } catch {
    return false;
  }
}

function enterApp() {
  document.body.classList.remove("locked");
  showScreen("view");
}

const loginBtn = document.getElementById("login-btn");
const loginPw = document.getElementById("login-pw");
const loginMsg = document.getElementById("login-msg");
async function doLogin() {
  const pw = loginPw.value;
  if (!pw) { loginMsg.textContent = "비밀번호를 입력해주세요"; return; }
  loginBtn.disabled = true;
  loginMsg.textContent = "확인 중…";
  if (await tryAuth(pw)) {
    localStorage.setItem("guildPw", pw);
    loginMsg.textContent = "";
    enterApp();
  } else {
    loginMsg.textContent = "비밀번호가 틀려요 🔒";
  }
  loginBtn.disabled = false;
}
if (loginBtn) {
  loginBtn.addEventListener("click", doLogin);
  loginPw.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
}

// 시작: 기억된 비번이 있으면 자동 입장, 없거나 틀리면 로그인 화면(body.locked) 유지
(async () => {
  const saved = localStorage.getItem("guildPw") || "";
  if (saved && (await tryAuth(saved))) {
    enterApp();
  } else if (loginPw) {
    loginPw.focus();
  }
})();
