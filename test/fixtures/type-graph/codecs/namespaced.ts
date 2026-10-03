export namespace Wire {
  export function encodeOrder(id: string): string {
    return id;
  }

  export function decodeOrder(text: string): string {
    return text;
  }

  export function encodeRefund(id: string): string {
    return id;
  }
}

export * as Legacy from './missing-encoder';
