export type Locale = 'pt-BR' | 'en-US' | 'es-ES';

export const SUPPORTED_LOCALES: Locale[] = ['pt-BR', 'en-US', 'es-ES'];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function resolveLocale(input: string | undefined): Locale {
  if (!input) return 'pt-BR';
  const lower = input.toLowerCase();
  if (lower.startsWith('pt')) return 'pt-BR';
  if (lower.startsWith('en')) return 'en-US';
  if (lower.startsWith('es')) return 'es-ES';
  return 'pt-BR';
}

interface MessageCatalog {
  reportTitle: string;
  reportSubtitle: string;
  generatedAt: string;
  reportId: string;
  tenant: string;
  locale: string;
  jurisdiction: string;
  scopeHeading: string;
  scopeRange: string;
  totalEvents: string;
  chainStatusHeading: string;
  chainOk: string;
  chainTampered: string;
  chainVerifiedCount: (n: number) => string;
  eventListHeading: string;
  eventSeq: string;
  eventCreatedAt: string;
  eventSource: string;
  eventPayloadHash: string;
  eventChainHash: string;
  tsaHeading: string;
  tsaProvider: string;
  tsaIssuedAt: string;
  tsaDigest: string;
  verificationHeading: string;
  verificationInstructions: string[];
  verificationUrlLabel: string;
  footerLine: string;
  page: (current: number, total: number) => string;
  // Per-capture certificate
  certTitle: string;
  certSubtitle: string;
  certEvidenceTitle: string;
  certKind: string;
  certKindPhoto: string;
  certKindVideo: string;
  certKindAudio: string;
  certKindAta: string;
  certCapturedBy: string;
  certCapturedAt: string;
  certLocation: string;
  certNoLocation: string;
  certFile: string;
  certBytes: (n: number) => string;
  certIntegrity: string;
  certFileHash: string;
  certChainHash: string;
  certPrevHash: string;
  certTranscriptHeading: string;
  certSignersHeading: string;
  certSigned: string;
  certPending: string;
  certVerifyHeading: string;
  certVerifyBody: string;
  certScanQr: string;
}

const PT_BR: MessageCatalog = {
  reportTitle: 'Relatório de Cadeia de Custódia Digital',
  reportSubtitle: 'EVIDENCE — prova com validade jurídica',
  generatedAt: 'Gerado em',
  reportId: 'Identificador do relatório',
  tenant: 'Cliente',
  locale: 'Idioma',
  jurisdiction: 'Jurisdição',
  scopeHeading: 'Escopo',
  scopeRange: 'Faixa de eventos',
  totalEvents: 'Total de eventos',
  chainStatusHeading: 'Status da cadeia',
  chainOk: 'Cadeia íntegra. Nenhuma adulteração detectada.',
  chainTampered: 'ATENÇÃO: cadeia adulterada. Os hashes não conferem.',
  chainVerifiedCount: (n) => `${n} evento(s) verificado(s) sequencialmente.`,
  eventListHeading: 'Eventos',
  eventSeq: 'Sequência',
  eventCreatedAt: 'Data e hora',
  eventSource: 'Origem',
  eventPayloadHash: 'Hash do payload (SHA-256)',
  eventChainHash: 'Hash da cadeia (SHA-256)',
  tsaHeading: 'Carimbo do tempo (RFC 3161)',
  tsaProvider: 'Provedor',
  tsaIssuedAt: 'Emitido em',
  tsaDigest: 'Digest carimbado',
  verificationHeading: 'Como verificar este documento',
  verificationInstructions: [
    'Cada evento listado inclui o hash do payload e o hash da cadeia.',
    'O hash da cadeia de cada evento é calculado a partir de: sequência, identificador do cliente, hash do payload, hash anterior e data de criação.',
    'Para verificar manualmente, recompute SHA-256(seq | tenantId | payloadHash | prevHash | createdAt) e compare com o hash registrado.',
    'Ou utilize a API pública de verificação no endereço abaixo, que fará a verificação automaticamente.',
  ],
  verificationUrlLabel: 'Endereço de verificação',
  footerLine: 'Este documento foi gerado automaticamente pelo EVIDENCE.',
  page: (c, t) => `Página ${c} de ${t}`,
  certTitle: 'Certificado de Prova Digital',
  certSubtitle: 'EVIDENCE — selo de tempo RFC 3161 e cadeia de custódia verificável',
  certEvidenceTitle: 'Título',
  certKind: 'Tipo',
  certKindPhoto: 'Foto',
  certKindVideo: 'Vídeo',
  certKindAudio: 'Áudio',
  certKindAta: 'ATA (transcrição)',
  certCapturedBy: 'Capturado por',
  certCapturedAt: 'Capturado em',
  certLocation: 'Localização',
  certNoLocation: 'Não informada',
  certFile: 'Arquivo',
  certBytes: (n) => `${formatBytes(n)}`,
  certIntegrity: 'Prova de integridade',
  certFileHash: 'Hash do arquivo (SHA-256)',
  certChainHash: 'Hash da cadeia',
  certPrevHash: 'Hash anterior',
  certTranscriptHeading: 'Transcrição',
  certSignersHeading: 'Assinaturas digitais',
  certSigned: 'Assinado',
  certPending: 'Pendente',
  certVerifyHeading: 'Como verificar este certificado',
  certVerifyBody:
    'Qualquer pessoa pode verificar a autenticidade deste documento e da prova associada acessando o endereço abaixo ou escaneando o QR code. A verificação recalcula o hash do arquivo, o hash da cadeia e a assinatura do carimbo de tempo de forma independente.',
  certScanQr: 'Escaneie para verificar',
};

const EN_US: MessageCatalog = {
  reportTitle: 'Digital Chain of Custody Report',
  reportSubtitle: 'EVIDENCE — legally admissible proof',
  generatedAt: 'Generated on',
  reportId: 'Report identifier',
  tenant: 'Tenant',
  locale: 'Language',
  jurisdiction: 'Jurisdiction',
  scopeHeading: 'Scope',
  scopeRange: 'Event range',
  totalEvents: 'Total events',
  chainStatusHeading: 'Chain status',
  chainOk: 'Chain is intact. No tampering detected.',
  chainTampered: 'WARNING: chain tampered. Hashes do not match.',
  chainVerifiedCount: (n) => `${n} event(s) verified sequentially.`,
  eventListHeading: 'Events',
  eventSeq: 'Sequence',
  eventCreatedAt: 'Timestamp',
  eventSource: 'Source',
  eventPayloadHash: 'Payload hash (SHA-256)',
  eventChainHash: 'Chain hash (SHA-256)',
  tsaHeading: 'Time Stamp (RFC 3161)',
  tsaProvider: 'Provider',
  tsaIssuedAt: 'Issued at',
  tsaDigest: 'Stamped digest',
  verificationHeading: 'How to verify this document',
  verificationInstructions: [
    'Every event listed includes its payload hash and its chain hash.',
    'The chain hash of each event is computed from: sequence, tenant identifier, payload hash, previous chain hash, and creation timestamp.',
    'To verify manually, recompute SHA-256(seq | tenantId | payloadHash | prevHash | createdAt) and compare to the recorded chain hash.',
    'Or use the public verification API at the URL below to verify automatically.',
  ],
  verificationUrlLabel: 'Verification URL',
  footerLine: 'This document was automatically generated by EVIDENCE.',
  page: (c, t) => `Page ${c} of ${t}`,
  certTitle: 'Digital Evidence Certificate',
  certSubtitle: 'EVIDENCE — RFC 3161 timestamp and verifiable chain of custody',
  certEvidenceTitle: 'Title',
  certKind: 'Type',
  certKindPhoto: 'Photo',
  certKindVideo: 'Video',
  certKindAudio: 'Audio',
  certKindAta: 'Transcript (ATA)',
  certCapturedBy: 'Captured by',
  certCapturedAt: 'Captured at',
  certLocation: 'Location',
  certNoLocation: 'Not provided',
  certFile: 'File',
  certBytes: (n) => `${formatBytes(n)}`,
  certIntegrity: 'Integrity proof',
  certFileHash: 'File hash (SHA-256)',
  certChainHash: 'Chain hash',
  certPrevHash: 'Previous chain hash',
  certTranscriptHeading: 'Transcript',
  certSignersHeading: 'Digital signatures',
  certSigned: 'Signed',
  certPending: 'Pending',
  certVerifyHeading: 'How to verify this certificate',
  certVerifyBody:
    'Anyone can independently verify the authenticity of this document and its evidence by visiting the URL below or scanning the QR code. Verification recomputes the file hash, the chain hash, and the timestamp signature independently.',
  certScanQr: 'Scan to verify',
};

const ES_ES: MessageCatalog = {
  reportTitle: 'Informe de Cadena de Custodia Digital',
  reportSubtitle: 'EVIDENCE — prueba con validez jurídica',
  generatedAt: 'Generado el',
  reportId: 'Identificador del informe',
  tenant: 'Cliente',
  locale: 'Idioma',
  jurisdiction: 'Jurisdicción',
  scopeHeading: 'Alcance',
  scopeRange: 'Rango de eventos',
  totalEvents: 'Total de eventos',
  chainStatusHeading: 'Estado de la cadena',
  chainOk: 'Cadena íntegra. No se detectó alteración.',
  chainTampered: 'ADVERTENCIA: cadena alterada. Los hashes no coinciden.',
  chainVerifiedCount: (n) => `${n} evento(s) verificado(s) secuencialmente.`,
  eventListHeading: 'Eventos',
  eventSeq: 'Secuencia',
  eventCreatedAt: 'Fecha y hora',
  eventSource: 'Origen',
  eventPayloadHash: 'Hash del payload (SHA-256)',
  eventChainHash: 'Hash de la cadena (SHA-256)',
  tsaHeading: 'Sello de tiempo (RFC 3161)',
  tsaProvider: 'Proveedor',
  tsaIssuedAt: 'Emitido el',
  tsaDigest: 'Digest sellado',
  verificationHeading: 'Cómo verificar este documento',
  verificationInstructions: [
    'Cada evento incluye su hash de payload y su hash de cadena.',
    'El hash de cadena se calcula a partir de: secuencia, identificador del cliente, hash del payload, hash anterior y fecha de creación.',
    'Para verificar manualmente, recalcule SHA-256(seq | tenantId | payloadHash | prevHash | createdAt) y compare con el hash registrado.',
    'O utilice la API pública de verificación en la URL siguiente para verificar automáticamente.',
  ],
  verificationUrlLabel: 'URL de verificación',
  footerLine: 'Este documento fue generado automáticamente por EVIDENCE.',
  page: (c, t) => `Página ${c} de ${t}`,
  certTitle: 'Certificado de Prueba Digital',
  certSubtitle: 'EVIDENCE — sello de tiempo RFC 3161 y cadena de custodia verificable',
  certEvidenceTitle: 'Título',
  certKind: 'Tipo',
  certKindPhoto: 'Foto',
  certKindVideo: 'Video',
  certKindAudio: 'Audio',
  certKindAta: 'Transcripción (Acta)',
  certCapturedBy: 'Capturado por',
  certCapturedAt: 'Capturado el',
  certLocation: 'Ubicación',
  certNoLocation: 'No informada',
  certFile: 'Archivo',
  certBytes: (n) => `${formatBytes(n)}`,
  certIntegrity: 'Prueba de integridad',
  certFileHash: 'Hash del archivo (SHA-256)',
  certChainHash: 'Hash de la cadena',
  certPrevHash: 'Hash anterior',
  certTranscriptHeading: 'Transcripción',
  certSignersHeading: 'Firmas digitales',
  certSigned: 'Firmado',
  certPending: 'Pendiente',
  certVerifyHeading: 'Cómo verificar este certificado',
  certVerifyBody:
    'Cualquier persona puede verificar de forma independiente la autenticidad de este documento y de la prueba asociada visitando la URL siguiente o escaneando el código QR. La verificación recalcula el hash del archivo, el hash de la cadena y la firma del sello de tiempo de forma independiente.',
  certScanQr: 'Escanee para verificar',
};

const CATALOGS: Record<Locale, MessageCatalog> = {
  'pt-BR': PT_BR,
  'en-US': EN_US,
  'es-ES': ES_ES,
};

export function messages(locale: Locale): MessageCatalog {
  return CATALOGS[locale];
}
