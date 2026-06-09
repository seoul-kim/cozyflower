// 꽃 보기 화면을 PNG 한 장으로 저장 (외부 라이브러리 없이 canvas로 직접 렌더)
// 같은 출처 이미지를 그리므로 canvas가 오염되지 않아 toBlob 가능.

const C = {
  paper: "#fdf6ec",
  card: "#fffdf8",
  ink: "#5b4b6e",
  pinkDeep: "#e98aa0",
  lav: "#c9b6e4",
  ur: "#e8607a",
  ssr: "#f4c84a",
  ssrText: "#7a5a2a",
};
const FONT = '"Pretendard Variable", Pretendard, system-ui, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawCover(ctx, img, x, y, w, h, r) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  if (img) {
    const ir = img.width / img.height;
    const tr = w / h;
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (ir > tr) { sw = img.height * tr; sx = (img.width - sw) / 2; }
    else { sh = img.width / tr; sy = (img.height - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  } else {
    ctx.fillStyle = "#fbeef2";
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

// 글자 단위 그리디 줄바꿈 (최대 maxLines줄, 넘치면 …)
function wrapText(ctx, text, maxW, maxLines) {
  const lines = [];
  let cur = "";
  for (const ch of text) {
    const t = cur + ch;
    if (ctx.measureText(t).width <= maxW || cur === "") {
      cur = t;
    } else {
      lines.push(cur);
      cur = ch;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && cur) { lines.push(cur); cur = ""; }
  if (cur) {
    // 아직 남은 글자 → 마지막 줄에 … 처리
    let last = lines[maxLines - 1];
    while (last.length && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = last + "…";
  }
  return lines.map((l) => l.trim());
}

// 보유자 이름을 알약(칩)으로 줄바꿈 배치
function packChips(ctx, names, maxW, chipH, padX, gapX, gapY) {
  const items = names.map((n) => ({ text: n, w: Math.min(maxW, ctx.measureText(n).width + padX * 2) }));
  const rows = [];
  let row = [], x = 0;
  for (const it of items) {
    if (row.length && x + gapX + it.w > maxW) { rows.push(row); row = []; x = 0; }
    if (row.length) x += gapX;
    row.push(it);
    x += it.w;
  }
  if (row.length) rows.push(row);
  const height = rows.length ? rows.length * chipH + (rows.length - 1) * gapY : 0;
  return { rows, height };
}

// visible: [{ flower, owners[] }] (정렬/필터는 호출부 책임)
export async function renderViewCanvas(visible) {
  // 동적 서브셋 폰트가 글자별로 로드되므로 사용 글자를 미리 로드
  const sample = visible.map((v) => v.flower.name + v.owners.join("")).join("") + "비밀정원꽃도감보유종명";
  try {
    await Promise.all([
      document.fonts.load(`800 30px "Pretendard Variable"`, sample),
      document.fonts.load(`700 16px "Pretendard Variable"`, sample),
      document.fonts.load(`600 13px "Pretendard Variable"`, sample),
    ]);
    await document.fonts.ready;
  } catch { /* 폰트 로드 실패해도 폴백 폰트로 진행 */ }

  const SCALE = 2;
  const cols = visible.length <= 1 ? 1 : visible.length === 2 ? 2 : 3;
  const cardW = 200, gap = 16, pad = 24;
  const imgSize = cardW - 24;
  const nameLH = 22, countLH = 20, chipH = 22, chipGapX = 6, chipGapY = 6, ownersTop = 6;

  const imgs = await Promise.all(visible.map((v) => loadImage(v.flower.image)));
  const mc = document.createElement("canvas").getContext("2d");

  const cards = visible.map((v, i) => {
    mc.font = `700 16px ${FONT}`;
    const nameLines = wrapText(mc, v.flower.name, cardW - 28, 2);
    mc.font = `600 13px ${FONT}`;
    const owners = packChips(mc, v.owners, cardW - 20, chipH, 10, chipGapX, chipGapY);
    const nameBlockH = nameLines.length * nameLH + 6;
    const h = 12 + imgSize + 8 + nameBlockH + 4 + countLH + ownersTop + owners.height + 12;
    return { v, img: imgs[i], nameLines, nameBlockH, owners, h };
  });

  const rows = [];
  for (let i = 0; i < cards.length; i += cols) rows.push(cards.slice(i, i + cols));
  const rowHeights = rows.map((r) => Math.max(...r.map((c) => c.h)));
  const titleH = 64;
  const pageW = pad * 2 + cols * cardW + (cols - 1) * gap;
  const totalH = pad + titleH + pad / 2 + rowHeights.reduce((a, b) => a + b, 0) + gap * Math.max(0, rows.length - 1) + pad;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(pageW * SCALE);
  canvas.height = Math.round(totalH * SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, pageW, totalH);

  // 제목
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = C.pinkDeep;
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText("비밀정원 🌸 꽃 도감", pageW / 2, pad);
  ctx.fillStyle = C.ink;
  ctx.font = `600 13px ${FONT}`;
  ctx.fillText(`보유 꽃 ${visible.length}종`, pageW / 2, pad + 40);

  let y = pad + titleH + pad / 2;
  rows.forEach((row, ri) => {
    const rh = rowHeights[ri];
    row.forEach((c, ci) => {
      const x = pad + ci * (cardW + gap);
      // 카드 배경
      ctx.fillStyle = C.card;
      roundRect(ctx, x, y, cardW, rh, 16);
      ctx.fill();
      // 이미지
      drawCover(ctx, c.img, x + 12, y + 12, imgSize, imgSize, 12);

      let cy = y + 12 + imgSize + 8;
      const isUR = c.v.flower.grade === "UR";
      const isSSR = c.v.flower.grade === "SSR";
      // 이름 알약
      ctx.font = `700 16px ${FONT}`;
      const maxLineW = Math.max(...c.nameLines.map((l) => ctx.measureText(l).width));
      const pillW = Math.min(cardW - 16, maxLineW + 24);
      const pillX = x + (cardW - pillW) / 2;
      ctx.fillStyle = isUR ? C.ur : isSSR ? C.ssr : "#eadff5";
      roundRect(ctx, pillX, cy, pillW, c.nameBlockH, 999);
      ctx.fill();
      ctx.fillStyle = isUR ? "#fff" : isSSR ? C.ssrText : C.ink;
      ctx.textBaseline = "middle";
      c.nameLines.forEach((line, li) => {
        ctx.fillText(line, x + cardW / 2, cy + 3 + nameLH / 2 + li * nameLH);
      });
      cy += c.nameBlockH + 4;
      // 보유 수
      ctx.font = `600 13px ${FONT}`;
      ctx.fillStyle = C.pinkDeep;
      ctx.textBaseline = "top";
      ctx.fillText(`${c.v.owners.length}명 보유`, x + cardW / 2, cy);
      cy += countLH + ownersTop;
      // 보유자 칩
      ctx.font = `600 13px ${FONT}`;
      c.owners.rows.forEach((chips) => {
        const rowW = chips.reduce((a, ch) => a + ch.w, 0) + chipGapX * (chips.length - 1);
        let chx = x + (cardW - rowW) / 2;
        chips.forEach((ch) => {
          ctx.fillStyle = C.lav;
          roundRect(ctx, chx, cy, ch.w, chipH, 999);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.textBaseline = "middle";
          ctx.fillText(ch.text, chx + ch.w / 2, cy + chipH / 2 + 0.5);
          chx += ch.w + chipGapX;
        });
        cy += chipH + chipGapY;
      });
    });
    y += rh + gap;
  });

  return canvas;
}

export async function downloadViewImage(visible) {
  const canvas = await renderViewCanvas(visible);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cozyflower-꽃보기.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
