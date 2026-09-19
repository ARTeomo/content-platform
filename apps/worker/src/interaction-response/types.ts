import type {
  InteractionType,
  PolicyInput,
  PolicyRule,
  TrustLevel,
} from '@content-platform/interaction-response';

/**
 * Configuration for the service, loaded from system_config.
 */
export interface InteractionResponseConfig {
  rules: PolicyRule[];
  maxResponsesPerHour: number;
  minIntervalSeconds: number;
}

/**
 * Snapshot of an inbound interaction passed to the service.
 */
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

/**
 * Snapshot of the destination.
 */
export interface DestinationSnapshot {
  id: string;
  name: string;
  trustLevel: TrustLevel;
}

/**
 * Snapshot of the publication, when the interaction is linked to one.
 */
export interface PublicationSnapshot {
  id: string;
  title: string;
  externalPostId: string | null;
}

/**
 * Map of template ID -> template body, loaded from system_config.
 */
export type TemplateMap = Record<string, string>;

/**
 * The outcome of the decide phase. The caller (worker) uses this to
 * determine what to enqueue or skip.
 */
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
 */
export function buildPolicyInput(args: {
  interaction: InteractionSnapshot;
  destination: DestinationSnapshot;
  recentResponseCount: number;
  config: InteractionResponseConfig;
}): PolicyInput {
  return {
    interactionType: args.interaction.interactionType,
    ...(args.interaction.actorExternalId !== null && {
      actorExternalId: args.interaction.actorExternalId,
    }),
    ...(args.interaction.content !== null && { content: args.interaction.content }),
    destinationTrustLevel: args.destination.trustLevel,
    recentResponseCount: args.recentResponseCount,
    maxResponsesPerHour: args.config.maxResponsesPerHour,
  };
}
