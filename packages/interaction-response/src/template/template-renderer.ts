import {
  TemplateRenderError,
  type RenderOptions,
  type RenderResult,
  type TemplateContext,
} from './template-types.js';

/**
 * Placeholder pattern: {{name}}, with optional whitespace inside the
 * braces. Names must start with a lowercase letter and contain only
 * lowercase letters, digits, and underscores.
 */
const PLACEHOLDER_RE = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi;

/**
 * Deterministic template renderer.
 *
 * No AI, no paraphrasing, no partial substitution. A missing
 * placeholder either throws (fail-closed, default) or is reported in
 * the result (explicit opt-out).
 */
export class TemplateRenderer {
  render(template: string, context: TemplateContext, options?: RenderOptions): RenderResult {
    const failOnMissing = options?.failOnMissing ?? true;
    const missing: string[] = [];

    const body = template.replace(PLACEHOLDER_RE, (_match, name: string) => {
      const value = context[name];
      if (value === undefined) {
        missing.push(name);
        return '';
      }
      return value;
    });

    if (failOnMissing && missing.length > 0) {
      // Deduplicate while preserving order.
      const unique = Array.from(new Set(missing));
      throw new TemplateRenderError(unique);
    }

    return { body, missingPlaceholders: Array.from(new Set(missing)) };
  }
}
