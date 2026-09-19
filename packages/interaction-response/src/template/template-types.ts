/**
 * Template rendering types.
 *
 * Placeholders in a template body use the form {{name}}. Names are
 * lower_snake_case. A missing placeholder is fail-closed: the render
 * throws a TemplateRenderError unless explicitly disabled.
 */

export interface TemplateContext {
  actor_display_name?: string;
  content_snippet?: string;
  publication_title?: string;
  destination_name?: string;
  [key: string]: string | undefined;
}

export interface RenderResult {
  body: string;
  missingPlaceholders: string[];
}

export interface RenderOptions {
  /**
   * If true (default), a missing placeholder throws a
   * TemplateRenderError. If false, missing placeholders are replaced
   * with the empty string and reported in the result.
   */
  failOnMissing?: boolean;
}

export class TemplateRenderError extends Error {
  constructor(public readonly missingPlaceholders: string[]) {
    super(`Missing template placeholders: ${missingPlaceholders.join(', ')}`);
    this.name = 'TemplateRenderError';
  }
}
