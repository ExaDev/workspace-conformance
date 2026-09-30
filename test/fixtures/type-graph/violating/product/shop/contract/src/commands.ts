import { z } from 'zod';

const createOrder = z.strictObject({ sku: z.string() });
const plain = { sku: 'a' };

export type CreateOrder = z.infer<typeof createOrder>;

export interface CancelOrder {
  readonly orderId: string;
}

export type RefundOrder = {
  readonly orderId: string;
};

export type PayOrder = z.infer<typeof plain>;

export type Command = CreateOrder | CancelOrder | RefundOrder | PayOrder;
