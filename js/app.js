import { FLOWERS } from "./flowers.js";
import { store } from "./store.js";
import { membersWithFlower, countByGrade } from "./aggregate.js";

// 정렬본 (보기/입력 공통): 등급 우선(빨간꽃 UR → 노란꽃 SSR), 같은 등급 내 가나다 순
const GRADE_ORDER = { UR: 0, SSR: 1, SR: 2 };
const FLOWERS_SORTED = [...FLOWERS].sort((a, b) => {
  const byGrade = (GRADE_ORDER[a.grade] ?? 9) - (GRADE_ORDER[b.grade] ?? 9);
  return byGrade !== 0 ? byGrade : a.name.localeCompare(b.name, "ko");
});

let viewGrade = "all";
let inputGrade = "all";

// 길드 공용 데이터 (로그인 후 서버에서 로드). 입장 비번은 1회 입력 후 기기에 기억.
let serverMembers = null;
let serverMode = false;
let guildPw = "";
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

function renderView() {
  const visible = getVisibleFlowers();
  const counts = countByGrade(visible.map((v) => v.flower));
  screens.view.innerHTML =
    chipBarHtml(viewGrade, counts) +
    `<div class="flower-grid${viewGrade === "all" ? "" : " filter-" + viewGrade}"></div>`;
  const grid = screens.view.querySelector(".flower-grid");

  for (const { flower, owners } of visible) {
    const card = document.createElement("article");
    card.className = "flower-card";
    card.dataset.grade = flower.grade;
    card.innerHTML = `
      <img class="flower-img" src="${flower.image}" alt="${flower.name}" />
      <h3 class="flower-name">${flower.name}</h3>
      <p class="owner-count">${owners.length}명 보유</p>
      <ul class="owner-list">
        ${owners.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}
      </ul>
    `;
    grid.appendChild(card);
  }

  screens.view.querySelector(".grade-chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    viewGrade = btn.dataset.grade;
    renderView();
  });
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
