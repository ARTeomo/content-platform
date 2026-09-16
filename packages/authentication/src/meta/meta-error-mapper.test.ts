import { describe, expect, it } from 'vitest';
import { MetaErrorMapper, MetaGraphApiError } from './meta-error-mapper.js';

describe('MetaErrorMapper', () => {
  it('categorizes a 190 (OAuth) code as AUTHENTICATION_ERROR', () => {
    const err = new MetaGraphApiError({
      message: 'Invalid OAuth access token',
      httpStatus: 400,
      code: 190,
    });
    expect(MetaErrorMapper.categorizeApiError(err)).toBe('AUTHENTICATION_ERROR');
  });

  it('categorizes a 102 (session expired) code as AUTHENTICATION_ERROR', () => {
    const err = new MetaGraphApiError({
      message: 'Session key invalid',
      httpStatus: 400,
      code: 102,
    });
    expect(MetaErrorMapper.categorizeApiError(err)).toBe('AUTHENTICATION_ERROR');
  });

  it('categorizes a 200 (permission) code as PERMISSION_ERROR', () => {
    const err = new MetaGraphApiError({
      message: 'Permission denied',
      httpStatus: 403,
      code: 200,
    });
    expect(MetaErrorMapper.categorizeApiError(err)).toBe('PERMISSION_ERROR');
  });

  it('categorizes a 4 code as RATE_LIMIT', () => {
    const err = new MetaGraphApiError({
      message: 'Application request limit reached',
      httpStatus: 400,
      code: 4,
    });
    expect(MetaErrorMapper.categorizeApiError(err)).toBe('RATE_LIMIT');
  });

  it('categorizes a 1 code as TRANSIENT_ERROR', () => {
    const err = new MetaGraphApiError({
      message: 'Unknown error',
      httpStatus: 500,
      code: 1,
    });
    expect(MetaErrorMapper.categorizeApiError(err)).toBe('TRANSIENT_ERROR');
  });

  it('categorizes a 100 code as VALIDATION_ERROR', () => {
    const err = new MetaGraphApiError({
      message: 'Invalid parameter',
      httpStatus: 400,
      code: 100,
    });
    expect(MetaErrorMapper.categorizeApiError(err)).toBe('VALIDATION_ERROR');
  });

  it('falls back to HTTP status when the code is unknown', () => {
    const err = new MetaGraphApiError({
      message: 'Server error',
      httpStatus: 503,
      code: 9999,
    });
    expect(MetaErrorMapper.categorizeApiError(err)).toBe('TRANSIENT_ERROR');
  });

  it('categorizes a network-level error (ECONNREFUSED) as NETWORK_ERROR', () => {
    const err = new Error('connect ECONNREFUSED') as NodeJS.ErrnoException;
    err.code = 'ECONNREFUSED';
    expect(MetaErrorMapper.categorize(err)).toBe('NETWORK_ERROR');
  });

  it('categorizes an AbortError as NETWORK_ERROR', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(MetaErrorMapper.categorize(err)).toBe('NETWORK_ERROR');
  });

  it('categorizes an unknown error as UNKNOWN_ERROR', () => {
    expect(MetaErrorMapper.categorize(new Error('something weird'))).toBe('UNKNOWN_ERROR');
    expect(MetaErrorMapper.categorize('not an error')).toBe('UNKNOWN_ERROR');
  });

  it('parse returns null for non-error payloads', () => {
    expect(MetaErrorMapper.parse(null, 400)).toBeNull();
    expect(MetaErrorMapper.parse({ foo: 'bar' }, 400)).toBeNull();
    expect(MetaErrorMapper.parse({ error: { message: 'x' } }, 400)).toBeNull();
  });

  it('parse extracts the error payload fields', () => {
    const err = MetaErrorMapper.parse(
      {
        error: {
          message: 'Invalid token',
          type: 'OAuthException',
          code: 190,
          error_subcode: 460,
          fbtrace_id: 'ABC123',
        },
      },
      400,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(190);
    expect(err!.subcode).toBe(460);
    expect(err!.fbtraceId).toBe('ABC123');
    expect(err!.httpStatus).toBe(400);
  });
});
