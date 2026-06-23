import type { NewSigningKey } from '../../src/store/types.js';
import { TEST_TENANT_ID } from './constants.js';

/**
 * Deterministic, **test-only** RSA-2048 / RS256 signing key. Committed so JWKS output and (future)
 * token signatures are byte-reproducible across CI runs. The `kid` is the RFC 7638 JWK thumbprint
 * of `TEST_PUBLIC_JWK`. NEVER use this key outside tests — the private key is public in source.
 */
export const TEST_SIGNING_KID = '66C5DT9hI_OFm_-3ohp2iC8XPB7E2FqbvYkBLMcM5_E';

/** JSON-serialized public JWK (`{ kty, n, e }`) matching {@link TEST_SIGNING_KID}. */
export const TEST_PUBLIC_JWK =
  '{"kty":"RSA","n":"t3wkP17GORwBOGGCzXcYco96WZUIbZ07aeWmnlmb9LVBO2Tp9E5Nk08YCPz4Vfn1hR-KNLy4nhEQJYvSb7MWsWQf2AocGgt3j5manbK9RDUbnhNyzlrhEmHQgM8kqWyfeZnJhn3_9Af_PP0ObGNAxLeFjAhU9oZ-ZriQKfUk6Lwp-_CupSo1olt5oSIKn211TUpGSVCJsnZ8_QYdfOcFFJ3RKOKIYkeuU1inV0yfGlraw87MhUnEHrx94rwmMoR8ljeeF2kDHinO0_WOkUPJSTJmqUO--y6eV8OVKvPMK41zeW5dSVksLdCeOufxbA0az02n1jY-sAjRvqdMvrDNvQ","e":"AQAB"}';

/** PKCS#8 PEM private key matching {@link TEST_SIGNING_KID}. Test-only. */
export const TEST_PRIVATE_PKCS8 = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC3fCQ/XsY5HAE4
YYLNdxhyj3pZlQhtnTtp5aaeWZv0tUE7ZOn0Tk2TTxgI/PhV+fWFH4o0vLieERAl
i9JvsxaxZB/YChwaC3ePmZqdsr1ENRueE3LOWuESYdCAzySpbJ95mcmGff/0B/88
/Q5sY0DEt4WMCFT2hn5muJAp9STovCn78K6lKjWiW3mhIgqfbXVNSkZJUImydnz9
Bh185wUUndEo4ohiR65TWKdXTJ8aWtrDzsyFScQevH3ivCYyhHyWN54XaQMeKc7T
9Y6RQ8lJMmapQ777Lp5Xw5Uq88wrjXN5bl1JWSwt0J465/FsDRrPTafWNj6wCNG+
p0y+sM29AgMBAAECggEAEBe/Rh+V2yRtpvhGdKbhagrTfE/p8VM9BsixmGnbl9bd
5cuwCVFk1Gq3fPJTBZdqxUZC5OU4fASbGe/tgQaAEwbpFBWu6UngLqQWP4aRuw29
YlvqUdb+rpINq35/hKyWQCAQ4M7kSA77f+nh/femkppWCDYi3YxmQbQmUMfDePYB
oSzMqnCKdRPfNM5NtI8fC4tMPRZwOPv3maKJoHkfMsQ20YCMv3/2e8q8ozwaLpmT
1U706uganq8Z+MDDXs/Hm49gBr6V6cZAofGFdE0YkdUSGf7NnZOFaWsr8o3r7+5X
QkmjUt7gxqRXqPMUzR19Bc+tWGk+kysFUhIbPR0HMQKBgQDzrvqji14KGayeCT4n
DEvsJEHk5Jl/VETzMza4Bxbe5hN08Qj2SZQj2aQWcBcjGirlPA5YOIsW1ssYERf4
u5HoaZeSW6+17MfIojtapCaFrpOqmBlO8IN6fZnxPJmJ9vS74TkKvAW2kW7/hP8a
5vr09hudE8DhkLuRl5T8tqDSswKBgQDAwkDIr2OOgzweAz8q4oxxWQdSO8y3YFKl
3U+ySVTifXySeiZAriL5S4KqSmeoxh8a0CJWSau5oJWfMHkPYFxKoNLWMbhhqft7
OreOs3VotOm8/9hUDi5Nf0fdZXNx3eoq1DRcJkIEPY5pNVeRkULdjRg/fN1yqPCX
ZaCYZQtVzwKBgQDHlcBJJQPPx/l+stlKCCNC9OtXevhRtoaGnqKplXzg8ZZsCGMr
vVXtCvv/OK1qnasWd9rT3PPmr+RGAPIeUhqOPbXcNOY0Xgu/w0hT0/CNO1BMwCiy
ZAF72NW2JMkom7EVFMGwjhEr1/AOrjJ3KUnQSqaRP7WRygYml/16Ama0SwKBgQCn
VzykvNbCPx4utATftyPTt0WK141m2UGG6zWoAs+lfOlrxI1283Y7VJmQOt35AF66
iVx16qkhks6yD4PZnH8i7rF68FkwuEAxgA0g3p0cFIsi4D2u40zBTLFX/B4YCV6k
Zes64J/JTKNYpM1r+17ANiCJ5V3ej9mmpbyg8H/BswKBgF0g0pAOj4BSDv8JPMIo
r+wscXI2yP66iyJGrojjR81oSgrYAWh1pab91JZpTv2xDPF3AH8jQP4Hw3Naowyx
fnYf0UmR4teVWJWcwzzh7FfruZ+7VpJ2DwJbp5e5DqCsHDCph0kxZ913Y9LndzrT
D/VJBa1pxkgGohBwlFIfKpml
-----END PRIVATE KEY-----`;

/** The fixed test key as a `NewSigningKey`, ready to pass to `signingKeys.insert` / buildApp. */
export function testSigningKey(tenantId: string = TEST_TENANT_ID): NewSigningKey {
  return {
    kid: TEST_SIGNING_KID,
    tenantId,
    alg: 'RS256',
    publicJwk: TEST_PUBLIC_JWK,
    privatePkcs8: TEST_PRIVATE_PKCS8,
    isActive: true,
  };
}
