


export interface BlockedCountry {
    countryCode: string; // e.g., "CN"
}

export class PolicyEngine {
    // Get list of blocked countries from storage
    static async getBlockedCountries(): Promise<string[]> {
        const data = await chrome.storage.local.get('blockedCountries');
        return (data.blockedCountries as string[]) || [];
    }

    static async setBlockedCountries(codes: string[]) {
        await chrome.storage.local.set({ blockedCountries: codes });
    }

    static async addBlockedCountry(code: string) {
        const codes = await this.getBlockedCountries();
        if (!codes.includes(code)) {
            codes.push(code);
            await this.setBlockedCountries(codes);
        }
    }

    static async removeBlockedCountry(code: string) {
        const codes = await this.getBlockedCountries();
        const newCodes = codes.filter(c => c !== code);
        await this.setBlockedCountries(newCodes);
    }

    static async isCountryBlocked(code: string): Promise<boolean> {
        const codes = await this.getBlockedCountries();
        return codes.includes(code);
    }

    static async blockDomain(domain: string, contextDomain?: string) {
        await this.blockDomains([{ domain, context: contextDomain }]);
    }

    static async blockDomains(items: Array<{ domain: string, context?: string }>) {
        const rules = await chrome.declarativeNetRequest.getDynamicRules();
        let nextId = rules.length > 0 ? Math.max(...rules.map(r => r.id)) + 1 : 1;

        const newRules: chrome.declarativeNetRequest.Rule[] = [];

        for (const item of items) {
            // Check if domain is already blocked in this context
            const exists = rules.find(r =>
                r.condition.urlFilter === `||${item.domain}` &&
                (item.context ? r.condition.initiatorDomains?.includes(item.context) : !r.condition.initiatorDomains)
            );
            if (exists) continue;

            const condition: chrome.declarativeNetRequest.RuleCondition = {
                urlFilter: `||${item.domain}`,
                resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other'] as chrome.declarativeNetRequest.ResourceType[]
            };

            if (item.context) {
                condition.initiatorDomains = [item.context];
            }

            newRules.push({
                id: nextId++,
                priority: 1,
                action: { type: chrome.declarativeNetRequest.RuleActionType.BLOCK },
                condition
            });
        }

        if (newRules.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                addRules: newRules
            });
        }
    }

    static async unblockDomain(domain: string, contextDomain?: string) {
        const rules = await chrome.declarativeNetRequest.getDynamicRules();
        const rule = rules.find(r =>
            r.condition.urlFilter === `||${domain}` &&
            (contextDomain ? r.condition.initiatorDomains?.includes(contextDomain) : !r.condition.initiatorDomains)
        );
        if (rule) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: [rule.id]
            });
        }
    }

    static async getBlockedDomains(): Promise<Array<{ domain: string, context?: string }>> {
        const rules = await chrome.declarativeNetRequest.getDynamicRules();
        return rules
            .filter(r => r.action.type === chrome.declarativeNetRequest.RuleActionType.BLOCK && r.condition.urlFilter?.startsWith('||'))
            .map(r => ({
                domain: r.condition.urlFilter!.substring(2),
                context: r.condition.initiatorDomains ? r.condition.initiatorDomains[0] : undefined
            }));
    }

    // --- Aggressive Mode ---

    static readonly AGGRESSIVE_RULE_ID = 999999;
    static readonly ALLOW_RULE_START_ID = 500000;

    static async isAggressiveModeEnabled(): Promise<boolean> {
        const data = await chrome.storage.local.get('aggressiveMode');
        return !!data.aggressiveMode;
    }

    static async setAggressiveMode(enabled: boolean) {
        await chrome.storage.local.set({ aggressiveMode: enabled });

        const updateOptions: chrome.declarativeNetRequest.UpdateRuleOptions = {
            removeRuleIds: [this.AGGRESSIVE_RULE_ID, this.AGGRESSIVE_RULE_ID - 1]
        };

        if (enabled) {
            const extensionId = chrome.runtime.id;

            // FIRST: Clear all existing session ALLOW rules to start fresh
            const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
            const allowRuleIds = existingRules
                .filter(r => r.id >= this.ALLOW_RULE_START_ID && r.id < this.AGGRESSIVE_RULE_ID)
                .map(r => r.id);

            if (allowRuleIds.length > 0) {
                console.log(`[DST-DEBUG] Clearing ${allowRuleIds.length} stale ALLOW rules on aggressive mode enable.`);
                updateOptions.removeRuleIds = [...updateOptions.removeRuleIds!, ...allowRuleIds];
            }

            // Rule 1: Redirect Main Frame to Interstitial
            // Rule 2: Block Subresources (until verified)
            // Fix: Use regexFilter to safely target http/https only.
            const commonCondition = {
                regexFilter: "^http(s)?://.*",
                excludedInitiatorDomains: [extensionId]
            };

            updateOptions.addRules = [
                {
                    id: this.AGGRESSIVE_RULE_ID,
                    priority: 1,
                    action: {
                        type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
                        redirect: { regexSubstitution: `chrome-extension://${extensionId}/interstitial.html?url=\\0` }
                    },
                    condition: {
                        ...commonCondition,
                        resourceTypes: ['main_frame'] as chrome.declarativeNetRequest.ResourceType[]
                    }
                },
                {
                    id: this.AGGRESSIVE_RULE_ID - 1,
                    priority: 1,
                    action: { type: chrome.declarativeNetRequest.RuleActionType.BLOCK },
                    condition: {
                        ...commonCondition,
                        resourceTypes: ['sub_frame', 'xmlhttprequest', 'script', 'image', 'stylesheet', 'object', 'media', 'websocket', 'other'] as chrome.declarativeNetRequest.ResourceType[]
                    }
                }
            ];
        }

        await chrome.declarativeNetRequest.updateDynamicRules(updateOptions);
    }

    static async syncAggressiveRules() {
        const enabled = await this.isAggressiveModeEnabled();
        await this.setAggressiveMode(enabled);
    }

    static async allowSafeDomain(domain: string): Promise<number | null> {
        console.log(`[DST-DEBUG] allowSafeDomain called for: ${domain}`);
        const rules = await chrome.declarativeNetRequest.getDynamicRules();

        // Check if already allowed
        const exists = rules.find(r =>
            r.action.type === chrome.declarativeNetRequest.RuleActionType.ALLOW &&
            r.condition.urlFilter === `||${domain}`
        );
        if (exists) {
            console.log(`[DST-DEBUG] Domain ${domain} is ALREADY allowed. Skipping rule addition.`);
            return null;
        }

        // Find a free ID in the allow range
        let nextId = this.ALLOW_RULE_START_ID;
        const allowIds = rules.filter(r => r.id >= this.ALLOW_RULE_START_ID && r.id < this.AGGRESSIVE_RULE_ID).map(r => r.id);
        while (allowIds.includes(nextId)) {
            nextId++;
        }

        console.log(`[DST-DEBUG] Adding NEW ALLOW rule for ${domain} (ID: ${nextId})`);

        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: [{
                id: nextId,
                priority: 100, // Higher than block (1)
                action: { type: chrome.declarativeNetRequest.RuleActionType.ALLOW },
                condition: {
                    urlFilter: `||${domain}`,
                    // Allow ALL resource types for verified Safe domains to prevent subresource blocking loops
                    resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other'] as chrome.declarativeNetRequest.ResourceType[]
                }
            }]
        });
        return nextId;
    }

    // --- Rules Engine ---

    static async getAggressiveRules(): Promise<AggressiveRule[]> {
        const data = await chrome.storage.local.get('aggressiveRules');
        return (data.aggressiveRules as AggressiveRule[]) || [];
    }

    static async setAggressiveRules(rules: AggressiveRule[]) {
        await chrome.storage.local.set({ aggressiveRules: rules });
    }

    static async evaluateAggressivePolicy(countryCode: string): Promise<'ALLOW' | 'BLOCK' | 'DEFAULT'> {
        const rules = await this.getAggressiveRules();

        for (const rule of rules) {
            const match = rule.condition === 'IS'
                ? rule.countries.includes(countryCode)
                : !rule.countries.includes(countryCode);

            if (match) {
                console.log(`[DST-DEBUG] Country ${countryCode} matched rule ${rule.id} (${rule.condition}). Action: ${rule.action}`);
                return rule.action;
            }
        }

        console.log(`[DST-DEBUG] Country ${countryCode} matched NO rules. Defaulting to ALLOW.`);
        return 'ALLOW'; // Default to allow if no specific rule blocks it? Or default BLOCK? Use ALLOW for "Safe List" behavior.
    }
}

export interface AggressiveRule {
    id: string;
    action: 'ALLOW' | 'BLOCK';
    condition: 'IS' | 'IS_NOT';
    countries: string[];
}
