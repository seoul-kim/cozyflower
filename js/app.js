import { FLOWERS } from "./flowers.js";
import { store } from "./store.js";
import { membersWithFlower, countByGrade } from "./aggregate.js";
import { downloadViewImage } from "./snapshot.js";

// 정렬본 (보기/입력 공통): 등급 우선(빨간꽃 UR → 노란꽃 SSR), 같은 등급 내 가나다 순
const GRADE_ORDER = { UR: 0, SSR: 1 };
const FLOWERS_SORTED = [...FLOWERS].sort((a, b) => {
  const byGrade = (GRADE_ORDER[a.grade] ?? 9) - (GRADE_ORDER[b.grade] ?? 9);
  return byGrade !== 0 ? byGrade : a.name.localeCompare(b.name, "ko");
});

let viewGrade = "all";
let inputGrade = "all";

// 데이터 출처 우선순위:
//   sharedMembers (공유 링크로 열린 읽기전용) > serverMembers (길드 공용 서버) > localStorage(폴백)
let sharedMembers = null;
let serverMembers = null; // 서버 공용 데이터. null이면 서버 미사용(로컬 폴백)
let serverMode = false;
function getAllMembers() {
  return sharedMembers ?? serverMembers ?? store.getAllMembers();
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
  const pwField = serverMode
    ? `<label class="field">
         <span>길드 비밀번호</span>
         <input id="guild-pw" type="password" placeholder="길드원에게 공유된 비밀번호" autocomplete="off" />
       </label>`
    : "";
  screens.input.innerHTML = `
    <div class="input-form">
      <label class="field">
        <span>닉네임</span>
        <input id="nickname" type="text" placeholder="게임 닉네임" autocomplete="off" />
      </label>
      ${pwField}
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
      <button id="save-btn" class="primary">저장하기</button>
    </div>
  `;

  const nickInput = screens.input.querySelector("#nickname");
  const pwInput = screens.input.querySelector("#guild-pw");
  const msg = screens.input.querySelector("#input-msg");
  const grid = screens.input.querySelector("#flower-checks");
  const checks = () => [...grid.querySelectorAll("input[type=checkbox]")];

  // 비밀번호는 편의상 이 브라우저 세션에 기억
  if (pwInput) pwInput.value = sessionStorage.getItem("guildPw") || "";

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

    if (serverMode) {
      const password = pwInput ? pwInput.value : "";
      if (!password) {
        msg.textContent = "길드 비밀번호를 입력해주세요 🔒";
        msg.className = "msg error";
        return;
      }
      const saveBtn = screens.input.querySelector("#save-btn");
      saveBtn.disabled = true;
      try {
        const res = await fetch(apiBase + "api/member", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, name, flowers: selected }),
        });
        if (res.status === 401) {
          msg.textContent = "길드 비밀번호가 틀려요 🔒";
          msg.className = "msg error";
          return;
        }
        if (!res.ok) throw new Error("server " + res.status);
        const data = await res.json();
        serverMembers = data.members;
        sessionStorage.setItem("guildPw", password);
        msg.textContent = `${name}님의 꽃을 저장했어요! 💐`;
        msg.className = "msg success";
      } catch (e) {
        msg.textContent = "저장에 실패했어요: " + e.message;
        msg.className = "msg error";
      } finally {
        saveBtn.disabled = false;
      }
      return;
    }

    // 로컬 폴백 (서버 미사용)
    try {
      store.saveMember(name, selected);
      msg.textContent = `${name}님의 꽃을 저장했어요! 💐`;
      msg.className = "msg success";
    } catch (e) {
      msg.textContent = "저장에 실패했어요: " + e.message;
      msg.className = "msg error";
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

document.getElementById("import-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      store.importData(String(reader.result));
      alert("불러오기 완료! 💾");
      showScreen("view");
    } catch (err) {
      alert("불러오기 실패: 올바른 백업 파일이 아니에요.");
    }
    e.target.value = "";
  };
  reader.readAsText(file);
});

// 이미지로 저장 (호스팅 불필요 — 꽃 보기 전체를 PNG 한 장으로)
const imageBtn = document.getElementById("image-btn");
if (imageBtn) {
  imageBtn.addEventListener("click", async () => {
    const visible = getVisibleFlowers();
    if (!visible.length) {
      alert("아직 보유한 꽃이 없어요 🌱");
      return;
    }
    const prev = imageBtn.textContent;
    imageBtn.disabled = true;
    imageBtn.textContent = "🖼 그리는 중…";
    try {
      await downloadViewImage(visible);
    } catch (e) {
      alert("이미지 저장에 실패했어요: " + e.message);
    } finally {
      imageBtn.disabled = false;
      imageBtn.textContent = prev;
    }
  });
}

// API 기준 경로 (현재 페이지 기준 상대 → 서브디렉터리 배포에도 대응)
const apiBase = location.pathname.replace(/[^/]*$/, "");

// 공유 링크 복사 (소유자용): 서버에 저장하고 짧은 코드 링크 발급.
// 서버 API가 없으면(정적 호스팅 등) 데이터를 통째로 담는 긴 링크로 자동 폴백.
const shareBtn = document.getElementById("share-btn");
if (shareBtn) {
  shareBtn.addEventListener("click", async () => {
    let url;
    try {
      const res = await fetch(apiBase + "api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getAllMembers()),
      });
      if (!res.ok) throw new Error("api");
      const { code } = await res.json();
      if (!code) throw new Error("api");
      url = location.origin + location.pathname + "#s=" + code;
    } catch {
      // 폴백: 자체 완결형(긴) 링크
      url = location.origin + location.pathname + "#share=" + (await encodeShare(getAllMembers()));
    }
    try {
      await navigator.clipboard.writeText(url);
      alert("꽃 보기 공유 링크를 복사했어요! 🔗\n받는 사람은 이 링크를 열면 보기 전용으로 볼 수 있어요.");
    } catch {
      window.prompt("아래 링크를 복사해서 공유하세요 (Ctrl+C):", url);
    }
  });
}

// 공유 링크로 열린 경우: 읽기전용 보기 모드
//  #s=<코드>  → 서버에서 데이터 조회 (짧은 링크)
//  #share=... → URL에 담긴 데이터 디코드 (구버전/폴백 링크)
async function initFromHash() {
  const hash = location.hash;
  let m;
  if ((m = hash.match(/[#&]s=([0-9a-zA-Z]+)/))) {
    try {
      const res = await fetch(apiBase + "api/share/" + m[1]);
      if (!res.ok) throw new Error("not found");
      sharedMembers = await res.json();
      document.body.classList.add("shared-readonly");
    } catch {
      alert("공유 링크를 찾을 수 없어요. (만료되었거나 잘못된 링크일 수 있어요)");
    }
    return;
  }
  if ((m = hash.match(/share=([^&]+)/))) {
    try {
      sharedMembers = await decodeShare(m[1]);
      document.body.classList.add("shared-readonly");
    } catch {
      alert("공유 링크가 올바르지 않아요.");
    }
  }
}

// 길드 공용 서버 데이터 로드 (성공 시 서버 모드, 실패 시 로컬 폴백)
async function loadServerData() {
  try {
    const res = await fetch(apiBase + "api/data");
    if (!res.ok) throw new Error("no api");
    const data = await res.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("bad");
    serverMembers = data;
    serverMode = true;
  } catch {
    serverMode = false;
  }
}

(async () => {
  await initFromHash();
  if (!sharedMembers) await loadServerData(); // 공유 링크가 아니면 공용 데이터 로드
  showScreen("view");
})();
