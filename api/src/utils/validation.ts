import { z } from 'zod';

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(20, 'Username must be at most 20 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores and hyphens')
  .refine((v) => v.toLowerCase() !== 'global', 'That username is reserved');

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long');

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(20),
  password: z.string().min(1, 'Password is required').max(128),
});

const replyToSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    user: z.string(),
    text: z.string(),
  })
  .nullable()
  .optional();

const attachmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(180),
});

export const chatMessageSchema = z.object({
  msg: z.string().trim().max(500),
  attachments: z.array(attachmentSchema).max(4).optional().default([]),
  to: z.string().trim().min(1).max(20).optional(),
  replyTo: replyToSchema,
}).refine((message) => message.msg.length > 0 || message.attachments.length > 0, 'Write a message or attach a file');

export const editMessageSchema = z.object({
  id: z.union([z.string(), z.number()]),
  newMsg: z.string().trim().min(1).max(500),
});

export const idSchema = z.union([z.string(), z.number()]);

const emojiSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const emojiCharacter = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u;

function isSingleEmoji(value: string): boolean {
  const normalized = value.trim();
  return [...emojiSegmenter.segment(normalized)].length === 1 && emojiCharacter.test(normalized);
}

export const reactionSchema = z.object({
  id: idSchema,
  emoji: z.string().trim().min(1).max(32).refine(isSingleEmoji, 'Choose one emoji'),
});

export const forwardMessageSchema = z.object({
  id: idSchema,
  to: z.union([z.literal('global'), usernameSchema]),
});

export const bioSchema = z.string().trim().max(200);

export const updateProfileSchema = z.object({
  bio: bioSchema,
});

export const updateAccountSchema = z.object({
  username: usernameSchema.nullable().optional(),
  password: passwordSchema.nullable().optional(),
});

export const usernameOnlySchema = usernameSchema;

export const typingSchema = z.object({
  to: z.string().trim().min(1).max(20),
  isTyping: z.boolean(),
});

export const presenceStatusSchema = z.enum(['online', 'idle', 'dnd']);

export const adminUserSchema = z.object({ username: usernameSchema });

export const adminTimeoutSchema = z.object({
  username: usernameSchema,
  mins: z.number().int().min(1).max(10080), // max 1 week
});

export const adminMessageSchema = z.object({ id: idSchema });

export const announcementSchema = z.object({
  msg: z.string().trim().max(300),
  important: z.boolean().optional().default(false),
});

export function safeParse<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown
): { ok: true; data: z.infer<S> } | { ok: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  const message = result.error.issues[0]?.message || 'Invalid input';
  return { ok: false, error: message };
}