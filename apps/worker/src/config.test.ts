import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadWorkerConfig } from './config.js';

describe('loadWorkerConfig — META_CREDENTIAL_ENCRYPTION_KEYS', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubBaseEnv(keys: string): void {
    vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/db');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv('META_CREDENTIAL_ENCRYPTION_KEYS', keys);
  }

  it('parses a valid key map', () => {
    stubBaseEnv('{"v1":"a2V5"}');
    expect(loadWorkerConfig().metaCredentialEncryptionKeys).toEqual({ v1: 'a2V5' });
  });

  it('returns undefined when unset or empty', () => {
    stubBaseEnv('');
    expect(loadWorkerConfig().metaCredentialEncryptionKeys).toBeUndefined();
  });

  it('preserves the SyntaxError as cause for malformed JSON', () => {
    stubBaseEnv('{not json');
    let caught: unknown;
    try {
      loadWorkerConfig();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(
      /^META_CREDENTIAL_ENCRYPTION_KEYS is not valid JSON: /,
    );
    expect((caught as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it('preserves the validation error as cause for a non-object JSON value', () => {
    stubBaseEnv('[]');
    let caught: unknown;
    try {
      loadWorkerConfig();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).cause).toBeInstanceOf(Error);
    expect(((caught as Error).cause as Error).message).toBe('must be a JSON object');
  });

  it('preserves the validation error as cause for a non-string value', () => {
    stubBaseEnv('{"v1":1}');
    let caught: unknown;
    try {
      loadWorkerConfig();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(((caught as Error).cause as Error).message).toBe(
      'value for key "v1" must be a base64 string',
    );
  });
});
