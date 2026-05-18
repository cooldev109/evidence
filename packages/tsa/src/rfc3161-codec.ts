/**
 * Minimal RFC 3161 request encoder. Produces a TimeStampReq DER suitable
 * for posting to a public TSA with `Content-Type: application/timestamp-query`.
 *
 * This avoids a heavy ASN.1 dependency by hand-encoding the small structure
 * required: TimeStampReq ::= SEQUENCE {
 *   version           INTEGER  { v1(1) },
 *   messageImprint    SEQUENCE { hashAlgorithm AlgorithmIdentifier, hashedMessage OCTET STRING },
 *   reqPolicy         OBJECT IDENTIFIER OPTIONAL,
 *   nonce             INTEGER OPTIONAL,
 *   certReq           BOOLEAN DEFAULT FALSE,
 *   extensions        [0] IMPLICIT Extensions OPTIONAL
 * }
 *
 * Response parsing is delegated to the provider — the full TimeStampResp
 * is stored as opaque bytes and re-verified by a real ASN.1 library at
 * verification time (Milestone 3 hooks into the standalone verify CLI).
 */

// OID 1.3.14.3.2.26 — id-sha1 (avoided)
// OID 2.16.840.1.101.3.4.2.1 — id-sha256
const SHA256_OID_BYTES = Buffer.from([
  0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01,
]);

function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(value.length), value]);
}

function asInteger(n: number): Buffer {
  if (n < 0) throw new Error('only non-negative integers supported');
  if (n === 0) return tlv(0x02, Buffer.from([0]));
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  if (bytes[0] & 0x80) bytes.unshift(0);
  return tlv(0x02, Buffer.from(bytes));
}

export function encodeTimeStampReq(
  digestHex: string,
  opts: { nonce?: number; certReq?: boolean } = {},
): Buffer {
  const digest = Buffer.from(digestHex, 'hex');
  if (digest.length !== 32) {
    throw new Error('SHA-256 digest must be 32 bytes');
  }

  // AlgorithmIdentifier SEQUENCE { sha-256 OID, NULL }
  const algoId = tlv(0x30, Buffer.concat([SHA256_OID_BYTES, tlv(0x05, Buffer.alloc(0))]));
  // MessageImprint SEQUENCE { algoId, OCTET STRING hashedMessage }
  const messageImprint = tlv(0x30, Buffer.concat([algoId, tlv(0x04, digest)]));

  const parts: Buffer[] = [asInteger(1), messageImprint];
  if (typeof opts.nonce === 'number') parts.push(asInteger(opts.nonce));
  if (opts.certReq) parts.push(tlv(0x01, Buffer.from([0xff])));

  return tlv(0x30, Buffer.concat(parts));
}
