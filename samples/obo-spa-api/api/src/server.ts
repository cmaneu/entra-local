import { ConfidentialClientApplication } from '@azure/msal-node';
import cors from 'cors';
import express, { type Request } from 'express';
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import { authority, config, graphMeUrl, issuer, jwksUri } from './config.js';

interface DelegatedClaims extends JWTPayload {
  oid?: string;
  scp?: string;
  azp?: string;
  appid?: string;
}

interface AuthedRequest extends Request {
  accessToken?: string;
  claims?: DelegatedClaims;
}

const app = express();
app.use(cors({ origin: config.spaOrigin }));
app.use(express.json());

const jwks = createRemoteJWKSet(new URL(jwksUri));
const msal = new ConfidentialClientApplication({
  auth: {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    authority,
    knownAuthorities: [new URL(config.origin).host],
  },
});

function bearer(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return match?.[1]?.trim();
}

async function authenticate(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  const token = bearer(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: config.clientId,
    });
    const scopes = String(payload.scp ?? '').split(' ').filter(Boolean);
    if (!scopes.includes(config.incomingScope)) {
      res.status(403).json({ error: 'insufficient_scope' });
      return;
    }
    req.accessToken = token;
    req.claims = payload;
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/me', authenticate, async (req: AuthedRequest, res) => {
  try {
    const result = await msal.acquireTokenOnBehalfOf({
      oboAssertion: req.accessToken!,
      scopes: [config.downstreamScope],
    });
    if (!result?.accessToken) throw new Error('OBO exchange returned no access token.');

    const downstreamClaims = decodeJwt(result.accessToken) as DelegatedClaims;
    const graphResponse = await fetch(graphMeUrl, {
      headers: { Authorization: ['Bearer', result.accessToken].join(' ') },
    });
    if (!graphResponse.ok) throw new Error(`Graph returned ${graphResponse.status}.`);
    const profile = (await graphResponse.json()) as Record<string, unknown>;

    res.json({
      profile,
      incoming: {
        aud: req.claims?.aud,
        oid: req.claims?.oid,
        azp: req.claims?.azp ?? req.claims?.appid,
        scp: req.claims?.scp,
      },
      downstream: {
        aud: downstreamClaims.aud,
        oid: downstreamClaims.oid,
        azp: downstreamClaims.azp ?? downstreamClaims.appid,
        appid: downstreamClaims.appid,
        scp: downstreamClaims.scp,
      },
      oidContinuity: req.claims?.oid === downstreamClaims.oid,
    });
  } catch (error) {
    res.status(502).json({
      error: 'obo_exchange_failed',
      error_description: error instanceof Error ? error.message : 'Unknown OBO failure.',
    });
  }
});

app.listen(config.port, () => {
  console.log(`OBO middle-tier API listening on http://localhost:${config.port}`);
});
