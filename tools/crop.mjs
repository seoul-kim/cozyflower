import sharp from "sharp";
import { readdir, mkdir } from "node:fs/promises";
import path from "node:path";

const SRC = path.resolve("../_incoming_flowers/꽃");
const OUT = path.resolve("../assets/flowers");

// 1179x2556 screenshots. Calibrated for centered item with platform.
// top=530 clears the top bar + stat rows cleanly; width=900 height=820 captures full item.
const CROP = { left: 140, top: 530, width: 900, height: 820 };

const files = (await readdir(SRC))
  .filter((f) => f.toLowerCase().endsWith(".png"))
  .filter((f) => !f.includes(" (1)")) // exclude duplicates
  .sort();

await mkdir(OUT, { recursive: true });

let i = 0;
for (const f of files) {
  i += 1;
  const id = "flower-" + String(i).padStart(2, "0");
  await sharp(path.join(SRC, f))
    .extract(CROP)
    .resize(400, 400, { fit: "cover" })
    .png()
    .toFile(path.join(OUT, id + ".png"));
  console.log(id, "<-", f);
}
console.log("총", i, "개 크롭 완료");
