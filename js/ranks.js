// 길드원 등급(직책) — 인게임 딱지 색 기준
// 길마=빨강, 부길마=노랑, 임원=보라, 정예=파랑, 일반=초록
export const RANKS = {
  gm:      { label: "길마",   color: "#e25f6e", text: "#fff" },
  vgm:     { label: "부길마", color: "#f4c84a", text: "#7a5a2a" },
  officer: { label: "임원",   color: "#a974d4", text: "#fff" },
  elite:   { label: "정예",   color: "#5b9bd5", text: "#fff" },
  general: { label: "일반",   color: "#8fc079", text: "#fff" },
};

// 정렬 우선순위 (길마 → 부길마 → 임원 → 정예 → 일반)
export const RANK_ORDER = { gm: 0, vgm: 1, officer: 2, elite: 3, general: 4 };

// 닉네임 → 등급. 명단에 없으면 일반.
export const MEMBER_RANK = {
  "쥴리": "gm",
  "욤뇸뇸뇸욤뇸욤뇸": "vgm",
  "쪼라": "vgm",
  "챔니": "vgm",
  "샤샤🌸": "officer",
  "킴꽃꽃": "elite",
  "둥이아빠": "elite",
  "송파구토마스": "elite",
  "모니카": "elite",
  "다니엘": "elite",
};

export function rankOf(name) {
  return MEMBER_RANK[String(name).trim()] || "general";
}
