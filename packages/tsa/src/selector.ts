import type { Jurisdiction, ProviderId, TSAProvider } from './types.js';

/**
 * Maps a tenant locale (e.g., "pt-BR", "en-US", "es-ES") to a jurisdiction
 * code used to select a TSA provider.
 */
export function localeToJurisdiction(locale: string): Jurisdiction {
  const upper = locale.toUpperCase();
  if (upper.endsWith('-BR')) return 'BR';
  if (upper.endsWith('-US')) return 'US';
  if (upper.endsWith('-EU')) return 'EU';
  // Common EU language locales without country code
  const lang = upper.split('-')[0];
  if (['ES', 'FR', 'DE', 'IT', 'NL', 'PT'].includes(lang)) {
    return upper.endsWith('-PT') ? 'EU' : 'EU';
  }
  return 'DEV';
}

export interface TSARegistry {
  byId: Map<ProviderId, TSAProvider>;
  defaults: Partial<Record<Jurisdiction, ProviderId>>;
}

export function buildRegistry(providers: TSAProvider[], defaults: TSARegistry['defaults']): TSARegistry {
  const byId = new Map<ProviderId, TSAProvider>();
  for (const p of providers) byId.set(p.id, p);
  return { byId, defaults };
}

export function pickProvider(
  registry: TSARegistry,
  opts: { locale: string; override?: ProviderId | null },
): TSAProvider {
  if (opts.override) {
    const p = registry.byId.get(opts.override);
    if (!p) throw new Error(`TSA provider ${opts.override} not registered`);
    return p;
  }
  const jurisdiction = localeToJurisdiction(opts.locale);
  const defaultId = registry.defaults[jurisdiction];
  if (defaultId) {
    const p = registry.byId.get(defaultId);
    if (p) return p;
  }
  // Fallback to the DEV default if configured, else the first registered
  const devDefault = registry.defaults.DEV;
  if (devDefault) {
    const p = registry.byId.get(devDefault);
    if (p) return p;
  }
  const first = registry.byId.values().next().value;
  if (!first) throw new Error('no TSA providers registered');
  return first;
}
