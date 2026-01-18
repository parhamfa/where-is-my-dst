import { GeoService } from '../lib/GeoService';
import { PolicyEngine } from '../lib/PolicyEngine';

interface TabData {
    mainFrame: {
        url?: string;
        ip?: string;
        countryCode?: string;
        flagEmoji?: string;
    };
    requests: Array<{
        url: string;
        ip?: string;
        countryCode?: string;
        flagEmoji?: string;
        timestamp: number;
    }>;
}

// Initialize
PolicyEngine.syncAggressiveRules().catch(console.error);

const tabDataCache = new Map<number, TabData>();

// Track which ALLOW rule IDs belong to which tabs (for session-based allow)
const tabAllowRuleIds = new Map<number, number[]>();

function getOrCreateTabData(tabId: number): TabData {
    if (!tabDataCache.has(tabId)) {
        tabDataCache.set(tabId, {
            mainFrame: {},
            requests: []
        });
    }
    return tabDataCache.get(tabId)!;
}

async function clearTabAllowRules(tabId: number) {
    const ruleIds = tabAllowRuleIds.get(tabId);
    if (ruleIds && ruleIds.length > 0) {
        console.log(`[DST-DEBUG] Clearing ${ruleIds.length} session ALLOW rules for tab ${tabId}`);
        try {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: ruleIds
            });
        } catch (e) {
            console.error(`Failed to clear ALLOW rules for tab ${tabId}:`, e);
        }
        tabAllowRuleIds.delete(tabId);
    }
}

function trackAllowRule(tabId: number, ruleId: number) {
    if (!tabAllowRuleIds.has(tabId)) {
        tabAllowRuleIds.set(tabId, []);
    }
    tabAllowRuleIds.get(tabId)!.push(ruleId);
}

async function updateBadge(tabId: number, text: string) {
    try {
        await chrome.action.setBadgeBackgroundColor({ tabId, color: '#00000000' });
        await chrome.action.setBadgeText({ tabId, text });
    } catch (e) {
        // Ignore invalid tab warnings (e.g. tab closed)
    }
}

// Monitor navigation to reset data AND clear session allow rules
// Only clear on USER-initiated navigations (refresh, typed URL), not redirects from interstitial
chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) {
        tabDataCache.delete(details.tabId);
        updateBadge(details.tabId, '');

        // Check if this was an extension-triggered reload (not user refresh)
        if (extensionInitiatedReloads.has(details.tabId)) {
            console.log(`[DST-DEBUG] Extension-initiated reload for tab ${details.tabId}. Keeping ALLOW rules.`);
            extensionInitiatedReloads.delete(details.tabId);
            return;
        }

        // Check if this is a user-initiated navigation vs redirect from interstitial
        const isUserNavigation = details.transitionType === 'reload' ||
            details.transitionType === 'typed' ||
            details.transitionType === 'auto_bookmark' ||
            details.transitionType === 'generated' ||
            details.transitionType === 'keyword';

        // Also check: if it's a redirect (client or server), don't clear
        // transitionQualifiers is an array that may contain 'client_redirect' or 'server_redirect'
        const isRedirect = details.transitionQualifiers?.includes('client_redirect') ||
            details.transitionQualifiers?.includes('server_redirect');

        if (isUserNavigation && !isRedirect) {
            console.log(`[DST-DEBUG] User navigation detected (${details.transitionType}). Clearing session ALLOW rules for tab ${details.tabId}.`);
            clearTabAllowRules(details.tabId);
            // Reset the reload flag so the next verification can trigger ONE reload
            tabsReloadedThisSession.delete(details.tabId);
        } else {
            console.log(`[DST-DEBUG] Non-user navigation (${details.transitionType}, redirect=${isRedirect}). Keeping ALLOW rules for tab ${details.tabId}.`);
        }
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    tabDataCache.delete(tabId);
    // Also clean up any ALLOW rules associated with this tab
    clearTabAllowRules(tabId);
});

async function processRequest(details: any) {
    const { tabId, url, ip, type } = details;
    if (tabId === -1) return;

    const data = getOrCreateTabData(tabId);
    const hostname = new URL(url).hostname;

    // Resolve IP if missing (sometimes browser doesn't provide it)
    // Or if it's a proxy, we might need to resolve manually to see real destination?
    // Actually, browser provided IP is definitive for the connection.
    let resolvedIp = ip;
    if (!resolvedIp) {
        resolvedIp = await GeoService.resolveHostname(hostname) || undefined;
    }

    if (!resolvedIp) return;

    const geo = await GeoService.getCountryForIp(resolvedIp);

    if (type === 'main_frame') {
        data.mainFrame = {
            url,
            ip: resolvedIp,
            countryCode: geo?.countryCode,
            flagEmoji: geo?.flagEmoji
        };
        if (geo?.flagEmoji) {
            updateBadge(tabId, geo.flagEmoji);
        } else if (geo?.countryCode) {
            updateBadge(tabId, geo.countryCode);
        }

        // Check policy and block if needed
        if (geo?.countryCode) {
            if (await PolicyEngine.isCountryBlocked(geo.countryCode)) {
                await PolicyEngine.blockDomain(hostname);
            }
        }
    } else {
        data.requests.push({
            url,
            ip: resolvedIp,
            countryCode: geo?.countryCode,
            flagEmoji: geo?.flagEmoji,
            timestamp: Date.now()
        });

        // Keep list size manageable
        if (data.requests.length > 500) {
            data.requests.shift();
        }
    }
}

chrome.webRequest.onCompleted.addListener(
    (details) => {
        // Background processing
        processRequest(details).catch(console.error);
    },
    { urls: ["<all_urls>"] }
);

// Listen for popup requests for data
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_TAB_DATA') {
        const tabId = message.tabId || sender.tab?.id;

        const sendTabResponse = (tId: number) => {
            const data = tabDataCache.get(tId) || { mainFrame: {}, requests: [] };

            // Get authoritative URL from tab to ensure UI matches address bar
            chrome.tabs.get(tId, (tab) => {
                const finalData = { ...data };
                if (tab && tab.url) {
                    finalData.mainFrame = {
                        ...finalData.mainFrame,
                        url: tab.url // Override with actual browser URL
                    };
                }
                sendResponse(finalData);
            });
        };

        if (tabId) {
            sendTabResponse(tabId);
        } else {
            // If popup asks for active tab
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const id = tabs[0]?.id;
                if (id) sendTabResponse(id);
                else sendResponse(null);
            });
        }
        return true; // Async response
    } else if (message.type === 'BLOCK_DOMAIN') {
        const { domain, context } = message;
        if (domain) {
            PolicyEngine.blockDomain(domain, context).then(() => {
                sendResponse({ success: true });
            });
            return true;
        }
    } else if (message.type === 'BLOCK_DOMAINS_BATCH') {
        const { domains } = message; // Expecting Array<{ domain: string, context?: string }>
        if (domains && Array.isArray(domains)) {
            PolicyEngine.blockDomains(domains).then(() => {
                sendResponse({ success: true });
            });
            return true;
        }
    } else if (message.type === 'UNBLOCK_DOMAIN') {
        const { domain, context } = message;
        if (domain) {
            PolicyEngine.unblockDomain(domain, context).then(() => {
                sendResponse({ success: true });
            });
            return true;
        }
    } else if (message.type === 'GET_BLOCKED_DOMAINS') {
        PolicyEngine.getBlockedDomains().then((domains) => {
            sendResponse({ domains });
        });
        return true;
    } else if (message.type === 'GET_AGGRESSIVE_STATE') {
        Promise.all([
            PolicyEngine.isAggressiveModeEnabled(),
            PolicyEngine.getAggressiveRules()
        ]).then(([enabled, rules]) => {
            sendResponse({
                enabled,
                rules,
                blockedItemCount: aggressiveBlockedList.size,
                blockedItems: Array.from(aggressiveBlockedList.values())
            });
        });
        return true;
    } else if (message.type === 'SET_AGGRESSIVE_MODE') {
        PolicyEngine.setAggressiveMode(message.enabled).then(() => {
            if (!message.enabled) {
                // Clear persistent store
                aggressiveBlockedList = new Map();
                saveSuspects();
            }
            sendResponse({ success: true });
        });
        return true;
    } else if (message.type === 'SET_AGGRESSIVE_RULES') {
        PolicyEngine.setAggressiveRules(message.rules).then(() => {
            sendResponse({ success: true });
        });
        return true;
    } else if (message.type === 'CHECK_URL_SAFETY') {
        const { url } = message;
        (async () => {
            try {
                const hostname = new URL(url).hostname;
                const ip = await GeoService.resolveHostname(hostname);

                if (!ip) {
                    sendResponse({ decision: 'BLOCK', countryCode: 'Unknown' });
                    return;
                }

                const geo = await GeoService.getCountryForIp(ip);
                if (geo && geo.countryCode) {
                    const decision = await PolicyEngine.evaluateAggressivePolicy(geo.countryCode);
                    console.log(`[Aggressive Check] ${hostname} (${geo.countryCode}) -> ${decision}`);

                    if (decision === 'ALLOW') {
                        const ruleId = await PolicyEngine.allowSafeDomain(hostname);
                        // Track the rule for session cleanup - get tab ID from sender
                        if (ruleId !== null && sender.tab?.id) {
                            trackAllowRule(sender.tab.id, ruleId);
                        }
                        sendResponse({ decision: 'ALLOW', countryCode: geo.countryCode });
                    } else {
                        // Log blocking
                        aggressiveBlockedList.set(hostname, {
                            url,
                            countryCode: geo.countryCode,
                            timestamp: Date.now()
                        });
                        saveSuspects();
                        sendResponse({ decision: 'BLOCK', countryCode: geo.countryCode });
                    }
                } else {
                    sendResponse({ decision: 'BLOCK', countryCode: 'Unknown' });
                }
            } catch (e) {
                console.error("Safety check failed", e);
                sendResponse({ decision: 'BLOCK', countryCode: 'Error' });
            }
        })();
        return true;
    }
});

// --- Aggressive Mode Logic ---
let aggressiveBlockedList = new Map<string, { url: string, countryCode: string, timestamp: number, initiatorSite?: string }>();
const reloadDebounce = new Map<number, ReturnType<typeof setTimeout>>();
// Track tabs that have already been reloaded after initial verification - prevent reload loops
const tabsReloadedThisSession = new Set<number>();
// Track tabs where the extension itself triggered the reload (to differentiate from user refresh)
const extensionInitiatedReloads = new Set<number>();

// Load persisted suspects
chrome.storage.local.get('aggressiveBlockedList', (data) => {
    if (data.aggressiveBlockedList) {
        // Hydrate map from array of entries
        aggressiveBlockedList = new Map(data.aggressiveBlockedList as any);
    }
});

function saveSuspects() {
    chrome.storage.local.set({
        aggressiveBlockedList: Array.from(aggressiveBlockedList.entries())
    });
}

// Monitor blocked requests in Aggressive Mode
chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    if (info.rule.ruleId === PolicyEngine.AGGRESSIVE_RULE_ID || info.rule.ruleId === PolicyEngine.AGGRESSIVE_RULE_ID - 1) {
        const url = info.request.url;
        const hostname = new URL(url).hostname;
        const tabId = info.request.tabId;

        // Async verification
        (async () => {
            const ip = await GeoService.resolveHostname(hostname);
            if (!ip) return;

            const geo = await GeoService.getCountryForIp(ip);
            if (geo && geo.countryCode) {
                const decision = await PolicyEngine.evaluateAggressivePolicy(geo.countryCode);

                if (decision === 'BLOCK') {
                    // Confirmed Bad: Keep blocked, log it
                    console.log(`[Aggressive] Blocked (Rule): ${hostname} (${geo.countryCode})`);

                    // Get the main site that initiated this request
                    let initiatorSite = '';
                    if (tabId !== -1) {
                        try {
                            const tab = await chrome.tabs.get(tabId);
                            if (tab.url) {
                                initiatorSite = new URL(tab.url).hostname;
                            }
                        } catch (e) {
                            // Tab may have closed
                        }
                    }

                    aggressiveBlockedList.set(hostname, {
                        url,
                        countryCode: geo.countryCode,
                        timestamp: Date.now(),
                        initiatorSite
                    });
                    saveSuspects();
                } else {
                    // Safe: Allow and Retry
                    console.log(`[DST-DEBUG] Domain ${hostname} (${geo.countryCode}) is SAFE.`);
                    const ruleId = await PolicyEngine.allowSafeDomain(hostname);

                    // Track rule for session cleanup
                    if (ruleId !== null && tabId !== -1) {
                        trackAllowRule(tabId, ruleId);
                    }

                    // Trigger Reload to fetch the now-allowed resource - but only ONCE per session
                    if (tabId !== -1 && ruleId !== null) {
                        if (!tabsReloadedThisSession.has(tabId)) {
                            console.log(`[DST-DEBUG] New ALLOW rule added. Scheduling ONE-TIME reload for tab ${tabId}.`);
                            tabsReloadedThisSession.add(tabId);

                            if (reloadDebounce.has(tabId)) clearTimeout(reloadDebounce.get(tabId));

                            const timeout = setTimeout(() => {
                                console.log(`[DST-DEBUG] Executing RELOAD for tab ${tabId} now.`);
                                // Mark as extension-initiated BEFORE reloading
                                extensionInitiatedReloads.add(tabId);
                                chrome.tabs.reload(tabId);
                                reloadDebounce.delete(tabId);
                            }, 1500); // 1.5s delay to collect multiple ALLOW rules

                            reloadDebounce.set(tabId, timeout);
                        } else {
                            console.log(`[DST-DEBUG] Tab ${tabId} already reloaded this session. Skipping reload for ${hostname}.`);
                        }
                    }
                }
            }
        })();
    }
});
