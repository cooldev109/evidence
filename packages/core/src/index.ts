export {
  HASH_ALGORITHM,
  HASH_HEX_LENGTH,
  GENESIS_PREV_HASH,
  sha256Hex,
  canonicalJson,
  hashPayload,
} from './hash.js';

export {
  computeChainHash,
  verifyChain,
} from './chain.js';

export type {
  ChainLinkInput,
  ChainRecord,
  ChainVerificationResult,
  ChainVerificationOk,
  ChainVerificationErr,
} from './chain.js';
