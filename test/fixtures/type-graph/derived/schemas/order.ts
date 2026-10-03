import { z } from 'zod';

export const order = z.strictObject({ id: z.string(), total: z.number() });
