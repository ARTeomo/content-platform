import { describe, expect, it } from 'vitest';
import { TemplateRenderer } from './template-renderer.js';
import { TemplateRenderError } from './template-types.js';

describe('TemplateRenderer', () => {
  const renderer = new TemplateRenderer();

  it('substitutes known placeholders', () => {
    const result = renderer.render('Hello {{actor_display_name}}!', {
      actor_display_name: 'Alice',
    });
    expect(result.body).toBe('Hello Alice!');
    expect(result.missingPlaceholders).toEqual([]);
  });

  it('substitutes multiple placeholders', () => {
    const result = renderer.render(
      'Hi {{actor_display_name}}, thanks for commenting on {{publication_title}}.',
      {
        actor_display_name: 'Bob',
        publication_title: 'Model 59999',
      },
    );
    expect(result.body).toBe('Hi Bob, thanks for commenting on Model 59999.');
  });

  it('allows whitespace inside braces', () => {
    const result = renderer.render('Hello {{  actor_display_name  }}!', {
      actor_display_name: 'Carol',
    });
    expect(result.body).toBe('Hello Carol!');
  });

  it('throws on missing placeholder by default', () => {
    expect(() => renderer.render('Hello {{actor_display_name}}!', {})).toThrow(TemplateRenderError);
  });

  it('reports all missing placeholders when throwing', () => {
    try {
      renderer.render('{{a}} and {{b}}', {});
      expect.fail('expected TemplateRenderError');
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateRenderError);
      const e = err as TemplateRenderError;
      expect(e.missingPlaceholders.sort()).toEqual(['a', 'b']);
    }
  });

  it('does not throw when failOnMissing is false', () => {
    const result = renderer.render('Hello {{actor_display_name}}!', {}, { failOnMissing: false });
    expect(result.body).toBe('Hello !');
    expect(result.missingPlaceholders).toEqual(['actor_display_name']);
  });

  it('deduplicates missing placeholder names', () => {
    const result = renderer.render('{{a}} {{a}} {{b}}', {}, { failOnMissing: false });
    expect(result.missingPlaceholders.sort()).toEqual(['a', 'b']);
  });

  it('ignores non-matching brace patterns', () => {
    const result = renderer.render(
      '{not a placeholder} {{NotValid}} {{9bad}}',
      {},
      { failOnMissing: false },
    );
    // Only {{NotValid}} matches the pattern (case-insensitive), 9bad does not.
    expect(result.missingPlaceholders).toEqual(['NotValid']);
  });

  it('preserves literal text with no placeholders', () => {
    const result = renderer.render('plain text', {});
    expect(result.body).toBe('plain text');
  });

  it('substitutes a placeholder with an empty string value', () => {
    const result = renderer.render('Hello {{actor_display_name}}!', {
      actor_display_name: '',
    });
    expect(result.body).toBe('Hello !');
    expect(result.missingPlaceholders).toEqual([]);
  });
});
