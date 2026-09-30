import { z } from 'zod';

export const createOrder = z.strictObject({ sku: z.string() });
