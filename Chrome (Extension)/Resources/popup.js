function shortHostname(url) {
    try { return new URL(url).hostname; } catch (_) { return url; }
}

function formatTime(ts) {
    try {
        const d = new Date(ts);
        return d.toLocaleTimeString();
    } catch (_) { return ""; }
}

async function getActiveTabData() {
    try {
        const resp = await browser.runtime.sendMessage({ type: "getActiveTabData" });
        return resp;
    } catch (e) {
        return {};
    }
}

function render(data) {
    const mainFlag = document.getElementById("main-flag");
    const mainHost = document.getElementById("main-host");
    const mainCountry = document.getElementById("main-country");
    const requestsEl = document.getElementById("requests");
    const summary = document.getElementById("summary");
    const countReq = document.getElementById("count-requests");
    const countCty = document.getElementById("count-countries");

    requestsEl.innerHTML = "";

    const tabData = data?.data;
    if (!tabData) {
        mainFlag.textContent = "❓";
        mainHost.textContent = "No data yet";
        mainCountry.innerHTML = "Open a page or reload <button id=\"reload-page\" title=\"Reload current page\">↻</button>";
        if (summary) summary.textContent = "";
        return;
    }

    const host = tabData.mainFrame?.url ? shortHostname(tabData.mainFrame.url) : "-";
    // If emoji rendering fails on some platforms, show country code as fallback
    const fallback = (tabData.mainFrame?.countryCode || "").toUpperCase();
    mainFlag.textContent = tabData.mainFrame?.flagEmoji || fallback || "❓";
    mainHost.textContent = host;
    const countryName = tabData.mainFrame?.countryName || tabData.mainFrame?.countryCode || "";
    mainCountry.innerHTML = `${countryName} <button id="reload-page" title="Reload current page">↻</button>`;

    const reqs = tabData.requests || [];
    const total = (tabData.counters && tabData.counters.totalRequests) || reqs.length;
    const groups = new Map(); // key: countryCode||"?" -> { flag, name, items: [], count: number }
    for (const r of reqs) {
        const code = (r.countryCode || "?").toUpperCase();
        const flag = r.flagEmoji || (r.countryCode ? r.countryCode.toUpperCase() : "?");
        const name = r.countryName || r.countryCode || "Unknown";
        if (!groups.has(code)) groups.set(code, { flag, name, items: [], count: 0 });
        const g = groups.get(code);
        g.items.push(r);
        g.count++;
    }
    const countriesCount = groups.size - (groups.has("?") ? 1 : 0);

    // Render groups sorted by size desc
    const sorted = Array.from(groups.entries()).sort((a, b) => b[1].items.length - a[1].items.length);
    for (const [code, info] of sorted) {
        const groupEl = document.createElement("li");
        groupEl.className = "group";
        const count = (tabData.counters && tabData.counters.countryByCode && code !== "?" ? tabData.counters.countryByCode[code] : undefined) || info.items.length;
        const header = document.createElement("div");
        header.className = "group-header";
        header.innerHTML = `
            <div class="flag">${info.flag}</div>
            <div>
                <div class="title">${info.name || code}</div>
                <div class="meta">${code === "?" ? "Unknown" : code}</div>
            </div>
            <div class="count">${count}</div>
        `;
        groupEl.appendChild(header);

        const itemsEl = document.createElement("ul");
        itemsEl.className = "group-items";
        // Virtualized batches of 20
        const BATCH = 20;
        let index = 0;
        const renderBatch = () => {
            const end = Math.min(index + BATCH, info.items.length);
            for (; index < end; index++) {
                const r = info.items[index];
                const li = document.createElement("li");
                li.className = "req";
                const reqFallback = (r.countryCode || "").toUpperCase();
                li.innerHTML = `
                    <div class="flag">${r.flagEmoji || reqFallback || ""}</div>
                    <div>
                        <div class="host">${shortHostname(r.url)}</div>
                        <div class="meta">${r.countryName || r.countryCode || ""} ${r.ip ? `· ${r.ip}` : ""} · ${formatTime(r.time)}</div>
                    </div>
                    <div><button class="mini" data-op="block-site" data-url="${encodeURIComponent(r.url)}">Block on this site</button></div>
                `;
                itemsEl.appendChild(li);
            }
            if (index < info.items.length) {
                const more = document.createElement("button");
                more.className = "mini";
                more.textContent = "Show more";
                const wrap = document.createElement("div");
                wrap.style.padding = "4px 0 8px 28px";
                wrap.appendChild(more);
                itemsEl.appendChild(wrap);
                more.addEventListener("click", () => {
                    wrap.remove();
                    renderBatch();
                });
            }
        };
        renderBatch();
        groupEl.appendChild(itemsEl);

        header.addEventListener("click", () => {
            groupEl.classList.toggle("open");
        });

        requestsEl.appendChild(groupEl);
    }

    const summaryText = `${total} requests · ${countriesCount} countries`;
    if (countReq) countReq.textContent = String(total);
    if (countCty) countCty.textContent = String(countriesCount);
    if (summary) summary.textContent = summaryText;
}

async function init() {

    // Site preferences section
    const sitePrefsList = document.getElementById("site-prefs-list");

    async function getRules() {
        try { return await browser.runtime.sendMessage({ type: "getBlockingRules" }) || []; } catch (_) { return []; }
    }
    async function setRules(rules) {
        try { await browser.runtime.sendMessage({ type: "setBlockingRules", rules }); } catch (_) {}
        return rules;
    }
    async function renderRules(rules) {
        // Preserve which site groups are open before we re-render
        const openSitesBefore = new Set(
            Array.from(sitePrefsList.querySelectorAll('details.rule-group[open]')).map(d => d.dataset.site)
        );

        sitePrefsList.innerHTML = "";
        const list = rules;

        // Group by siteHost (only site-specific rules, no global rules)
        const groups = new Map();
        for (const r of list) {
            // Only include rules that have a siteHost (skip global rules)
            if (r.siteHost && r.siteHost.trim() !== "") {
                const key = r.siteHost;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(r);
            }
        }

        // Render site groups; global group last
        const ordered = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));

        if (ordered.length === 0) {
            // Show placeholder when no rules exist
            const placeholder = document.createElement("div");
            placeholder.className = "site-prefs-placeholder";
            placeholder.innerHTML = `
                <div class="empty-state-icon">
                    <svg viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg">
                        <!-- Blinking dots -->
                        <circle cx="30" cy="30" r="6" fill="currentColor" opacity="0.3">
                            <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite"/>
                        </circle>
                        <circle cx="60" cy="30" r="6" fill="currentColor" opacity="0.3">
                            <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" begin="0.3s" repeatCount="indefinite"/>
                        </circle>
                        <circle cx="90" cy="30" r="6" fill="currentColor" opacity="0.3">
                            <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" begin="0.6s" repeatCount="indefinite"/>
                        </circle>
                    </svg>
                </div>
                <div class="empty-state-text">Blocked requests for websites will be shown here</div>
                <div class="empty-state-subtext">Click the "Block" button next to any request</div>
            `;
            sitePrefsList.appendChild(placeholder);
        } else {
            for (const [site, items] of ordered) {
                // Only site-scoped groups are rendered; no global group
                const details = document.createElement("details");
                details.className = "rule-group";
                details.dataset.site = site;
                const summary = document.createElement("summary");
                summary.className = "site-summary";
                summary.innerHTML = `<span class="chev">›</span> ${site} <span class="site-count">${items.length}</span>`;
                details.appendChild(summary);

                const ul = document.createElement("ul");
                ul.className = "site-items";
                for (const r of items) {
                    const li = document.createElement("li");
                    li.className = "rule-item";
                    li.innerHTML = `
                        <div class="pattern">${r.pattern}</div>
                        <div class="type">${r.action}</div>
                        <div><button data-id="${r.id}" data-op="remove">Remove</button></div>
                    `;
                    ul.appendChild(li);
                }
                details.appendChild(ul);
                sitePrefsList.appendChild(details);

                // Restore previously open state
                if (openSitesBefore.has(site)) {
                    details.open = true;
                }
            }
        }
    }

    let rules = await getRules();
    await renderRules(rules);

    // Country policy removed


    const handleRuleListClick = async (e) => {
        const btn = e.target.closest("button[data-op]");
        if (!btn) return;
        const op = btn.getAttribute("data-op");
        if (op === "remove") {
            const id = Number(btn.getAttribute("data-id"));
            rules = rules.filter(r => r.id !== id);
            await setRules(rules);
            rules = await getRules();
            await renderRules(rules);
            return;
        }
        if (op === "remove-site-policy") {
            const siteHost = btn.getAttribute("data-site");
            try {
                await browser.runtime.sendMessage({ type: "removeSiteCountryPolicy", siteHost });
                rules = await getRules();
                await renderRules(rules);
            } catch (_) {}
        }
    };
    document.getElementById("site-prefs-list").addEventListener("click", handleRuleListClick);

    // No policy save listeners

    // Inline site-aware quick actions in request list
    // Reload page button (using event delegation for dynamically created buttons)
    document.addEventListener("click", async (e) => {
        if (e.target && e.target.id === "reload-page") {
            try {
                const tabs = await browser.tabs.query({ active: true, currentWindow: true });
                if (tabs[0]?.id) {
                    await browser.tabs.reload(tabs[0].id);
                    // Close the popup after reload
                    window.close();
                }
            } catch (error) {
                console.error("Failed to reload page:", error);
            }
        }
    });

    document.getElementById("requests").addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-op='block-site']");
        if (!btn) return;
        const url = decodeURIComponent(btn.getAttribute("data-url"));
        let siteHost = "";
        try { 
            const tabsData = await getActiveTabData(); 
            if (tabsData?.data?.mainFrame?.url) {
                siteHost = new URL(tabsData.data.mainFrame.url).hostname;
            }
        } catch (_) {}
        
        // Fallback: if we can't get the main frame URL, try to get it from the current tab
        if (!siteHost) {
            try {
                const tabs = await browser.tabs.query({ active: true, currentWindow: true });
                if (tabs[0]?.url) {
                    siteHost = new URL(tabs[0].url).hostname;
                }
            } catch (_) {}
        }
        
        const reqHost = (() => { try { return new URL(url).hostname; } catch (_) { return url; }})();
        
        // Only proceed if we have a valid siteHost
        if (!siteHost || siteHost.trim() === "") {
            console.warn("Cannot block request: no site host found");
            return;
        }
        
        try {
            await browser.runtime.sendMessage({ type: "addSiteBlockRule", siteHost, pattern: reqHost });
            // Visual feedback
            btn.disabled = true; btn.textContent = "Blocked";
            btn.style.opacity = "0.6";
            // Refresh the rules to show the new block rule immediately
            const rules = await getRules();
            await renderRules(rules);
        } catch (_) {}
    });

    const data = await getActiveTabData();
    window.__activeTabData = data;
    render(data);
}

document.addEventListener("DOMContentLoaded", init);
