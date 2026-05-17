import {
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  locale: text('locale').notNull().default('pt-BR'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    keyHash: text('key_hash').notNull(),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    keyHashIdx: uniqueIndex('api_keys_key_hash_idx').on(t.keyHash),
    tenantIdx: index('api_keys_tenant_idx').on(t.tenantId),
  }),
);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    source: text('source').notNull(),
    externalId: text('external_id'),
    payload: jsonb('payload').notNull(),
    payloadHash: text('payload_hash').notNull(),
    prevHash: text('prev_hash').notNull(),
    chainHash: text('chain_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantSeqIdx: uniqueIndex('events_tenant_seq_idx').on(t.tenantId, t.seq),
    tenantCreatedAtIdx: index('events_tenant_created_at_idx').on(t.tenantId, t.createdAt),
    tenantExternalIdIdx: uniqueIndex('events_tenant_external_id_idx').on(
      t.tenantId,
      t.source,
      t.externalId,
    ),
    chainHashIdx: index('events_chain_hash_idx').on(t.chainHash),
  }),
);

export const tenantChainTips = pgTable('tenant_chain_tips', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  seq: bigserial('seq', { mode: 'number' }).notNull(),
  chainHash: text('chain_hash').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
