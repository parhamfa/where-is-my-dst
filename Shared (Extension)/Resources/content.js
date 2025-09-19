// Content script runs in the page to capture requests that the background
// may miss (service worker fetches, cache hits) and to set the main page origin.

function shortHostname(url) {
    try { return new URL(url).hostname; } catch (_) { return url; }
}

// Tell background the main page URL early
try {
    browser.runtime.sendMessage({ type: "pageInfo", url: location.href, host: location.host });
} catch (_) {}

// Intercept fetch() to observe outgoing requests (won't see static loads that bypass JS)
if (window.fetch) {
    const origFetch = window.fetch;
    window.fetch = async function(input, init) {
        try {
            const url = typeof input === "string" ? input : input?.url;
            if (url) {
                browser.runtime.sendMessage({ type: "observedRequest", url });
            }
        } catch (_) {}
        return origFetch.apply(this, arguments);
    };
}

// Intercept XHR
(function() {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        try { browser.runtime.sendMessage({ type: "observedRequest", url }); } catch (_) {}
        return origOpen.apply(this, arguments);
    };
})();

// Observe new resource loads via Performance API (captures cache hits)
try {
    let lastIndex = 0;
    const obs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        for (const e of entries) {
            if (e && e.name) {
                browser.runtime.sendMessage({ type: "observedRequest", url: e.name });
            }
        }
    });
    obs.observe({ entryTypes: ["resource"] });
    // Initial sweep once, but only once
    const entries = performance.getEntriesByType("resource");
    for (const e of entries) {
        if (e && e.name) {
            browser.runtime.sendMessage({ type: "observedRequest", url: e.name });
        }
    }
} catch (_) {}
