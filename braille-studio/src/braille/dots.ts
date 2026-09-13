/**
 * Unicode 盲文（U+2800–U+28FF）与 6 点点位的换算。
 * 仅做位运算，不涉及任何语言规则 —— 全部语言规则由 liblouis 表承担。
 */

export const BRAILLE_BASE = 0x2800;

/** 点位 bit：bit0=点1 … bit5=点6（Unicode 盲文低 6 位即标准点位） */
export function charToDots(ch: string): number {
  const code = ch.codePointAt(0);
  if (code === undefined || code === 0x20) return 0; // 空格 = 空单元
  if (code < BRAILLE_BASE || code > BRAILLE_BASE + 0xff) {
    throw new Error(`非 Unicode 盲文字符: U+${code.toString(16)}（应使用 unicode.dis 显示表输出）`);
  }
  return code - BRAILLE_BASE;
}

export function dotsToChar(dots: number): string {
  return String.fromCodePoint(BRAILLE_BASE + (dots & 0x3f));
}

/** 返回该字符实际凸起的点号列表（1–6） */
export function raisedDots(ch: string): number[] {
  const bits = charToDots(ch);
  const out: number[] = [];
  for (let d = 1; d <= 6; d++) if (bits & (1 << (d - 1))) out.push(d);
  return out;
}

/**
 * 6 点在单元内的相对坐标（mm，以 dot-1 中心为原点，x 向右、y 向下）。
 * 点序：1 2 3 为左列自上而下，4 5 6 为右列自上而下。
 */
export function dotOffset(dot: number, dotPitch: number): { dx: number; dy: number } {
  const col = dot <= 3 ? 0 : 1;
  const row = (dot - 1) % 3;
  return { dx: col * dotPitch, dy: row * dotPitch };
}

export function isBrailleString(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c !== 0x20 && (c < BRAILLE_BASE || c > BRAILLE_BASE + 0xff)) return false;
  }
  return true;
}
