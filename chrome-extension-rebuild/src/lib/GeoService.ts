export interface GeoData {
    countryCode: string;
    countryName: string;
    flagEmoji: string;
    fetchedAt: number;
}

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export class GeoService {
    private static cache = new Map<string, GeoData>();
    private static inflightRequests = new Map<string, Promise<GeoData | undefined>>();
    private static lastFetchTime = 0;
    private static MIN_FETCH_INTERVAL = 200; // ms between API calls

    static async resolveHostname(hostname: string): Promise<string | undefined> {
        if (!hostname) return undefined;
        try {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 3000);

            const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`, { signal: controller.signal });
            if (!res.ok) return undefined;

            const data = await res.json();
            if (data.Answer && data.Answer.length > 0) {
                // Return the first A record
                return data.Answer.find((a: any) => a.type === 1)?.data;
            }
        } catch (e) {
            // Silent fail
        }
        return undefined;
    }

    static async getCountryForIp(ip: string): Promise<GeoData | undefined> {
        if (!ip) return undefined;

        // Check memory cache
        if (this.cache.has(ip)) {
            const cached = this.cache.get(ip)!;
            if (Date.now() - cached.fetchedAt < CACHE_TTL) {
                return cached;
            }
        }

        // Check deduplication
        if (this.inflightRequests.has(ip)) {
            return this.inflightRequests.get(ip);
        }

        const promise = this.fetchCountryForIp(ip);
        this.inflightRequests.set(ip, promise);

        try {
            const result = await promise;
            return result;
        } finally {
            this.inflightRequests.delete(ip);
        }
    }

    private static async fetchCountryForIp(ip: string): Promise<GeoData | undefined> {
        // Simple rate limiting
        const now = Date.now();
        const timeSinceLast = now - this.lastFetchTime;
        if (timeSinceLast < this.MIN_FETCH_INTERVAL) {
            await new Promise(resolve => setTimeout(resolve, this.MIN_FETCH_INTERVAL - timeSinceLast));
        }

        this.lastFetchTime = Date.now();

        // Check storage cache
        const storageKey = `geo:${ip}`;
        try {
            const stored = await chrome.storage.local.get(storageKey);
            if (stored[storageKey]) {
                const data = stored[storageKey] as GeoData;
                if (Date.now() - data.fetchedAt < CACHE_TTL) {
                    this.cache.set(ip, data);
                    return data;
                }
            }
        } catch (e) {
            // Storage error ignored
        }

        // Check if we hit the limit recently (rudimentary circuit breaker could go here, but failover is enough)

        // Provider list with adapters
        // Provider list with adapters
        const providers = [
            {
                name: 'freeipapi.com',
                url: `https://freeipapi.com/api/json/${ip}`,
                adapter: async (res: Response) => {
                    const data = await res.json();
                    if (!data.countryCode) throw new Error('No country code');
                    return { countryCode: data.countryCode, countryName: data.countryName };
                }
            },
            {
                name: 'ipapi.co',
                url: `https://ipapi.co/${ip}/json/`,
                adapter: async (res: Response) => {
                    const data = await res.json();
                    if (data.error) throw new Error(data.reason || 'API Error');
                    // ipapi.co returns 'country' as code (e.g. US) and 'country_name' as name
                    return { countryCode: data.country, countryName: data.country_name };
                }
            },
            {
                name: 'ipwho.is',
                url: `https://ipwho.is/${ip}?fields=success,country,country_code`,
                adapter: async (res: Response) => {
                    const data = await res.json();
                    if (!data.success) throw new Error(data.message || 'API Error');
                    return { countryCode: data.country_code, countryName: data.country };
                }
            }
        ];

        // Try providers in order
        for (const provider of providers) {
            try {
                console.log(`[GeoService] Trying provider: ${provider.name} for ${ip}`);
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), 3000); // 3s timeout

                const res = await fetch(provider.url, { signal: controller.signal });
                clearTimeout(id);

                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                const result = await provider.adapter(res);

                if (result.countryCode) {
                    console.log(`[GeoService] Success with ${provider.name}: ${result.countryCode}`);
                    const geo: GeoData = {
                        countryCode: result.countryCode,
                        countryName: result.countryName,
                        flagEmoji: this.getFlagEmoji(result.countryCode),
                        fetchedAt: Date.now(),
                    };

                    this.cache.set(ip, geo);
                    chrome.storage.local.set({ [storageKey]: geo }).catch(() => { });
                    return geo;
                }
            } catch (e) {
                console.warn(`[GeoService] Provider ${provider.name} failed for ${ip}:`, e);
                // Continue to next provider
            }
        }

        return undefined;
    }

    private static getFlagEmoji(countryCode: string) {
        if (!countryCode) return '❓';
        const codePoints = countryCode
            .toUpperCase()
            .split('')
            .map(char => 127397 + char.charCodeAt(0));
        return String.fromCodePoint(...codePoints);
    }
}
