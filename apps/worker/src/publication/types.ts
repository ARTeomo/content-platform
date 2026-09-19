/**
 * Types for the content.publish worker and the ContentPublishService.
 */

export interface ContentPublishJobData {
  publicationId: string;
}

export type PublishOutcome =
  | {
      status: 'PUBLISHED';
      externalPostId: string;
    }
  | {
      status: 'RETRY';
      errorCategory: string;
    }
  | {
      status: 'FAILED';
      errorCategory: string;
      shouldInvalidateCredential: boolean;
    }
  | {
      status: 'RECONCILIATION';
      errorCategory: string;
    }
  | {
      status: 'SKIPPED';
      reason: string;
    };

/**
 * Joined view of a publication and everything needed to build the
 * outbound post.
 */
export interface PublicationContext {
  publicationId: string;
  publicationStatus: string;
  destinationId: string;
  publicationCandidateId: string;
  externalPostId: string | null;

  candidateTitle: string;
  candidateCaption: string;
  candidateSummary: string;
  candidateSourceUrl: string;
  candidateImageId: string | null;

  destinationExternalId: string;
  destinationName: string;

  imageResolvedUrl: string | null;
  imageSourceUrl: string | null;
}
