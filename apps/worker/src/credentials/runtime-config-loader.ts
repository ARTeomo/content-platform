import type { SystemConfigRepository } from '@content-platform/database';
import type { InteractionResponseConfig, TemplateMap } from '../interaction-response/types.js';

/**
 * Configuration keys read from `system_config` at worker startup.
 *
 * These keys are the runtime source of truth for policy rules,
 * templates, and rate-limit budgets. The values in this file are
 * defaults used only when the key is absent.
 */
export const SYSTEM_CONFIG_KEYS = {
  interactionResponseRules: 'interaction_response_rules',
  interactionResponseTemplates: 'interaction_response_templates',
  interactionResponseMaxPerHour: 'interaction_response.max_per_hour_per_destination',
  interactionResponseMinIntervalSeconds: 'interaction_response.min_interval_seconds',
  interactionResponseGlobalMaxPerHour: 'interaction_response.global_max_per_hour',
} as const;

export interface LoadedRuntimeConfig {
  interactionResponseConfig: InteractionResponseConfig;
  templates: TemplateMap;
  /** Which keys were actually present in `system_config`. */
  loadedKeys: string[];
  /** Which keys were absent and fell back to defaults. */
  defaultedKeys: string[];
}

const DEFAULT_INTERACTION_RESPONSE_CONFIG: InteractionResponseConfig = {
  rules: [],
  maxResponsesPerHour: 20,
  minIntervalSeconds: 30,
};

const DEFAULT_TEMPLATES: TemplateMap = {};

/**
 * Load runtime configuration from `system_config`.
 *
 * Every missing key falls back to a hard-coded default. The
 * `defaultedKeys` array lets the worker log exactly which keys still
 * need to be seeded, so operators are not left guessing why the
 * policy engine is running in fail-closed mode.
 */
export async function loadRuntimeConfig(
  repo: SystemConfigRepository,
): Promise<LoadedRuntimeConfig> {
  const loadedKeys: string[] = [];
  const defaultedKeys: string[] = [];

  const rawRules = await repo.get<unknown>(SYSTEM_CONFIG_KEYS.interactionResponseRules);
  const rawTemplates = await repo.get<unknown>(SYSTEM_CONFIG_KEYS.interactionResponseTemplates);
  const rawMax = await repo.get<number>(SYSTEM_CONFIG_KEYS.interactionResponseMaxPerHour);
  const rawMinInterval = await repo.get<number>(
    SYSTEM_CONFIG_KEYS.interactionResponseMinIntervalSeconds,
  );

  let rules: InteractionResponseConfig['rules'] = [];
  if (Array.isArray(rawRules)) {
    rules = rawRules as InteractionResponseConfig['rules'];
    loadedKeys.push(SYSTEM_CONFIG_KEYS.interactionResponseRules);
  } else {
    defaultedKeys.push(SYSTEM_CONFIG_KEYS.interactionResponseRules);
  }

  let templates: TemplateMap = {};
  if (rawTemplates && typeof rawTemplates === 'object' && !Array.isArray(rawTemplates)) {
    templates = rawTemplates as TemplateMap;
    loadedKeys.push(SYSTEM_CONFIG_KEYS.interactionResponseTemplates);
  } else {
    defaultedKeys.push(SYSTEM_CONFIG_KEYS.interactionResponseTemplates);
  }

  let maxResponsesPerHour: number;
  if (typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax > 0) {
    maxResponsesPerHour = rawMax;
    loadedKeys.push(SYSTEM_CONFIG_KEYS.interactionResponseMaxPerHour);
  } else {
    maxResponsesPerHour = DEFAULT_INTERACTION_RESPONSE_CONFIG.maxResponsesPerHour;
    defaultedKeys.push(SYSTEM_CONFIG_KEYS.interactionResponseMaxPerHour);
  }

  let minIntervalSeconds: number;
  if (
    typeof rawMinInterval === 'number' &&
    Number.isFinite(rawMinInterval) &&
    rawMinInterval >= 0
  ) {
    minIntervalSeconds = rawMinInterval;
    loadedKeys.push(SYSTEM_CONFIG_KEYS.interactionResponseMinIntervalSeconds);
  } else {
    minIntervalSeconds = DEFAULT_INTERACTION_RESPONSE_CONFIG.minIntervalSeconds;
    defaultedKeys.push(SYSTEM_CONFIG_KEYS.interactionResponseMinIntervalSeconds);
  }

  return {
    interactionResponseConfig: {
      rules,
      maxResponsesPerHour,
      minIntervalSeconds,
    },
    templates,
    loadedKeys,
    defaultedKeys,
  };
}

/**
 * Default fallback config used when `system_config` is completely
 * unreadable (e.g., DB outage at boot).
 */
export function fallbackRuntimeConfig(): LoadedRuntimeConfig {
  return {
    interactionResponseConfig: DEFAULT_INTERACTION_RESPONSE_CONFIG,
    templates: DEFAULT_TEMPLATES,
    loadedKeys: [],
    defaultedKeys: Object.values(SYSTEM_CONFIG_KEYS),
  };
}
