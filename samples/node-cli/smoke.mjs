// @ts-check
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Headless end-to-end smoke for the node-cli device-code sample (feature #19, criterion 8).
 *
 * The real CLI cannot be approved without a human, so this harness:
 *   1. spawns the unmodified CLI (`tsx src/cli.ts`) as a child process,
 *   2. parses the `USER_CODE=…` it prints from the device-code response,
 *   3. drives the emulator's human approval surface headlessly as the seeded user Alice
 *      (the same `lookup → signin → decide` form sequence a browser would POST), and
 *   4. waits for the CLI to finish, asserting it minted a Graph-audience token (scp ⊇ User.Read)
 *      and that `GET /graph/v1.0/me` returned Alice's profile.
 *
 * Assumes a seeded emulator is already running (REQUIRE_PASSWORD=false, the default), so the
 * sign-in step needs only the user id. Run from anywhere: paths resolve against this file.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGIN = (process.env.EMULATOR_ORIGIN ?? 'https://localhost:8443').replace(/\/$/, '');
const TENANT = process.env.TENANT_ID ?? '11111111-1111-1111-1111-111111111111';
const ALICE_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const VERIFY_URL = `${ORIGIN}/${TENANT}/oauth2/v2.0/devicecode/verify`;

// Trust the emulator's dev cert for the approval HTTPS calls (and hand it to the child for MSAL).
const CA_PATH = resolve(
  process.env.EMULATOR_CA_CERT ?? process.env.NODE_EXTRA_CA_CERTS ?? resolve(HERE, '../../data/tls/cert.pem'),
);
const CA = readFileSync(CA_PATH, 'utf8');

/** POST a form (x-www-form-urlencoded) over HTTPS with a cookie jar; updates the jar in place. */
function postForm(url, fields, jar) {
  return new Promise((resolvePost, rejectPost) => {
    const u = new URL(url);
    const data = new URLSearchParams(fields).toString();
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const req = httpsRequest(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname,
        method: 'POST',
        ca: CA,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(data),
          ...(cookie ? { cookie } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          for (const sc of res.headers['set-cookie'] ?? []) {
            const pair = sc.split(';')[0] ?? '';
            const eq = pair.indexOf('=');
            if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
          }
          resolvePost({ status: res.statusCode ?? 0, body: raw });
        });
      },
    );
    req.on('error', rejectPost);
    req.write(data);
    req.end();
  });
}

/** Extract the signed `__el_state` hidden input value from an HTML form. */
function extractState(html) {
  const m = /name="__el_state" value="([^"]+)"/.exec(html);
  if (!m || !m[1]) throw new Error(`__el_state not found: ${html.slice(0, 200)}`);
  return m[1];
}

/** Drive the human approval headlessly as Alice: lookup → signin → decide(approve). */
async function approveAsAlice(userCode) {
  const jar = new Map();

  const lookup = await postForm(VERIFY_URL, { __el_step: 'lookup', user_code: userCode }, jar);
  if (lookup.status !== 200 || !lookup.body.includes('name="__el_user"')) {
    throw new Error(`lookup failed (${lookup.status}): ${lookup.body.slice(0, 200)}`);
  }

  const signin = await postForm(
    VERIFY_URL,
    { __el_step: 'signin', user_code: userCode, __el_state: extractState(lookup.body), __el_user: ALICE_ID },
    jar,
  );
  if (signin.status !== 200) {
    throw new Error(`signin failed (${signin.status}): ${signin.body.slice(0, 200)}`);
  }

  const decide = await postForm(
    VERIFY_URL,
    { __el_step: 'decide', __el_state: extractState(signin.body), __el_decision: 'approve' },
    jar,
  );
  if (decide.status !== 200 || !decide.body.includes('all set')) {
    throw new Error(`approve failed (${decide.status}): ${decide.body.slice(0, 200)}`);
  }
}

function fail(message) {
  console.error(`\nSMOKE FAILED: ${message}`);
  process.exit(1);
}

async function run() {
  const env = {
    ...process.env,
    EMULATOR_ORIGIN: ORIGIN,
    TENANT_ID: TENANT,
    EMULATOR_CA_CERT: CA_PATH,
    NODE_EXTRA_CA_CERTS: CA_PATH,
  };

  // Spawn the real CLI via tsx (node --import tsx) so we exercise the shipped entrypoint unchanged.
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts'], { cwd: HERE, env });

  let out = '';
  let approving = false;
  let approvalError = null;

  const timeout = setTimeout(() => {
    child.kill();
    fail('timed out after 90s waiting for the CLI to complete');
  }, 90_000);

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    out += text;
    process.stdout.write(text);
    const m = /USER_CODE=([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(out);
    if (m && m[1] && !approving) {
      approving = true;
      approveAsAlice(m[1]).catch((err) => {
        approvalError = err;
        child.kill();
      });
    }
  });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk.toString()));

  child.on('error', (err) => fail(`could not spawn the CLI: ${err.message}`));

  child.on('exit', (code) => {
    clearTimeout(timeout);
    if (approvalError) fail(`headless approval failed: ${approvalError.message}`);
    if (!approving) fail('the CLI never printed a USER_CODE');

    const checks = [
      ['exit code 0', code === 0],
      ['aud=https://graph.microsoft.com', /aud=https:\/\/graph\.microsoft\.com/.test(out)],
      ['scp contains User.Read', /scp=[^\n]*User\.Read/.test(out)],
      ['GET /me returned 200', /status:\s*200/.test(out)],
      ["/me returned Alice's profile", /Alice Example/.test(out) && /alice@entralocal\.dev/.test(out)],
    ];

    const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failed.length > 0) fail(`assertions failed: ${failed.join('; ')} (exit=${code})`);

    console.log(`\nSMOKE PASSED (${checks.length}/${checks.length} assertions)`);
    process.exit(0);
  });
}

run().catch((err) => fail(err instanceof Error ? err.message : String(err)));
