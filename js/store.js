const KEY = "cozyflower:members";

export function createStore(backend) {
  function readAll() {
    const raw = backend.getItem(KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  function writeAll(obj) {
    backend.setItem(KEY, JSON.stringify(obj));
  }

  return {
    getAllMembers() {
      return readAll();
    },
    getMember(nickname) {
      const all = readAll();
      const entry = all[String(nickname).trim()];
      return entry && Array.isArray(entry.flowers) ? entry.flowers.slice() : [];
    },
    saveMember(nickname, flowerIds) {
      const name = String(nickname).trim();
      if (!name) throw new Error("닉네임을 입력해주세요");
      const all = readAll();
      all[name] = { flowers: [...new Set(flowerIds)] };
      writeAll(all);
    },
    deleteMember(nickname) {
      const all = readAll();
      delete all[String(nickname).trim()];
      writeAll(all);
    },
    exportData() {
      return backend.getItem(KEY) || "{}";
    },
    importData(json) {
      const parsed = JSON.parse(json); // 잘못된 JSON이면 여기서 throw
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("잘못된 형식입니다");
      }
      writeAll(parsed);
    },
  };
}

function memoryBackend() {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
  };
}

export const store =
  typeof localStorage !== "undefined"
    ? createStore(localStorage)
    : createStore(memoryBackend());
