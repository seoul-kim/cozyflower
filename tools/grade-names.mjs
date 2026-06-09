// 일회성: 이름 배너를 크롭(읽기용)하고 등급을 자동 판정해 출력한다.
import sharp from "sharp";
import { readdir, mkdir } from "node:fs/promises";
import path from "node:path";

const SRC = path.resolve("../_incoming_flowers/꽃");
const OUT = path.resolve("./names");
const banner = { left: 0, top: 1430, width: 1179, height: 90 };      // 이름 배너(읽기용)
const colorPatch = { left: 200, top: 1446, width: 780, height: 52 }; // 등급 판정용

const files = (await readdir(SRC))
  .filter((f) => f.toLowerCase().endsWith(".png"))
  .filter((f) => !f.includes(" (1)"))
  .sort();

await mkdir(OUT, { recursive: true });

let i = 0;
for (const f of files) {
  i += 1;
  const id = "flower-" + String(i).padStart(2, "0");
  await sharp(path.join(SRC, f)).extract(banner).png().toFile(path.join(OUT, id + ".png"));
  const { data } = await sharp(path.join(SRC, f)).extract(colorPatch).raw().toBuffer({ resolveWithObject: true });
  let yellow = 0, pink = 0;
  for (let p = 0; p < data.length; p += 3) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    if (g > r && g > b) continue;
    if (r > 205 && g > 205 && b > 205) continue;
    if (r < 90 && g < 90 && b < 90) continue;
    if (r > 150 && g > 120 && b < 150 && Math.abs(r - g) < 90) yellow += 1;
    else if (r > 150 && b > 110 && g < r * 0.82) pink += 1;
  }
  console.log(id, pink > yellow ? "UR" : "SR");
}
