import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify the X-Hub-Signature-256 header against the raw HTTP body.
 *
 * Format: `sha256=<hex>`. The HMAC is computed over the raw bytes,
 * not the parsed JSON.
 *
 * Fails closed on any mismatch, malformed header, or missing header.
 */
export function verifyMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const providedHex = signatureHeader.slice('sha256='.length);
  if (providedHex.length === 0) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const providedBuffer = Buffer.from(providedHex, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  if (providedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(providedBuffer, expectedBuffer);
}
