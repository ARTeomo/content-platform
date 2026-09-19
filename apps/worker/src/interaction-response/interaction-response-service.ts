import { createHash } from 'node:crypto';
import type {
  InteractionResponsesRepository,
  OutboxRepository,
  TransactionManager,
} from '@content-platform/database';
import {
  DefaultPolicyEngine,
  TemplateRenderer,
  TemplateRenderError,
  type TemplateContext,
} from '@content-platform/interaction-response';
import type {
  DecideOutcome,
  DestinationSnapshot,
  InteractionResponseConfig,
  InteractionSnapshot,
  PublicationSnapshot,
  TemplateMap,
} from './types.js';
import { buildPolicyInput } from './types.js';

export interface InteractionResponseServiceDeps {
  txManager: TransactionManager;
  responsesRepo: InteractionResponsesRepository;
  outboxRepo: OutboxRepository;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export class InteractionResponseService {
  private readonly deps: InteractionResponseServiceDeps;
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;
  private readonly renderer: TemplateRenderer;

  constructor(deps: InteractionResponseServiceDeps) {
    this.deps = deps;
    this.log = deps.logger ?? console;
    this.renderer = new TemplateRenderer();
  }

  async decide(args: {
    interaction: InteractionSnapshot;
    destination: DestinationSnapshot;
    publication: PublicationSnapshot | null;
    config: InteractionResponseConfig;
    templates: TemplateMap;
  }): Promise<DecideOutcome> {
    const { interaction, destination, config, templates, publication } = args;

    const existing = await this.deps.responsesRepo.findByInteractionId(interaction.id);
    if (existing) {
      this.log.info(
        `[interaction-response] interaction ${interaction.id} already has response ${existing.id} (status=${existing.status})`,
      );
      return this.outcomeFromExisting(existing);
    }

    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recentResponseCount = await this.deps.responsesRepo.countRecentByDestination(
      destination.id,
      since,
    );

    const engine = new DefaultPolicyEngine({ rules: config.rules });
    const decision = engine.decide(
      buildPolicyInput({
        interaction,
        destination,
        recentResponseCount,
        config,
      }),
    );

    if (decision.action === 'IGNORE') {
      this.log.info(
        `[interaction-response] interaction ${interaction.id} ignored: ${decision.reason}`,
      );
      return { kind: 'IGNORED', reason: decision.reason };
    }

    if (decision.action === 'NOTIFICATION_ONLY') {
      this.log.info(
        `[interaction-response] interaction ${interaction.id} notification-only: ${decision.reason}`,
      );
      return { kind: 'NOTIFICATION_ONLY', reason: decision.reason };
    }

    if (decision.action === 'MODERATION_REQUIRED') {
      const responseId = await this.createResponse({
        interactionId: interaction.id,
        destinationId: destination.id,
        status: 'MODERATION_REQUIRED',
        ...(decision.templateId !== undefined && { templateId: decision.templateId }),
      });
      return { kind: 'MODERATION_REQUIRED', responseId, reason: decision.reason };
    }

    // AUTO_RESPOND path.
    if (!decision.templateId) {
      const responseId = await this.createResponse({
        interactionId: interaction.id,
        destinationId: destination.id,
        status: 'MODERATION_REQUIRED',
      });
      return {
        kind: 'MODERATION_REQUIRED',
        responseId,
        reason: 'AUTO_RESPOND without templateId',
      };
    }

    const template = templates[decision.templateId];
    if (template === undefined) {
      const responseId = await this.createResponse({
        interactionId: interaction.id,
        destinationId: destination.id,
        status: 'MODERATION_REQUIRED',
        templateId: decision.templateId,
      });
      this.log.warn(
        `[interaction-response] interaction ${interaction.id}: template '${decision.templateId}' not found, deferring to moderation`,
      );
      return {
        kind: 'MODERATION_REQUIRED',
        responseId,
        reason: `template ${decision.templateId} not found`,
      };
    }

    const context = this.buildTemplateContext(interaction, destination, publication);

    let body: string;
    try {
      const rendered = this.renderer.render(template, context);
      body = rendered.body;
    } catch (err) {
      if (err instanceof TemplateRenderError) {
        const responseId = await this.createResponse({
          interactionId: interaction.id,
          destinationId: destination.id,
          status: 'MODERATION_REQUIRED',
          templateId: decision.templateId,
        });
        this.log.warn(
          `[interaction-response] interaction ${interaction.id}: template render failed (missing: ${err.missingPlaceholders.join(', ')}), deferring to moderation`,
        );
        return {
          kind: 'MODERATION_REQUIRED',
          responseId,
          reason: `template render failed: missing ${err.missingPlaceholders.join(', ')}`,
        };
      }
      throw err;
    }

    const responseId = await this.createResponse({
      interactionId: interaction.id,
      destinationId: destination.id,
      status: 'AUTO_RESPOND',
      templateId: decision.templateId,
      body,
      enqueueRespondJob: true,
    });

    return {
      kind: 'AUTO_RESPOND',
      responseId,
      templateId: decision.templateId,
      body,
    };
  }

  requestPayloadHash(body: string): string {
    return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
  }

  private outcomeFromExisting(row: {
    id: string;
    status: string;
    templateId: string | null;
    body: string | null;
  }): DecideOutcome {
    switch (row.status) {
      case 'AUTO_RESPOND':
      case 'APPROVED':
      case 'SCHEDULED':
      case 'QUEUED':
      case 'IN_PROGRESS':
      case 'RESPONDED':
        return {
          kind: 'AUTO_RESPOND',
          responseId: row.id,
          templateId: row.templateId ?? '',
          body: row.body ?? '',
        };
      case 'REJECTED':
        return { kind: 'IGNORED', reason: 'previously rejected' };
      case 'FAILED':
        return { kind: 'IGNORED', reason: 'previously failed' };
      default:
        return {
          kind: 'MODERATION_REQUIRED',
          responseId: row.id,
          reason: `existing response status: ${row.status}`,
        };
    }
  }

  private buildTemplateContext(
    interaction: InteractionSnapshot,
    destination: DestinationSnapshot,
    publication: PublicationSnapshot | null,
  ): TemplateContext {
    const context: TemplateContext = {
      destination_name: destination.name,
    };
    if (interaction.actorDisplayName !== null) {
      context['actor_display_name'] = interaction.actorDisplayName;
    }
    if (interaction.content !== null) {
      context['content_snippet'] = interaction.content.slice(0, 80);
    }
    if (publication !== null) {
      context['publication_title'] = publication.title;
    }
    return context;
  }

  private async createResponse(input: {
    interactionId: string;
    destinationId: string;
    status: 'AUTO_RESPOND' | 'MODERATION_REQUIRED' | 'DRAFT';
    templateId?: string;
    body?: string;
    enqueueRespondJob?: boolean;
  }): Promise<string> {
    const row = await this.deps.txManager.run(async (tx) => {
      const created = await this.deps.responsesRepo.create(tx, {
        interactionId: input.interactionId,
        destinationId: input.destinationId,
        status: input.status,
        ...(input.templateId !== undefined && { templateId: input.templateId }),
        ...(input.body !== undefined && { body: input.body }),
      });

      if (input.enqueueRespondJob === true) {
        await this.deps.outboxRepo.enqueue(tx, {
          queueName: 'webhook.respond',
          jobId: `webhook.respond:${created.id}`,
          payload: { responseId: created.id },
        });
      }

      return created;
    });
    return row.id;
  }
}
