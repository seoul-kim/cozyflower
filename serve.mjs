// 정적 서버 + 공유 단축 API (Node 내장 모듈만 사용)
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname, join, normalize, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

// 프로젝트 루트는 이 파일(tools/serve.mjs)의 상위 폴더로 고정 (cwd 의존 제거)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 저장 경로: 배포 시 영구 디스크 경로를 환경변수로 지정 가능
const SHARES = process.env.SHARES_DIR || join(ROOT, "shares"); // 공유(스냅샷) 링크 저장 폴더
const DATA_DIR = process.env.DATA_DIR || join(ROOT, "data"); // 길드 공용 데이터 폴더
const DATA_FILE = join(DATA_DIR, "members.json");
const PORT = process.env.PORT || 4321;
// 길드 공통 비밀번호 (배포 시 환경변수 GUILD_PW 로 반드시 변경)
const GUILD_PW = process.env.GUILD_PW || "changeme";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

// 헷갈리는 글자(0/o/1/l 등) 제외한 단축 코드
const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";
function genCode(n = 5) {
  const b = randomBytes(n);
  let s = "";
  for (const x of b) s += ALPHABET[x % ALPHABET.length];
  return s;
}
function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

async function readBody(req, limit = 2_000_000) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error("too large");
  }
  return body;
}

// 공유 저장: POST .../api/share  body=members JSON  → { code }
async function handleShareCreate(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 413, { error: "too large" });
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return sendJson(res, 400, { error: "bad json" });
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return sendJson(res, 400, { error: "bad shape" });
  }
  await mkdir(SHARES, { recursive: true });
  let code = null;
  for (let i = 0; i < 5; i++) {
    const candidate = genCode(5);
    try {
      await readFile(join(SHARES, candidate + ".json")); // 이미 있으면 충돌 → 재시도
    } catch {
      code = candidate;
      break;
    }
  }
  if (!code) code = genCode(8); // 극히 드문 연속 충돌 시 더 긴 코드
  await writeFile(join(SHARES, code + ".json"), JSON.stringify(data));
  return sendJson(res, 200, { code });
}

// 공유 조회: GET .../api/share/<code>  → members JSON
async function handleShareGet(res, code) {
  const safe = String(code).replace(/[^0-9a-z]/gi, "");
  if (!safe) return sendJson(res, 404, { error: "not found" });
  try {
    const data = await readFile(join(SHARES, safe + ".json"));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(data);
  } catch {
    return sendJson(res, 404, { error: "not found" });
  }
}

// ── 길드 공용 데이터 (모두가 같은 도감에 읽고 쓰기) ──────────────
async function readMembers() {
  try {
    const obj = JSON.parse(await readFile(DATA_FILE, "utf8"));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}
let writeChain = Promise.resolve(); // 동시 쓰기 직렬화 (read-modify-write 경쟁 방지)
function saveMember(name, flowers) {
  const next = writeChain.then(async () => {
    const members = await readMembers();
    members[name] = { flowers };
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(DATA_FILE, JSON.stringify(members));
    return members;
  });
  writeChain = next.catch(() => {});
  return next;
}

// 공용 데이터 조회: GET .../api/data  → members JSON (읽기는 누구나)
async function handleDataGet(res) {
  const members = await readMembers();
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(members));
}
// 내 꽃 저장: POST .../api/member  { password, name, flowers }  (쓰기는 길드 비번 필요)
async function handleMemberSave(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 413, { error: "too large" });
  }
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return sendJson(res, 400, { error: "bad json" });
  }
  if (!payload || payload.password !== GUILD_PW) {
    return sendJson(res, 401, { error: "unauthorized" });
  }
  const name = String(payload.name || "").trim();
  if (!name) return sendJson(res, 400, { error: "no name" });
  const flowers = Array.isArray(payload.flowers) ? [...new Set(payload.flowers.map(String))] : [];
  const members = await saveMember(name, flowers);
  return sendJson(res, 200, { ok: true, members });
}

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);

    // 서브디렉터리 배포도 견디도록 경로 끝부분으로 매칭
    if (req.method === "GET" && /\/api\/data\/?$/.test(urlPath)) {
      return await handleDataGet(res);
    }
    if (req.method === "POST" && /\/api\/member\/?$/.test(urlPath)) {
      return await handleMemberSave(req, res);
    }
    if (req.method === "POST" && /\/api\/share\/?$/.test(urlPath)) {
      return await handleShareCreate(req, res);
    }
    const getMatch = urlPath.match(/\/api\/share\/([0-9a-z]+)$/i);
    if (req.method === "GET" && getMatch) {
      return await handleShareGet(res, getMatch[1]);
    }

    // 정적 파일
    let p = urlPath;
    if (p === "/") p = "/index.html";
    const filePath = normalize(join(ROOT, p));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": TYPES[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(PORT, () => console.log("serving cozyflowerDB on http://localhost:" + PORT));
