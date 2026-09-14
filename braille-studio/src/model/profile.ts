/**
 * 输出规格：同一内容可输出多种纸张与点距规格。
 * 各规格共享转译结果，但版面几何与手工微调（overrides）各自独立，
 * 某一规格的调整不会污染另一版。
 */
import { BRAILLE_SPEC, type BrailleSpec } from '../braille/spec';

/** 锚点标注的手工微调（相对自动位置的偏移，mm） */
export interface AnchorOverride {
  dxMm: number;
  dyMm: number;
}

export interface ProfileOverrides {
  /** 按锚点 ID 挂接 —— 与版面坐标无关，重排后仍然有效 */
  anchors: Record<string, AnchorOverride>;
}

export interface OutputProfile {
  id: string;
  label: string;
  pagePresetId: string;
  /** 点距/行距等工艺参数（每规格独立，互不污染） */
  spec: BrailleSpec;
  overrides: ProfileOverrides;
}

export function defaultProfiles(pagePresetId: string): OutputProfile[] {
  return [
    {
      id: 'A',
      label: '规格 A · 盲文纸 6.0mm',
      pagePresetId,
      spec: { ...BRAILLE_SPEC },
      overrides: { anchors: {} },
    },
    {
      id: 'B',
      label: '规格 B · A4 校样 6.5mm',
      pagePresetId: 'a4',
      spec: { ...BRAILLE_SPEC, cellPitch: 6.5, dotPitch: 2.6, linePitch: 10.5 },
      overrides: { anchors: {} },
    },
  ];
}

export function getProfile(profiles: OutputProfile[] | undefined, id: string): OutputProfile {
  const p = profiles?.find((x) => x.id === id);
  if (!p) throw new Error(`输出规格不存在: ${id}`);
  return p;
}
