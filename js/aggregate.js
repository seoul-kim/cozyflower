export function membersWithFlower(allMembers, flowerId) {
  return Object.entries(allMembers)
    .filter(([, data]) => Array.isArray(data.flowers) && data.flowers.includes(flowerId))
    .map(([nickname]) => nickname);
}

export function countByGrade(flowers) {
  let UR = 0;
  let SSR = 0;
  let SR = 0; // 보라꽃
  for (const f of flowers) {
    if (f.grade === "UR") UR += 1;
    else if (f.grade === "SSR") SSR += 1;
    else if (f.grade === "SR") SR += 1;
  }
  return { UR, SSR, SR, all: flowers.length };
}
