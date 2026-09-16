/**
 * Minimal queue contract for the outbox dispatcher.
 *
 * The dispatcher only needs to enqueue a job with a deterministic
 * `jobId`. The `jobId` is the BullMQ deduplication key; the actual
 * implementation is responsible for translating it to the underlying
 * queue system's deduplication mechanism.
 */
export interface JobQueue {
  /**
   * Enqueue a job.
   *
   * @param name - The BullMQ job name (e.g. `webhook.process`).
   * @param payload - The job payload (identifiers only).
   * @param jobId - Deterministic deduplication key.
   */
  add(name: string, payload: Record<string, unknown>, jobId: string): Promise<void>;

  /** Close the underlying connection. */
  close(): Promise<void>;
}
