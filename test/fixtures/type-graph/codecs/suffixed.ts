export const userEncoder = (id: string): string => id;

export const userDecoder = (text: string): string => text;

export interface OrderEncoder {
  readonly encode: (id: string) => string;
}

export class PaymentEncoder {
  encode(amount: number): string {
    return String(amount);
  }
}
