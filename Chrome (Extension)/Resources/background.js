// Background script: track main frame and subresource IPs per tab, map to country, and
// show the tab's main-frame country flag as the toolbar badge.

importScripts("vendor/browser-polyfill.min.js");

const ipToCountryCache = new Map(); // ip -> { countryCode, countryName, flagEmoji, fetchedAt }
const tabDataById = new Map(); // tabId -> { mainFrame, requests }

// Safari badge text can render oddly with flag emojis in some environments.
// Use country code in badge by default for clarity.
const SHOW_EMOJI_IN_BADGE = false;
// Limit how many request items we keep in memory for the popup list
const MAX_REQUEST_ITEMS = 200;

// Blocking rules storage key
const BLOCKING_STORAGE_KEY = "blockingRules"; // user-managed: [{ id, pattern, action, siteHost? }]

function patternToCondition(pattern) {
    let urlFilter = pattern || "";
    if (!urlFilter.includes("/")) {
        urlFilter = `||${pattern}`;
    }
    return { urlFilter };
}

async function loadBlockingRules() {
    try {
        const obj = await browser.storage.local.get(BLOCKING_STORAGE_KEY);
        return obj[BLOCKING_STORAGE_KEY] || [];
    } catch (_) { return []; }
}

async function saveBlockingRules(rules) {
    try { await browser.storage.local.set({ [BLOCKING_STORAGE_KEY]: rules }); } catch (_) {}
}

async function rebuildDynamicRules() {
    try {
        const userRules = await loadBlockingRules();
        // Normalize ids for any missing ones (shouldn't happen after save)
        let nextId = 1;
        for (const r of userRules) { if (!r.id) r.id = nextId++; }
        const existing = await browser.declarativeNetRequest.getDynamicRules();
        const toRemove = existing.map(r => r.id);
        const toAdd = userRules.map(r => {
            const condition = patternToCondition(r.pattern);
            if (r.siteHost) {
                condition.initiatorDomains = [r.siteHost];
            }
            return {
                id: r.id,
                priority: 1,
                action: r.action === "allow" ? { type: "allow" } : { type: "block" },
                condition
            };
        });
        await browser.declarativeNetRequest.updateDynamicRules({ addRules: toAdd, removeRuleIds: toRemove });
        return { userRules };
    } catch (e) {
        console.warn("applyBlockingRules error", e);
        return {};
    }
}

async function applyBlockingRules(rules) {
    await saveBlockingRules(rules);
    return rebuildDynamicRules();
}

// Country policy features removed

function getOrCreateTabData(tabId) {
    let tabData = tabDataById.get(tabId);
    if (!tabData) {
        tabData = {
            mainFrame: {
                url: undefined,
                ip: undefined,
                countryCode: undefined,
                countryName: undefined,
                flagEmoji: undefined
            },
            requests: [], // { url, ip, countryCode, countryName, flagEmoji, time }
            seenUrls: new Set(),
            counters: { totalRequests: 0, countryByCode: {} }
        };
        tabDataById.set(tabId, tabData);
    }
    return tabData;
}

function countryCodeToEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return undefined;
    // Convert ISO 3166-1 alpha-2 to regional indicator symbols. The correct
    // formula is RI_BASE (U+1F1E6 - 'A') + letterCodePoint (not offset).
    const REGIONAL_INDICATOR_BASE = 127397; // 0x1F1E6 - 'A' (65)
    const upper = countryCode.toUpperCase();
    const c0 = upper.codePointAt(0);
    const c1 = upper.codePointAt(1);
    if (c0 < 65 || c0 > 90 || c1 < 65 || c1 > 90) return undefined; // ensure A-Z
    try {
        const first = String.fromCodePoint(REGIONAL_INDICATOR_BASE + c0);
        const second = String.fromCodePoint(REGIONAL_INDICATOR_BASE + c1);
        return first + second;
    } catch (_) {
        return undefined;
    }
}

async function fetchCountryForIp(ip) {
    if (!ip) return undefined;
    const cached = ipToCountryCache.get(ip);
    if (cached) return cached;
    try {
        // Use ipwho.is (HTTPS, free, no key). Example: https://ipwho.is/8.8.8.8
        const resp = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,country_code`);
        if (!resp.ok) throw new Error(`ipwho.is HTTP ${resp.status}`);
        const data = await resp.json();
        if (data && data.success && data.country_code) {
            const countryCode = data.country_code;
            const countryName = data.country || countryCode;
            const flagEmoji = countryCodeToEmoji(countryCode);
            const result = { countryCode, countryName, flagEmoji, fetchedAt: Date.now() };
            ipToCountryCache.set(ip, result);
            // Persist a lightweight cache entry to storage to survive restarts
            void persistIpCacheEntry(ip, result);
            return result;
        }
    } catch (e) {
        console.warn("Failed to geolocate IP", ip, e);
    }
    return undefined;
}

async function persistIpCacheEntry(ip, entry) {
    try {
        await browser.storage.local.set({ [ip]: entry });
    } catch (e) {
        // Non-fatal
    }
}

async function hydrateIpCacheFromStorage() {
    try {
        const all = await browser.storage.local.get(null);
        for (const [key, value] of Object.entries(all || {})) {
            if (value && value.countryCode && value.flagEmoji) {
                ipToCountryCache.set(key, value);
            }
        }
    } catch (e) {
        // ignore
    }
}

function capRequestsList(tabData, maxItems = MAX_REQUEST_ITEMS) {
    if (tabData.requests.length > maxItems) {
        tabData.requests.splice(0, tabData.requests.length - maxItems);
    }
}

function isDuplicateAndMark(tabData, url) {
    // Normalize URL to avoid minor variations causing duplicates
    let key = url;
    try {
        const u = new URL(url);
        // Ignore query string ordering; keep full href but lowercase host
        u.host = u.host.toLowerCase();
        key = u.toString();
    } catch (_) {}
    if (tabData.seenUrls.has(key)) return true;
    tabData.seenUrls.add(key);
    // Keep set bounded
    if (tabData.seenUrls.size > 2000) {
        tabData.seenUrls.clear();
        for (const r of tabData.requests.slice(-500)) {
            tabData.seenUrls.add(r.url);
        }
    }
    return false;
}

function addRequestEntry(tabData, { url, ipAddress, geo }) {
    if (!tabData) return;
    if (isDuplicateAndMark(tabData, url)) return; // unify dedupe across sources

    const entry = {
        url,
        ip: ipAddress,
        countryCode: geo?.countryCode,
        countryName: geo?.countryName,
        flagEmoji: geo?.flagEmoji,
        time: Date.now()
    };
    tabData.requests.push(entry);
    tabData.counters.totalRequests = (tabData.counters.totalRequests || 0) + 1;
    if (geo?.countryCode) {
        const code = geo.countryCode.toUpperCase();
        const map = tabData.counters.countryByCode || (tabData.counters.countryByCode = {});
        map[code] = (map[code] || 0) + 1;
    }
    capRequestsList(tabData);
}

async function updateBadgeForTab(tabId) {
    const tabData = tabDataById.get(tabId);
    const flag = tabData?.mainFrame?.flagEmoji;
    const code = tabData?.mainFrame?.countryCode;
    
    // Reset to default icon first
    try {
        await browser.action.setIcon({ tabId, path: "images/icon-48.png" });
    } catch (e) {
        // Ignore errors
    }
    
    // Show flag as badge overlay without background
    try {
        // Try multiple approaches to remove background
        await browser.action.setBadgeBackgroundColor({ tabId, color: "transparent" });
        await browser.action.setBadgeBackgroundColor({ tabId, color: [0, 0, 0, 0] });
        await browser.action.setBadgeBackgroundColor({ tabId, color: "rgba(0,0,0,0)" });
        
        const text = SHOW_EMOJI_IN_BADGE && flag ? flag : (code ? code.toUpperCase() : "");
        await browser.action.setBadgeText({ tabId, text });
    } catch (e) {
        // Fallback: try without setting background color
        try {
            const text = SHOW_EMOJI_IN_BADGE && flag ? flag : (code ? code.toUpperCase() : "");
            await browser.action.setBadgeText({ tabId, text });
        } catch (_) {}
    }
}

function extractHostname(url) {
    try {
        return new URL(url).hostname;
    } catch (_) {
        return undefined;
    }
}

async function resolveHostnameToIp(hostname) {
    if (!hostname) return undefined;
    try {
        // Use DNS over HTTPS via Google Public DNS
        const aResp = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`);
        if (aResp.ok) {
            const aJson = await aResp.json();
            if (Array.isArray(aJson.Answer) && aJson.Answer.length > 0) {
                const aRecord = aJson.Answer.find(a => a && a.data && /^\d+\.\d+\.\d+\.\d+$/.test(a.data));
                if (aRecord) return aRecord.data;
            }
        }
    } catch (_) {}
    try {
        // Fallback to AAAA for IPv6
        const aaaaResp = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=AAAA`);
        if (aaaaResp.ok) {
            const aaaaJson = await aaaaResp.json();
            if (Array.isArray(aaaaJson.Answer) && aaaaJson.Answer.length > 0) {
                const aaaaRecord = aaaaJson.Answer.find(a => a && a.data);
                if (aaaaRecord) return aaaaRecord.data;
            }
        }
    } catch (_) {}
    return undefined;
}

async function handleMainFrame(details) {
    const { tabId, url, ip } = details;
    if (tabId === -1 || tabId === undefined) return;
    const tabData = getOrCreateTabData(tabId);
    
    // Only update mainFrame URL if we don't already have one, or if this is more authoritative
    if (!tabData.mainFrame.url || details.type === "main_frame") {
        tabData.mainFrame.url = url;
    }
    
    tabData.counters.totalRequests = (tabData.counters.totalRequests || 0) + 1;

    let ipAddress = ip;
    if (!ipAddress) {
        // Attempt DoH resolution if the browser didn't provide the connection IP
        ipAddress = await resolveHostnameToIp(extractHostname(url));
    }
    tabData.mainFrame.ip = ipAddress;

    const geo = await fetchCountryForIp(ipAddress);
    if (geo) {
        tabData.mainFrame.countryCode = geo.countryCode;
        tabData.mainFrame.countryName = geo.countryName;
        tabData.mainFrame.flagEmoji = geo.flagEmoji;
    }
    await updateBadgeForTab(tabId);
}

async function handleSubresource(details) {
    const { tabId, url, ip } = details;
    if (tabId === -1 || tabId === undefined) return;
    const tabData = getOrCreateTabData(tabId);

    // Build a single request entry path

    let ipAddress = ip;
    if (!ipAddress) {
        ipAddress = await resolveHostnameToIp(extractHostname(url));
    }
    const geo = await fetchCountryForIp(ipAddress);
    addRequestEntry(tabData, { url, ipAddress, geo });
}

browser.webRequest.onCompleted.addListener(
    async (details) => {
        try {
            if (details.type === "main_frame") {
                await handleMainFrame(details);
            } else {
                await handleSubresource(details);
            }
        } catch (e) {
            console.warn("onCompleted handler error", e);
        }
    },
    { urls: ["<all_urls>"] }
);

// Country policy blocking gate removed

// Populate main-frame data on navigation commits as a fallback for cases
// where webRequest does not emit main_frame (redirects, BFCache, prerender, etc.).
if (browser.webNavigation && browser.webNavigation.onCommitted) {
    browser.webNavigation.onCommitted.addListener(async (details) => {
        try {
            if (details.frameId === 0) {
                const tabId = details.tabId;
                const url = details.url;
                const tabData = getOrCreateTabData(tabId);
                
                // Only update mainFrame URL if we don't already have one
                if (!tabData.mainFrame.url) {
                    tabData.mainFrame.url = url;
                }
                
                // Attempt to resolve and geolocate like handleMainFrame
                const ipAddress = await resolveHostnameToIp(extractHostname(url));
                tabData.mainFrame.ip = tabData.mainFrame.ip || ipAddress;
                const geo = await fetchCountryForIp(ipAddress);
                if (geo) {
                    tabData.mainFrame.countryCode = geo.countryCode;
                    tabData.mainFrame.countryName = geo.countryName;
                    tabData.mainFrame.flagEmoji = geo.flagEmoji;
                }
                await updateBadgeForTab(tabId);
            }
        } catch (e) {
            console.warn("webNavigation.onCommitted error", e);
        }
    });
}

browser.tabs.onRemoved.addListener((tabId) => {
    tabDataById.delete(tabId);
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
    await updateBadgeForTab(tabId);
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === "loading") {
        // Reset per-load state
        tabDataById.delete(tabId);
        await browser.action.setBadgeText({ tabId, text: "" });
    }
});

browser.runtime.onMessage.addListener((message, sender) => {
    if (!message || !message.type) return;
    // Receive page info from content script to seed main-frame URL early
    if (message.type === "pageInfo") {
        const tabId = sender.tab?.id;
        if (tabId !== undefined) {
            const tabData = getOrCreateTabData(tabId);
            // Only update mainFrame URL if we don't already have one
            if (message.url && !tabData.mainFrame.url) {
                tabData.mainFrame.url = message.url;
            }
            void (async () => {
                // If country missing, resolve now
                if (!tabData.mainFrame.countryCode && message.url) {
                    const ipAddress = await resolveHostnameToIp(extractHostname(message.url));
                    tabData.mainFrame.ip = tabData.mainFrame.ip || ipAddress;
                    const geo = await fetchCountryForIp(ipAddress);
                    if (geo) {
                        tabData.mainFrame.countryCode = geo.countryCode;
                        tabData.mainFrame.countryName = geo.countryName;
                        tabData.mainFrame.flagEmoji = geo.flagEmoji;
                        await updateBadgeForTab(tabId);
                    }
                }
            })();
        }
        return; // no response
    }

    if (message.type === "observedRequest") {
        const url = message.url;
        const tabId = sender.tab?.id;
        if (!url || tabId === undefined) return;
        void (async () => {
            const tabData = getOrCreateTabData(tabId);
            const ipAddress = await resolveHostnameToIp(extractHostname(url));
            const geo = await fetchCountryForIp(ipAddress);
            addRequestEntry(tabData, { url, ipAddress, geo });
        })();
        return; // no response
    }
    if (message.type === "getActiveTabData") {
        return browser.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
            const active = tabs && tabs[0];
            const tabId = active ? active.id : undefined;
            let data = (tabId !== undefined) ? tabDataById.get(tabId) : undefined;
            // If main-frame country missing, compute from tab URL as a runtime fallback
            if (tabId !== undefined) {
                if (!data) data = getOrCreateTabData(tabId);
                const url = active?.url || data.mainFrame.url;
                
                // Always use the actual tab URL as the authoritative main frame URL
                if (active?.url) {
                    data.mainFrame.url = active.url;
                }
                
                if (url && !data.mainFrame.countryCode) {
                    const ipAddress = await resolveHostnameToIp(extractHostname(url));
                    data.mainFrame.ip = data.mainFrame.ip || ipAddress;
                    const geo = await fetchCountryForIp(ipAddress);
                    if (geo) {
                        data.mainFrame.countryCode = geo.countryCode;
                        data.mainFrame.countryName = geo.countryName;
                        data.mainFrame.flagEmoji = geo.flagEmoji;
                        await updateBadgeForTab(tabId);
                    }
                }
            }
            return { tabId, data };
        });
    }
    if (message.type === "getBlockingRules") {
        return loadBlockingRules();
    }
    if (message.type === "setBlockingRules") {
        return applyBlockingRules(message.rules || []);
    }
    if (message.type === "addSiteBlockRule") {
        return (async () => {
            const rules = await loadBlockingRules();
            const id = Date.now();
            rules.push({ id, pattern: message.pattern, action: "block", siteHost: message.siteHost });
            await applyBlockingRules(rules);
            return rules;
        })();
    }
    if (message.type === "removeRule") {
        return (async () => {
            const rules = await loadBlockingRules();
            const filtered = rules.filter(r => r.id !== Number(message.id));
            await applyBlockingRules(filtered);
            return filtered;
        })();
    }
    // Country policy messages removed
});

// Initialize cache from storage on startup
void hydrateIpCacheFromStorage();
// Also ensure dynamic rules match saved rules at startup
void (async () => { const rules = await loadBlockingRules(); await applyBlockingRules(rules); })();
