export function membersWithFlower(allMembers, flowerId) {
  return Object.entries(allMembers)
    .filter(([, data]) => Array.isArray(data.flowers) && data.flowers.includes(flowerId))
    .map(([nickname]) => nickname);
}

export function countByGrade(flowers) {
  let UR = 0;
  let SSR = 0;
  for (const f of flowers) {
    if (f.grade === "UR") UR += 1;
    else if (f.grade === "SSR") SSR += 1;
  }
  return { UR, SSR, all: flowers.length };
}
