import { z } from 'zod';
import { EventType } from '@/types/events';

const VALID_EVENT_TYPES: [EventType, ...EventType[]] = [
  'NEW_MODEL',
  'MODEL_REMOVED',
  'PRICE_CHANGE',
  'BECAME_FREE',
  'LEFT_FREE',
  'CONTEXT_CHANGED',
];

export const modelsQuerySchema = z.object({
  q: z.string().max(100).optional(),
  provider: z.string().max(50).optional(),
  free: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
  sortBy: z.enum(['name', 'price', 'context', 'updated']).default('name'),
  limit: z
    .string()
    .optional()
    .default('50')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(1).max(100)),
  offset: z
    .string()
    .optional()
    .default('0')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(0)),
});

export const eventsQuerySchema = z.object({
  types: z.string().optional(),
  type: z.string().optional(),
  provider: z.string().max(50).optional(),
  free: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
  q: z.string().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z
    .string()
    .optional()
    .default('50')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(1).max(100)),
  offset: z
    .string()
    .optional()
    .default('0')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(0)),
});

export const benchmarksQuerySchema = z.object({
  provider: z.string().max(50).optional(),
});
