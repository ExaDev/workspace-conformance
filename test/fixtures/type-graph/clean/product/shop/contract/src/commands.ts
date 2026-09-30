import { z } from 'zod';

import { createOrder } from './schemas';
import { type output, ship } from './standard';

export type CreateOrder = z.infer<typeof createOrder>;

export type ShipOrder = output<typeof ship>;

export type Command = CreateOrder | ShipOrder;
