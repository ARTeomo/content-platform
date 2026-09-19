/**
 * Package barrel for @content-platform/interaction-response.
 *
 * Pure, deterministic logic for the outbound response lifecycle:
 * policy decisions and template rendering. Database and HTTP
 * integrations live in the worker and API applications.
 */

export * from './policy/index.js';
export * from './template/index.js';
