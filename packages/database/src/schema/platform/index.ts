/**
 * Platform pattern schema.
 *
 * The unified transactional outbox. It is not part of the domain model;
 * it is the platform's mechanism for bridging PostgreSQL transactions to
 * asynchronous execution.
 */
export * from './outbox-jobs.js';
