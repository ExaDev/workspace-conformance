import type { z } from 'zod';

import type { order } from '../schemas/order';

export type Base = z.infer<typeof order>;

export type Loose = { readonly id: string };
