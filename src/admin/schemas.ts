import { z } from 'zod';

/**
 * zod request schemas for the admin API (#11). Unknown keys are stripped (zod default), so a
 * client-supplied `id` on create is silently ignored — IDs are always server-generated.
 */

/** Shared list query: `top` (default 50, max 200), `skip` (default 0), optional `search`. */
export const listQuerySchema = z.object({
  top: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  search: z.string().trim().min(1).optional(),
});

const redirectUriType = z.enum(['web', 'spa', 'native']);

// --- Users ---------------------------------------------------------------------------------------

export const userCreateSchema = z.object({
  userPrincipalName: z.string().min(1),
  displayName: z.string().min(1),
  givenName: z.string().optional(),
  surname: z.string().optional(),
  mail: z.string().email().optional(),
  accountEnabled: z.boolean().default(true),
  password: z.string().min(1).optional(),
});

export const userPatchSchema = z
  .object({
    userPrincipalName: z.string().min(1),
    displayName: z.string().min(1),
    givenName: z.string().nullable(),
    surname: z.string().nullable(),
    mail: z.string().email().nullable(),
    accountEnabled: z.boolean(),
    // `null` clears the password (account-picker mode); a string sets a new one.
    password: z.string().min(1).nullable(),
  })
  .partial();

// --- Groups --------------------------------------------------------------------------------------

export const groupCreateSchema = z.object({
  displayName: z.string().min(1),
  description: z.string().optional(),
});

export const groupPatchSchema = z
  .object({
    displayName: z.string().min(1),
    description: z.string().nullable(),
  })
  .partial();

export const memberAddSchema = z.object({
  userId: z.string().min(1),
});

// --- Apps ----------------------------------------------------------------------------------------

/** A single optional-claim entry (Entra `optionalClaims.{idToken,accessToken}[]` shape). */
const optionalClaimSchema = z.object({
  name: z.string().min(1),
  essential: z.boolean().optional(),
  source: z.string().nullable().optional(),
  additionalProperties: z.array(z.string()).optional(),
});

/** Optional-claims configuration for the supported token collections (SAML is out of scope). */
export const optionalClaimsSchema = z.object({
  idToken: z.array(optionalClaimSchema).default([]),
  accessToken: z.array(optionalClaimSchema).default([]),
});

/** Supported group-membership claim modes. */
export const groupMembershipClaimsSchema = z.enum([
  'None',
  'SecurityGroup',
  'DirectoryRole',
  'ApplicationGroup',
  'All',
]);

/** Token preview/generation request: pick a user + token type. */
export const tokenPreviewSchema = z.object({
  userId: z.string().min(1),
  tokenType: z.enum(['idToken', 'accessToken']).default('idToken'),
});

export const appCreateSchema = z.object({
  displayName: z.string().min(1),
  isConfidential: z.boolean().default(false),
  appIdUri: z.string().min(1).optional(),
  redirectUris: z
    .array(
      z.object({
        uri: z.string().url(),
        type: redirectUriType.default('web'),
      }),
    )
    .optional(),
});

export const appPatchSchema = z
  .object({
    displayName: z.string().min(1),
    isConfidential: z.boolean(),
    appIdUri: z.string().min(1).nullable(),
    optionalClaims: optionalClaimsSchema,
    groupMembershipClaims: groupMembershipClaimsSchema,
    groupOverageLimit: z.coerce.number().int().min(1).nullable(),
  })
  .partial();

export const redirectUriCreateSchema = z.object({
  uri: z.string().url(),
  type: redirectUriType.default('web'),
});

export const secretCreateSchema = z.object({
  displayName: z.string().min(1).optional(),
  expiresInDays: z.coerce.number().int().positive().optional(),
});

export const scopeCreateSchema = z.object({
  value: z.string().min(1),
  adminConsentDisplayName: z.string().optional(),
  isEnabled: z.boolean().default(true),
});

export const scopePatchSchema = z
  .object({
    adminConsentDisplayName: z.string().nullable(),
    isEnabled: z.boolean(),
  })
  .partial();

export const roleCreateSchema = z.object({
  value: z.string().min(1),
  displayName: z.string().optional(),
  allowedMemberTypes: z.array(z.string().min(1)).min(1).default(['Application']),
  isEnabled: z.boolean().default(true),
});

export const rolePatchSchema = z
  .object({
    displayName: z.string().nullable(),
    allowedMemberTypes: z.array(z.string().min(1)).min(1),
    isEnabled: z.boolean(),
  })
  .partial();

// --- System --------------------------------------------------------------------------------------

export const seedSchema = z
  .object({
    force: z.boolean().default(false),
  })
  .default({ force: false });

export const resetSchema = z
  .object({
    reseed: z.boolean().default(true),
    resetKeys: z.boolean().default(false),
  })
  .default({ reseed: true, resetKeys: false });

export type ListQuery = z.infer<typeof listQuerySchema>;
export type UserCreate = z.infer<typeof userCreateSchema>;
export type UserPatch = z.infer<typeof userPatchSchema>;
export type GroupCreate = z.infer<typeof groupCreateSchema>;
export type GroupPatch = z.infer<typeof groupPatchSchema>;
export type AppCreate = z.infer<typeof appCreateSchema>;
export type AppPatch = z.infer<typeof appPatchSchema>;
