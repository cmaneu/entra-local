export const config = {
  port: Number(process.env.PORT ?? 4001),
  origin: process.env.EMULATOR_ORIGIN ?? 'https://localhost:8443',
  tenantId: process.env.TENANT_ID ?? '11111111-1111-1111-1111-111111111111',
  clientId: process.env.API_CLIENT_ID ?? 'cccccccc-0000-0000-0000-000000000009',
  clientSecret: process.env.API_CLIENT_SECRET ?? 'obo-middle-tier-secret',
  incomingScope: process.env.INCOMING_SCOPE ?? 'access_as_user',
  downstreamScope: process.env.DOWNSTREAM_SCOPE ?? 'User.Read',
  spaOrigin: process.env.SPA_ORIGIN ?? 'http://localhost:5174',
} as const;

export const authority = `${config.origin}/${config.tenantId}`;
export const issuer = `${authority}/v2.0`;
export const jwksUri = `${authority}/discovery/v2.0/keys`;
export const graphMeUrl = `${config.origin}/graph/v1.0/me`;
