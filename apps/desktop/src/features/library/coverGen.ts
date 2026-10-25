/**
 * 无封面书（TXT）的生成式封面：canvas 绘制素雅书封——
 * 书名哈希底色 + 衬线竖排书名 + 作者小字 + 细边框，
 * 同一本书颜色稳定。输出 PNG dataURL 供 saveCover 落盘。
 */

import { coverHashColor } from "./categories";

const W = 360;
const H = 520;

export function generateCover(title: string, author: string, seed: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const base = coverHashColor(seed);

  // 底色 + 轻微暗角
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, "rgba(255,255,255,0.10)");
  shade.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  // 细边框（留白框，古典书封感）
  ctx.strokeStyle = "rgba(246,236,232,0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, W - 36, H - 36);

  // 竖排书名（右侧起排，衬线）
  const chars = [...title].slice(0, 12);
  const rows = chars.length > 7 ? 2 : 1;
  const perRow = Math.ceil(chars.length / rows);
  ctx.fillStyle = "#f6ece8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontSize = rows === 1 ? 46 : 38;
  ctx.font = `${fontSize}px "Songti SC", "STSong", "Noto Serif SC", "SimSun", serif`;
  chars.forEach((ch, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const x = W - 74 - row * (fontSize + 18);
    const y = 84 + col * (fontSize + 16);
    ctx.fillText(ch, x, y);
  });

  // 底部作者
  if (author) {
    ctx.font = '20px "Songti SC", "Noto Serif SC", "SimSun", serif';
    ctx.fillStyle = "rgba(246,236,232,0.8)";
    ctx.fillText(author.slice(0, 12), W / 2, H - 56);
  }

  // 印章点缀
  ctx.fillStyle = "#bf3b2b";
  ctx.fillRect(38, 38, 14, 14);

  return canvas.toDataURL("image/png");
}
