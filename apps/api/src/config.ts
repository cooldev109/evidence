import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres://')),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  WEBHOOK_HMAC_SECRET: z.string().min(8).default('change-me-in-prod'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Storage
  STORAGE_BACKEND: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.evidence-store'),
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_REGION: z.string().optional(),
  STORAGE_KMS_KEY_ID: z.string().optional(),
  RETAIN_MODE: z.enum(['compliance', 'governance', 'none']).default('governance'),
  RETAIN_YEARS: z.coerce.number().int().min(1).max(100).default(5),

  // TSA
  TSA_DEFAULT_PROVIDER: z
    .enum(['mock', 'freetsa', 'icp-brasil', 'eidas', 'us-digicert'])
    .default('mock'),
  TSA_BR_PROVIDER: z.enum(['mock', 'freetsa', 'icp-brasil']).default('mock'),
  TSA_EU_PROVIDER: z.enum(['mock', 'freetsa', 'eidas']).default('mock'),
  TSA_US_PROVIDER: z.enum(['mock', 'freetsa', 'us-digicert']).default('mock'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return EnvSchema.parse(env);
}
