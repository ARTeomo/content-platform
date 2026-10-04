import type {
  InteractionType,
  PolicyInput,
  PolicyRule,
  TrustLevel,
} from '@content-platform/interaction-response';

export interface InteractionResponseConfig {
  rules: PolicyRule[];
  maxResponsesPerHour: number;
  minIntervalSeconds: number;
}

export interface InteractionSnapshot {
  id: string;
  destinationId: string;
  interactionType: InteractionType;
  externalInteractionId: string;
  actorExternalId: string | null;
  actorDisplayName: string | null;
  content: string | null;
  parentExternalId: string | null;
  publicationId: string | null;
}

export interface DestinationSnapshot {
  id: string;
  name: string;
  trustLevel: TrustLevel;
}

export interface PublicationSnapshot {
  id: string;
  title: string;
  externalPostId: string | null;
}

export type TemplateMap = Record<string, string>;

export type DecideOutcome =
  | { kind: 'IGNORED'; reason: string }
  | { kind: 'NOTIFICATION_ONLY'; reason: string }
  | {
      kind: 'AUTO_RESPOND';
      responseId: string;
      templateId: string;
      body: string;
    }
  | {
      kind: 'MODERATION_REQUIRED';
      responseId: string;
      reason: string;
    };

/**
 * Helper: build the policy engine input from service-level inputs.
 *
 * `secondsSinceLastResponse` is the elapsed time since the most recent
 * RESPONDED response to the destination, or undefined when no prior
 * response exists. `minIntervalSeconds` is only forwarded when it is
 * greater than zero.
 */
export function buildPolicyInput(args: {
  interaction: InteractionSnapshot;
  destination: DestinationSnapshot;
  recentResponseCount: number;
  secondsSinceLastResponse: number | undefined;
  config: InteractionResponseConfig;
}): PolicyInput {
  const input: PolicyInput = {
    interactionType: args.interaction.interactionType,
    destinationTrustLevel: args.destination.trustLevel,
    recentResponseCount: args.recentResponseCount,
    maxResponsesPerHour: args.config.maxResponsesPerHour,
  };
  if (args.interaction.actorExternalId !== null) {
    input.actorExternalId = args.interaction.actorExternalId;
  }
  if (args.interaction.content !== null) {
    input.content = args.interaction.content;
  }
  if (args.config.minIntervalSeconds > 0) {
    input.minIntervalSeconds = args.config.minIntervalSeconds;
  }
  if (args.secondsSinceLastResponse !== undefined) {
    input.secondsSinceLastResponse = args.secondsSinceLastResponse;
  }
  return input;
}
