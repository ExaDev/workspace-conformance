import { z } from 'zod';

import { order } from '../schemas/order';
import type { Inner, InnerLoose } from '../shared/chain';

export type Order = z.infer<typeof order>;

export interface Customer {
  readonly id: string;
}

export type Invoice = {
  readonly id: string;
  readonly total: number;
};

export type Note = { readonly text: string };

export type Chained = Inner;

export type ChainedLoose = InnerLoose;

type Wrapper<Value> = { readonly value: Value };

export type Wrapped = Wrapper<typeof order>;

const local = z.strictObject({ id: z.string() });

export type FromLocal = z.infer<typeof local>;

export type PartialOrder = Partial<Order>;

export type MaybeOrder = Order | undefined;

export type AnnotatedOrder = Order & { readonly note: string };

export type Orders = readonly Order[];

export interface ExtendedOrder extends Order {
  readonly note: string;
}

export type OrderOrInvoice = Order | Invoice;
