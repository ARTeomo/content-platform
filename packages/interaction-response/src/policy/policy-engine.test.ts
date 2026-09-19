import { describe, expect, it } from 'vitest';
import { DefaultPolicyEngine } from './policy-engine.js';
import type { PolicyInput, PolicyRule } from './policy-types.js';

function baseInput(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    interactionType: 'COMMENT',
    actorExternalId: 'user-1',
    content: 'hello world',
    destinationTrustLevel: 'HIGH',
    recentResponseCount: 0,
    maxResponsesPerHour: 20,
    ...overrides,
  };
}

describe('DefaultPolicyEngine', () => {
  it('returns IGNORE for reactions', () => {
    const engine = new DefaultPolicyEngine({ rules: [] });
    const decision = engine.decide(baseInput({ interactionType: 'REACTION' }));
    expect(decision.action).toBe('IGNORE');
  });

  it('returns NOTIFICATION_ONLY for mentions', () => {
    const engine = new DefaultPolicyEngine({ rules: [] });
    const decision = engine.decide(baseInput({ interactionType: 'MENTION' }));
    expect(decision.action).toBe('NOTIFICATION_ONLY');
  });

  it('returns MODERATION_REQUIRED when the rate limit is exceeded', () => {
    const engine = new DefaultPolicyEngine({ rules: [] });
    const decision = engine.decide(baseInput({ recentResponseCount: 20, maxResponsesPerHour: 20 }));
    expect(decision.action).toBe('MODERATION_REQUIRED');
    expect(decision.reason).toContain('rate limit');
  });

  it('returns MODERATION_REQUIRED for LOW trust destinations', () => {
    const engine = new DefaultPolicyEngine({ rules: [] });
    const decision = engine.decide(baseInput({ destinationTrustLevel: 'LOW' }));
    expect(decision.action).toBe('MODERATION_REQUIRED');
    expect(decision.reason).toContain('trust level');
  });

  it('returns MODERATION_REQUIRED when no rule matches (fail-closed)', () => {
    const engine = new DefaultPolicyEngine({ rules: [] });
    const decision = engine.decide(baseInput());
    expect(decision.action).toBe('MODERATION_REQUIRED');
    expect(decision.reason).toContain('no matching');
  });

  it('returns AUTO_RESPOND when a keyword rule matches', () => {
    const rules: PolicyRule[] = [
      {
        id: 'rule-thanks',
        priority: 10,
        action: 'AUTO_RESPOND',
        templateId: 'thanks-template',
        match: { keywords: ['thanks', 'koszon'] },
      },
    ];
    const engine = new DefaultPolicyEngine({ rules });
    const decision = engine.decide(baseInput({ content: 'thanks for the post!' }));
    expect(decision.action).toBe('AUTO_RESPOND');
    expect(decision.templateId).toBe('thanks-template');
    expect(decision.matchedRuleId).toBe('rule-thanks');
  });

  it('respects rule priority (lower number wins)', () => {
    const rules: PolicyRule[] = [
      {
        id: 'rule-ignore',
        priority: 5,
        action: 'IGNORE',
        match: { keywords: ['spam'] },
      },
      {
        id: 'rule-auto',
        priority: 10,
        action: 'AUTO_RESPOND',
        templateId: 't',
        match: { keywords: ['spam'] },
      },
    ];
    const engine = new DefaultPolicyEngine({ rules });
    const decision = engine.decide(baseInput({ content: 'spam here' }));
    expect(decision.action).toBe('IGNORE');
    expect(decision.matchedRuleId).toBe('rule-ignore');
  });

  it('falls back to MODERATION_REQUIRED when AUTO_RESPOND has no templateId', () => {
    const rules: PolicyRule[] = [
      {
        id: 'broken-rule',
        priority: 10,
        action: 'AUTO_RESPOND',
        match: { keywords: ['hi'] },
      },
    ];
    const engine = new DefaultPolicyEngine({ rules });
    const decision = engine.decide(baseInput({ content: 'hi there' }));
    expect(decision.action).toBe('MODERATION_REQUIRED');
    expect(decision.reason).toContain('no templateId');
  });

  it('matches by actorExternalId', () => {
    const rules: PolicyRule[] = [
      {
        id: 'vip',
        priority: 1,
        action: 'AUTO_RESPOND',
        templateId: 'vip-template',
        match: { actorExternalIds: ['vip-user'] },
      },
    ];
    const engine = new DefaultPolicyEngine({ rules });
    const decision = engine.decide(baseInput({ actorExternalId: 'vip-user' }));
    expect(decision.action).toBe('AUTO_RESPOND');
  });

  it('does not match a rule whose actorExternalIds does not include the actor', () => {
    const rules: PolicyRule[] = [
      {
        id: 'vip',
        priority: 1,
        action: 'AUTO_RESPOND',
        templateId: 'vip-template',
        match: { actorExternalIds: ['vip-user'] },
      },
    ];
    const engine = new DefaultPolicyEngine({ rules });
    const decision = engine.decide(baseInput({ actorExternalId: 'other-user' }));
    expect(decision.action).toBe('MODERATION_REQUIRED');
  });

  it('handles invalid regex gracefully (rule never matches)', () => {
    const rules: PolicyRule[] = [
      {
        id: 'bad-regex',
        priority: 1,
        action: 'AUTO_RESPOND',
        templateId: 't',
        match: { regex: '[unclosed' },
      },
    ];
    const engine = new DefaultPolicyEngine({ rules });
    const decision = engine.decide(baseInput({ content: 'anything' }));
    expect(decision.action).toBe('MODERATION_REQUIRED');
  });
});
