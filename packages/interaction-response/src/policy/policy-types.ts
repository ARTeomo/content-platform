/**
 * Policy engine input and output types.
 *
 * The policy engine is deterministic and rule-based. AI is not used to
 * make the decision in DB v1.
 */

export type InteractionType = 'COMMENT' | 'REACTION' | 'MENTION';

export type TrustLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type PolicyAction = 'IGNORE' | 'AUTO_RESPOND' | 'MODERATION_REQUIRED' | 'NOTIFICATION_ONLY';

/**
 * Rule-level action. Narrower than PolicyAction: rules cannot express
 * NOTIFICATION_ONLY, which is reserved for the type-based fallback.
 */
export type RuleAction = 'AUTO_RESPOND' | 'MODERATION_REQUIRED' | 'IGNORE';

export interface RuleMatch {
  keywords?: string[];
  regex?: string;
  actorExternalIds?: string[];
}

export interface PolicyRule {
  id: string;
  priority: number;
  action: RuleAction;
  templateId?: string;
  match: RuleMatch;
}

export interface PolicyInput {
  interactionType: InteractionType;
  actorExternalId?: string;
  content?: string;
  destinationTrustLevel: TrustLevel;

  /** Number of responses sent to this destination in the last hour. */
  recentResponseCount: number;

  /** Maximum number of responses allowed per hour. */
  maxResponsesPerHour: number;

  /**
   * Minimum required interval between two responses to the same
   * destination, in seconds.
   *
   * When undefined or zero, no minimum interval is enforced.
   */
  minIntervalSeconds?: number;

  /**
   * Seconds elapsed since the last RESPONDED response to this
   * destination.
   *
   * When undefined, no prior response exists and the interval check is
   * skipped.
   */
  secondsSinceLastResponse?: number;
}

export interface ResponseDecision {
  action: PolicyAction;
  reason: string;
  templateId?: string;
  matchedRuleId?: string;
}

export interface PolicyEngineOptions {
  rules: PolicyRule[];
}

export interface PolicyEngine {
  decide(input: PolicyInput): ResponseDecision;
}
