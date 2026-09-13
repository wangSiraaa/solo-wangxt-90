/**
 * 验证样张：覆盖需求要求的三类素材 ——
 *  1. 长单词（超出行宽，触发硬断行）；
 *  2. 数字/字母切换（数字号、字母号规则由语言表决定）；
 *  3. 图注跨页（图注长度超过一页可用行数，必然续排到下页）。
 */
import type { StudioDocument } from '../model/document';
import { newId } from '../model/document';

const LONG_CAPTION =
  'Figure note: a simple raised-line floor plan of the studio. ' +
  'The rectangle is the outer wall; the circle marks the embosser; ' +
  'the line marks the door. This caption is intentionally long so that ' +
  'it flows across a page boundary and continues on the next page. '.repeat(6);

export function buildSampleDocument(tableFile: string, pagePresetId: string): StudioDocument {
  return {
    id: newId(),
    name: '验证样张（长单词 / 数字切换 / 图注跨页）',
    tableFile,
    pagePresetId,
    showPageNumbers: true,
    updatedAt: Date.now(),
    blocks: [
      { id: newId(), kind: 'heading', level: 1, text: 'Braille Layout Proof 2026-09-13' },
      {
        id: newId(),
        kind: 'paragraph',
        text:
          'Long-word wrap check: Pneumonoultramicroscopicsilicovolcanoconiosis ' +
          'antidisestablishmentarianism floccinaucinihilipilification.',
      },
      {
        id: newId(),
        kind: 'paragraph',
        text:
          'Number and letter switching: Room 3B, row 12C, seat 7A; ' +
          'date 2026-09-13; codes A1B2C3; the hall is 95% full; see page 128.',
      },
      {
        id: newId(),
        kind: 'paragraph',
        text: '中文内容请切换到汉语现行盲文表（zh-chn.ctb）：2026年9月13日，第3版共128页。',
      },
      {
        id: newId(),
        kind: 'figure',
        figure: {
          widthMm: 90,
          heightMm: 55,
          shapes: [
            { kind: 'rect', pts: [0, 0, 90, 55] },
            { kind: 'circle', pts: [60, 27, 12] },
            { kind: 'line', pts: [0, 27, 45, 27] },
            { kind: 'polyline', pts: [10, 45, 20, 35, 30, 45] },
          ],
        },
        caption: LONG_CAPTION,
      },
      {
        id: newId(),
        kind: 'paragraph',
        text: 'End of proof. Final tactile quality must be confirmed on the actual embosser.',
      },
    ],
  };
}
