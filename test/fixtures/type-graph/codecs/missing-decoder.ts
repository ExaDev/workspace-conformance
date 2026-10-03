export { decodeUser, encodeUser } from './complete';

export function encodeInvoice(total: number): string {
  return String(total);
}
