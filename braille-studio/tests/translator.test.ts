/**
 * 转译层测试：使用真实的 liblouis WASM（Node 环境），
 * 验证语言表转译、数字/字母切换、Unicode 盲文输出与原文映射。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { initTranslator, translate } from '../src/braille/translator';
import { isBrailleString, raisedDots } from '../src/braille/dots';

beforeAll(async () => {
  await initTranslator();
});

describe('liblouis 转译（真实 WASM，非替代算法）', () => {
  it('报告版本并加载随项目固定的表', async () => {
    const info = await initTranslator();
    expect(info.version).toBe('3.2.0');
    expect(info.tables.map((t) => t.file)).toContain('en-us-g2.ctb');
    expect(info.manifest.files['en-us-g2.ctb']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('二级盲文使用缩写（knowledge → ⠅，world → ⠸⠺）', () => {
    const t = translate('knowledge world', 'en-us-g2.ctb');
    expect(t.braille).toBe('⠅ ⠸⠺');
    expect(isBrailleString(t.braille)).toBe(true);
  });

  it('一级盲文不缩写', () => {
    const t = translate('knowledge', 'en-us-g1.ctb');
    expect(t.braille).toBe('⠅⠝⠕⠺⠇⠑⠙⠛⠑');
  });

  it('数字/字母切换由表规则产生数字号与字母号', () => {
    const t = translate('A1B2C3', 'en-us-g1.ctb');
    // ⠰=字母号 ⠼=数字号，交替出现
    expect(t.braille).toContain('⠼');
    expect(t.braille).toContain('⠰');
    expect(t.braille).toBe('⠰⠠⠁⠼⠁⠰⠠⠃⠼⠃⠰⠠⠉⠼⠉');
  });

  it('数字后接 a-j 字母时插入字母号（Room 3B）', () => {
    const t = translate('3B', 'en-us-g2.ctb');
    expect(t.braille).toBe('⠼⠉⠰⠠⠃');
  });

  it('原文映射：每个输出单元都有原文位置（lou_translate inputPos）', () => {
    const text = 'knowledge 42';
    const t = translate(text, 'en-us-g2.ctb');
    expect(t.srcMap.length).toBe(t.braille.length);
    expect(t.braille[0]).toBe('⠅'); // knowledge 缩写
    expect(t.srcMap[0]).toBe(0); // 对应原文第 0 字符
    // 数字号后的 ⠙⠃ 对应原文 '4'、'2'
    const last = t.srcMap.length - 1;
    expect(text[t.srcMap[last]]).toBe('2');
    expect(text[t.srcMap[last - 1]]).toBe('4');
  });

  it('汉语现行盲文表可转译中文与数字', () => {
    const t = translate('2026年', 'zh-chn.ctb');
    expect(isBrailleString(t.braille)).toBe(true);
    expect(t.braille.length).toBeGreaterThan(0);
  });

  it('点位换算：⠿ 六点全凸，⠁ 仅点 1', () => {
    expect(raisedDots('⠿')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(raisedDots('⠁')).toEqual([1]);
    expect(raisedDots(' ')).toEqual([]);
  });
});
