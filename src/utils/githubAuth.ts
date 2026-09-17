import { createHash, createHmac, timingSafeEqual } from 'crypto';

export function verifyWebhookSignature(body: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

export function verifyTriggerToken(authorization: string | null, secret: string): boolean {
  if (!secret || !authorization?.startsWith('Bearer ')) return false;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(authorization.slice(7)), hash(secret));
}
