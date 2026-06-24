#!/usr/bin/env python3
"""MSAL Python compatibility smoke-test — feature #13, criterion 4.

Builds a real ``msal.ConfidentialClientApplication`` against the running emulator authority
(a custom, non-Microsoft authority), performs a REAL ``acquire_token_for_client``
(client-credentials, feature #8) for the seeded confidential daemon's ``api://<daemonId>/.default``
scope, then validates the returned JWT (signature via the emulator JWKS ``n``/``e``/``kid``,
``iss``, ``aud``) with ``pyjwt`` + ``cryptography``.

Config matrix (see specs/2026-06-22_13-msal-compat-validation.md + docs/msal-client-config.md):
    authority=<origin>/<tenantId>, validate_authority=False, instance_discovery=False
        -> trust the custom GUID authority, NO egress to login.microsoftonline.com
    REQUESTS_CA_BUNDLE / verify=<cert.pem>  -> trust the emulator's self-signed cert.

Inputs are passed via environment variables by the test orchestrator. Prints a single
machine-parseable result line ("MSAL_PY_SMOKE: PASS ..." / "MSAL_PY_SMOKE: FAIL ...") and exits
non-zero on any failure.
"""

from __future__ import annotations

import json
import os
import sys

TAG = "MSAL_PY_SMOKE"


def _fail(message: str) -> int:
    print(f"{TAG}: FAIL {message}")
    return 1


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing required env var {name}")
    return value


def main() -> int:
    try:
        import msal  # noqa: WPS433 (import inside function: availability is probed by orchestrator)
        import jwt
        import requests
        from jwt import PyJWK
    except Exception as exc:  # pragma: no cover - orchestrator skips when unavailable
        return _fail(f"missing package: {exc}")

    try:
        origin = _require("EMU_ORIGIN").rstrip("/")
        tenant_id = _require("EMU_TENANT_ID")
        daemon_id = _require("EMU_DAEMON_ID")
        daemon_secret = _require("EMU_DAEMON_SECRET")
        cert_path = _require("EMU_CERT_PATH")
    except RuntimeError as exc:
        return _fail(str(exc))

    authority = f"{origin}/{tenant_id}"
    resource = f"api://{daemon_id}"
    scope = f"{resource}/.default"
    expected_issuer = f"{origin}/{tenant_id}/v2.0"

    # Trust the emulator's self-signed cert for every requests call (MSAL uses requests internally).
    os.environ["REQUESTS_CA_BUNDLE"] = cert_path
    os.environ["SSL_CERT_FILE"] = cert_path

    try:
        app = msal.ConfidentialClientApplication(
            client_id=daemon_id,
            client_credential=daemon_secret,
            authority=authority,
            validate_authority=False,
            instance_discovery=False,
        )
        result = app.acquire_token_for_client(scopes=[scope])
    except Exception as exc:
        return _fail(f"acquire_token_for_client raised {type(exc).__name__}: {exc}")

    if "access_token" not in result:
        return _fail(f"no access_token: {result.get('error')}/{result.get('error_description')}")

    access_token = result["access_token"]

    # Validate the returned JWT against the emulator JWKS (signature/issuer/audience).
    try:
        discovery = requests.get(
            f"{authority}/v2.0/.well-known/openid-configuration",
            verify=cert_path,
            timeout=30,
        ).json()
        jwks = requests.get(discovery["jwks_uri"], verify=cert_path, timeout=30).json()

        header = jwt.get_unverified_header(access_token)
        kid = header["kid"]
        jwk = next((k for k in jwks["keys"] if k.get("kid") == kid), None)
        if jwk is None:
            return _fail(f"no JWK matches kid={kid}")

        signing_key = PyJWK.from_dict(jwk)
        claims = jwt.decode(
            access_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=resource,
            issuer=expected_issuer,
            options={"verify_aud": True, "verify_iss": True},
        )
    except Exception as exc:
        return _fail(f"token validation raised {type(exc).__name__}: {exc}")

    roles = "+".join(claims.get("roles", []))
    print(
        f"{TAG}: PASS aud={claims.get('aud')} iss={claims.get('iss')} "
        f"roles={roles} kid={kid} sub={claims.get('sub')}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
