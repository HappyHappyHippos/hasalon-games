import { describe, expect, it } from 'vitest';
import { makeRng } from './rng';
import { isKnownTemplate, MEME_TEMPLATES, pickTemplates } from './templates';

/** The manifest is data the sim trusts, so malformed geometry must fail in CI. */
describe('Meme Machine template manifest', () => {
  it('contains 120 stills and 80 animated templates without duplicate ids', () => {
    expect(MEME_TEMPLATES.length).toBeGreaterThanOrEqual(200);
    expect(MEME_TEMPLATES.filter((template) => template.format === 'mp4')).toHaveLength(80);
    expect(new Set(MEME_TEMPLATES.map((template) => template.id)).size).toBe(
      MEME_TEMPLATES.length,
    );
  });

  it('has one valid, non-degenerate box per declared slot', () => {
    for (const template of MEME_TEMPLATES) {
      expect(template.boxes, template.id).toHaveLength(template.slots);
      expect(template.aspect, template.id).toBeGreaterThan(0);
      for (const box of template.boxes) {
        expect(box.x, template.id).toBeGreaterThanOrEqual(0);
        expect(box.y, template.id).toBeGreaterThanOrEqual(0);
        expect(box.w, template.id).toBeGreaterThan(0);
        expect(box.h, template.id).toBeGreaterThan(0);
        expect(box.x + box.w, template.id).toBeLessThanOrEqual(1);
        expect(box.y + box.h, template.id).toBeLessThanOrEqual(1);
        expect(['center', 'left', 'right'], template.id).toContain(box.align);
      }
    }
  });

  it('deals distinct templates, avoids used ones, and falls back when exhausted', () => {
    const rng = makeRng(42);
    const used = new Set(MEME_TEMPLATES.slice(0, 4).map((template) => template.id));
    const fresh = pickTemplates(5, used, rng);
    expect(new Set(fresh.map((template) => template.id)).size).toBe(5);
    expect(fresh.every((template) => !used.has(template.id))).toBe(true);

    const exhausted = pickTemplates(5, new Set(MEME_TEMPLATES.map((template) => template.id)), rng);
    expect(exhausted).toHaveLength(5);
    expect(new Set(exhausted.map((template) => template.id)).size).toBe(5);
  });

  it('recognises every manifest id and rejects invented ones', () => {
    for (const template of MEME_TEMPLATES) expect(isKnownTemplate(template.id)).toBe(true);
    expect(isKnownTemplate('definitely-not-a-template')).toBe(false);
  });
});
