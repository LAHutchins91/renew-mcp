import { z } from "zod";

export const RenewStatusSchema = z.enum(["LOCKED", "DEVELOPING", "UNKNOWN", "RETIRED"]);
export const RenewKindSchema = z.enum(["ENTITLEMENT", "RENEWAL_OFFER", "FORBIDDEN_CONCESSION", "NO_CONCESSION"]);

export const RenewFactInputSchema = z.object({
  accountId: z.string().min(1),
  kind: RenewKindSchema,
  title: z.string().min(1),
  status: RenewStatusSchema.default("LOCKED"),
  content: z.string().min(1),
  tags: z.array(z.string()).default([])
});

export type RenewStatus = z.infer<typeof RenewStatusSchema>;
export type RenewKind = z.infer<typeof RenewKindSchema>;
export type RenewFactInput = z.infer<typeof RenewFactInputSchema>;
