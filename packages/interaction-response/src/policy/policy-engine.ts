import type {
  PolicyEngine,
  PolicyEngineOptions,
  PolicyInput,
  PolicyRule,
  ResponseDecision,
} from './policy-types.js';

/**
 * Deterministic rule-based policy engine.
 *
 * Decision order:
 *
 *   1. REACTION -> IGNORE
 *   2. MENTION  -> NOTIFICATION_ONLY (v1 default)
 *   3. Rate limit exceeded -> MODERATION_REQUIRED
 *   4. Destination trust level LOW -> MODERATION_REQUIRED
 *   5. Match rules by ascending priority
 *   6. No match -> MODERATION_REQUIRED (fail-closed)
 *
 * Steps 1-2 are type-based shortcuts. Steps 3-6 apply to COMMENT.
 *
 * The engine is pure: it does not read from the database, does not call
 * external services, and does not perform any I/O. The caller is
 * responsible for supplying all inputs.
 */
export class DefaultPolicyEngine implements PolicyEngine {
  private readonly sortedRules: PolicyRule[];

  constructor(options: PolicyEngineOptions) {
    this.sortedRules = [...options.rules].sort((a, b) => a.priority - b.priority);
  }

  decide(input: PolicyInput): ResponseDecision {
    // 1. Reactions never generate an outbound response.
    if (input.interactionType === 'REACTION') {
      return { action: 'IGNORE', reason: 'reactions do not generate responses' };
    }

    // 2. Mentions notify only in v1. Auto-respond for mentions is deferred.
    if (input.interactionType === 'MENTION') {
      return {
        action: 'NOTIFICATION_ONLY',
        reason: 'mentions notify only in v1',
      };
    }

    // 3. Rate limit exceeded -> defer to a human.
    if (input.recentResponseCount >= input.maxResponsesPerHour) {
      return {
        action: 'MODERATION_REQUIRED',
        reason: 'rate limit exceeded',
      };
    }

    // 4. Untrusted destination -> defer to a human.
    if (input.destinationTrustLevel === 'LOW') {
      return {
        action: 'MODERATION_REQUIRED',
        reason: 'destination trust level is LOW',
      };
    }

    // 5. Match rules by ascending priority.
    for (const rule of this.sortedRules) {
      if (!this.matches(rule, input)) continue;

      if (rule.action === 'AUTO_RESPOND') {
        if (!rule.templateId) {
          return {
            action: 'MODERATION_REQUIRED',
            reason: `rule ${rule.id} is AUTO_RESPOND but has no templateId`,
            matchedRuleId: rule.id,
          };
        }
        return {
          action: 'AUTO_RESPOND',
          reason: `matched rule ${rule.id}`,
          templateId: rule.templateId,
          matchedRuleId: rule.id,
        };
      }

      if (rule.action === 'IGNORE') {
        return {
          action: 'IGNORE',
          reason: `matched rule ${rule.id}`,
          matchedRuleId: rule.id,
        };
      }

      // MODERATION_REQUIRED
      return {
        action: 'MODERATION_REQUIRED',
        reason: `matched rule ${rule.id}`,
        matchedRuleId: rule.id,
      };
    }

    // 6. Fail-closed: no matching auto-respond rule.
    return {
      action: 'MODERATION_REQUIRED',
      reason: 'no matching auto-respond rule',
    };
  }

  private matches(rule: PolicyRule, input: PolicyInput): boolean {
    const { match } = rule;

    if (match.actorExternalIds && match.actorExternalIds.length > 0) {
      if (!input.actorExternalId) return false;
      if (!match.actorExternalIds.includes(input.actorExternalId)) return false;
    }

    if (match.keywords && match.keywords.length > 0) {
      if (!input.content) return false;
      const haystack = input.content.toLowerCase();
      const found = match.keywords.some((kw) => haystack.includes(kw.toLowerCase()));
      if (!found) return false;
    }

    if (match.regex) {
      if (!input.content) return false;
      try {
        if (!new RegExp(match.regex).test(input.content)) return false;
      } catch {
        // Invalid regex in configuration -> rule never matches.
        return false;
      }
    }

    return true;
  }
}
