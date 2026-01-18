import { useEffect, useState } from 'react';

interface RequestItem {
    url: string;
    ip?: string;
    countryCode?: string;
    flagEmoji?: string;
    timestamp: number;
}

interface TabData {
    mainFrame: {
        url?: string;
        ip?: string;
        countryCode?: string;
        flagEmoji?: string;
    };
    requests: RequestItem[];
}

interface AggressiveRule {
    id: string;
    action: 'ALLOW' | 'BLOCK';
    condition: 'IS' | 'IS_NOT';
    countries: string[];
}

export default function Popup() {
    const [data, setData] = useState<TabData | null>(null);
    const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
    const [expandedCountryGroups, setExpandedCountryGroups] = useState<string[]>([]);
    const [hasSetInitialExpand, setHasSetInitialExpand] = useState(false);

    const [blockedDomains, setBlockedDomains] = useState<Array<{ domain: string, context?: string }>>([]);
    const [aggressiveMode, setAggressiveMode] = useState(false);
    const [aggressiveBlockedList, setAggressiveBlockedList] = useState<Array<{ url: string, countryCode: string, initiatorSite?: string }>>([]);
    const [aggressiveRules, setAggressiveRules] = useState<AggressiveRule[]>([]);
    const [permanentlyBlocked, setPermanentlyBlocked] = useState<Set<string>>(new Set());

    const [view, setView] = useState<'requests' | 'blocked' | 'active'>('requests');
    const [showRulesConfig, setShowRulesConfig] = useState(false);
    const [newRule, setNewRule] = useState<{ action: 'ALLOW' | 'BLOCK', condition: 'IS' | 'IS_NOT', countries: string }>({
        action: 'ALLOW',
        condition: 'IS',
        countries: ''
    });

    useEffect(() => {
        if (data && data.mainFrame.url && !hasSetInitialExpand) {
            const current = tryGetHostname(data.mainFrame.url);
            if (current) {
                setExpandedGroups([current]);
            }
            setHasSetInitialExpand(true);
        }
    }, [data, hasSetInitialExpand]);

    useEffect(() => {
        const fetchBlocked = () => {
            chrome.runtime.sendMessage({ type: 'GET_BLOCKED_DOMAINS' }, (response) => {
                if (response && response.domains) {
                    setBlockedDomains(response.domains);
                }
            });
        };

        const fetchData = () => {
            chrome.runtime.sendMessage({ type: 'GET_TAB_DATA' }, (response) => {
                if (response) {
                    setData(response);
                }
            });

            chrome.runtime.sendMessage({ type: 'GET_AGGRESSIVE_STATE' }, (response) => {
                if (response) {
                    setAggressiveMode(response.enabled);
                    setAggressiveBlockedList(response.blockedItems || []);
                    setAggressiveRules(response.rules || []);
                }
            });
        };

        fetchData();
        fetchBlocked();
        const interval = setInterval(() => {
            fetchData();
            fetchBlocked();
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const toggleGroup = (context: string) => {
        setExpandedGroups(prev =>
            prev.includes(context)
                ? prev.filter(c => c !== context)
                : [...prev, context]
        );
    };

    const toggleRegionGroup = (region: string) => {
        setExpandedCountryGroups(prev =>
            prev.includes(region)
                ? prev.filter(c => c !== region)
                : [...prev, region]
        );
    };

    const toggleAggressiveMode = (enabled: boolean) => {
        chrome.runtime.sendMessage({ type: 'SET_AGGRESSIVE_MODE', enabled }, () => {
            setAggressiveMode(enabled);
        });
    };

    const handleReload = () => {
        chrome.tabs.reload();
        window.close();
    };

    const toggleBlock = (domain: string, isBlocked: boolean, context: string) => {
        const type = isBlocked ? 'UNBLOCK_DOMAIN' : 'BLOCK_DOMAIN';
        chrome.runtime.sendMessage({ type, domain, context }, () => {
            chrome.runtime.sendMessage({ type: 'GET_BLOCKED_DOMAINS' }, (response) => {
                if (response && response.domains) {
                    setBlockedDomains(response.domains);
                }
            });
        });
    };

    const blockAllInGroup = (group: { hostname: string }[], context: string) => {
        const domainsToBlock = group
            .filter(item => !blockedDomains.some(b => b.domain === item.hostname && (!b.context || b.context === context)))
            .map(item => ({ domain: item.hostname, context }));

        if (domainsToBlock.length === 0) return;

        chrome.runtime.sendMessage({ type: 'BLOCK_DOMAINS_BATCH', domains: domainsToBlock }, () => {
            chrome.runtime.sendMessage({ type: 'GET_BLOCKED_DOMAINS' }, (response) => {
                if (response && response.domains) {
                    setBlockedDomains(response.domains);
                }
            });
        });
    };

    const addRule = () => {
        if (!newRule.countries.trim()) return;
        const codes = newRule.countries.toUpperCase().split(',').map(c => c.trim()).filter(c => c.length === 2);
        if (codes.length === 0) return;

        const rule: AggressiveRule = {
            id: Date.now().toString(),
            action: newRule.action,
            condition: newRule.condition,
            countries: codes
        };

        const updated = [...aggressiveRules, rule];
        setAggressiveRules(updated);
        chrome.runtime.sendMessage({ type: 'SET_AGGRESSIVE_RULES', rules: updated });
        setNewRule({ ...newRule, countries: '' });
    };

    const removeRule = (id: string) => {
        const updated = aggressiveRules.filter(r => r.id !== id);
        setAggressiveRules(updated);
        chrome.runtime.sendMessage({ type: 'SET_AGGRESSIVE_RULES', rules: updated });
    };

    if (!data) {
        return (
            <div className="w-[350px] min-h-[400px] bg-slate-900 text-white flex items-center justify-center p-4">
                <p className="text-gray-400">Connecting...</p>
            </div>
        );
    }

    const { mainFrame, requests } = data;
    const currentSite = mainFrame.url ? tryGetHostname(mainFrame.url) : '';

    // Group requests by hostname
    const groupedRequests = requests.reduce((acc, req) => {
        const hostname = tryGetHostname(req.url);
        if (!acc[hostname]) {
            acc[hostname] = {
                hostname,
                count: 0,
                latestReq: req
            };
        }
        acc[hostname].count++;
        if (req.ip && !acc[hostname].latestReq.ip) {
            acc[hostname].latestReq = req;
        }
        return acc;
    }, {} as Record<string, { hostname: string, count: number, latestReq: RequestItem }>);

    // Sort countries by total request count
    const requestsByCountry = Object.values(groupedRequests).reduce((acc, group) => {
        const country = group.latestReq.countryCode
            ? `${group.latestReq.flagEmoji || ''} ${group.latestReq.countryCode}`.trim()
            : '❓ Unknown Location';

        if (!acc[country]) {
            acc[country] = [];
        }
        acc[country].push(group);
        return acc;
    }, {} as Record<string, typeof groupedRequests[string][]>);

    const sortedCountries = Object.keys(requestsByCountry).sort((a, b) => {
        const countA = requestsByCountry[a].reduce((sum, g) => sum + g.count, 0);
        const countB = requestsByCountry[b].reduce((sum, g) => sum + g.count, 0);
        return countB - countA;
    });

    // Group blocked domains by context
    const blockedByContext = blockedDomains.reduce((acc, item) => {
        const ctx = item.context || 'Global';
        if (!acc[ctx]) acc[ctx] = [];
        acc[ctx].push(item);
        return acc;
    }, {} as Record<string, typeof blockedDomains>);

    return (
        <div className="w-[350px] min-h-[500px] bg-slate-900 text-white font-sans flex flex-col">
            <header className="bg-slate-800 p-4 border-b border-slate-700">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                        <div className="text-4xl">
                            {mainFrame.flagEmoji || '🌍'}
                        </div>
                        <div>
                            <h1 className="text-lg font-bold truncate max-w-[150px]" title={mainFrame.url}>
                                {currentSite || 'Unknown Site'}
                            </h1>
                            <p className="text-xs text-slate-400">
                                {mainFrame.countryCode ? `Hosted in ${mainFrame.countryCode}` : 'Detecting location...'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleReload}
                        className="p-2 bg-slate-700 hover:bg-slate-600 rounded-full text-slate-300 transition-colors"
                        title="Reload Page"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                        </svg>
                    </button>
                </div>
            </header>

            <div className="flex border-b border-slate-800">
                <button
                    onClick={() => setView('requests')}
                    className={`flex-1 py-2 text-sm font-medium ${view === 'requests' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    Requests ({requests.length})
                </button>
                <button
                    onClick={() => setView('active')}
                    className={`flex-1 py-2 text-sm font-medium ${view === 'active' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    Inspector {aggressiveBlockedList.length > 0 && <span className="bg-red-500 text-white text-[9px] px-1 rounded ml-1">{aggressiveBlockedList.length}</span>}
                </button>
                <button
                    onClick={() => setView('blocked')}
                    className={`flex-1 py-2 text-sm font-medium ${view === 'blocked' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    Blocked ({blockedDomains.length})
                </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-900">
                {view === 'requests' ? (
                    <div className="flex flex-col p-4 space-y-4">
                        {sortedCountries.length === 0 ? (
                            <div className="p-4 text-center text-slate-500">
                                No external requests detected.
                            </div>
                        ) : (
                            sortedCountries.map(country => {
                                const domainGroups = requestsByCountry[country];
                                const sortedDomains = domainGroups.sort((a, b) => b.latestReq.timestamp - a.latestReq.timestamp);
                                const isOpen = expandedCountryGroups.includes(country);
                                const totalRequests = domainGroups.reduce((acc, g) => acc + g.count, 0);

                                return (
                                    <div key={country} className="space-y-2">
                                        <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-2">
                                            <button
                                                onClick={() => toggleRegionGroup(country)}
                                                className="flex-1 flex items-center text-xs font-bold text-slate-500 uppercase tracking-wider hover:text-slate-300 transition-colors text-left"
                                            >
                                                <span>
                                                    {country}
                                                    <span className="ml-2 text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">
                                                        {domainGroups.length} domains • {totalRequests} reqs
                                                    </span>
                                                </span>
                                                <span className="ml-2 transform transition-transform duration-200" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                                                    ▼
                                                </span>
                                            </button>

                                            {/* Block All Button - Only show if there are unblocked domains */}
                                            {domainGroups.some(g => !blockedDomains.some(b => b.domain === g.hostname && (!b.context || b.context === currentSite))) && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        blockAllInGroup(domainGroups, currentSite);
                                                    }}
                                                    className="ml-2 text-[10px] bg-red-900/30 text-red-400 hover:bg-red-900/50 hover:text-red-300 px-2 py-0.5 rounded transition-colors uppercase font-bold tracking-wider"
                                                    title="Block all domains in this group"
                                                >
                                                    Block All
                                                </button>
                                            )}
                                        </div>

                                        {isOpen && (
                                            <ul className="divide-y divide-slate-800 rounded bg-slate-800/20 animate-in fade-in slide-in-from-top-1 duration-200">
                                                {sortedDomains.map((group) => {
                                                    const isBlocked = blockedDomains.some(b => b.domain === group.hostname && (!b.context || b.context === currentSite));

                                                    return (
                                                        <li key={group.hostname} className="p-3 hover:bg-slate-800 transition-colors flex items-center justify-between group">
                                                            <div className="flex items-center space-x-3 overflow-hidden">
                                                                <div className="min-w-0">
                                                                    <div className="flex items-center space-x-2">
                                                                        <p className={`text-sm font-medium truncate ${isBlocked ? 'text-red-400 line-through' : 'text-white'}`} title={group.hostname}>
                                                                            {group.hostname}
                                                                        </p>
                                                                        <span className="text-xs bg-slate-700/50 text-slate-400 px-1.5 rounded">
                                                                            {group.count}
                                                                        </span>
                                                                    </div>
                                                                    <p className="text-[10px] text-slate-500 truncate">
                                                                        {group.latestReq.ip || 'Pending...'}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center space-x-2">
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        toggleBlock(group.hostname, isBlocked, currentSite);
                                                                    }}
                                                                    className={`cursor-pointer text-xs px-2 py-1 rounded transition-transform active:scale-95 ${isBlocked
                                                                        ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                                                        : 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
                                                                        }`}
                                                                >
                                                                    {isBlocked ? 'Unblock' : 'Block'}
                                                                </button>
                                                            </div>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                ) : view === 'active' ? (
                    <div className="flex flex-col p-4 space-y-4">
                        {/* Aggressive Mode Controls */}
                        <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-bold text-sm text-yellow-500 flex items-center">
                                    <span className="mr-2">⚡</span> Aggressive Inspection
                                </h3>
                                <button
                                    onClick={() => toggleAggressiveMode(!aggressiveMode)}
                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${aggressiveMode ? 'bg-yellow-500' : 'bg-slate-600'}`}
                                >
                                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${aggressiveMode ? 'translate-x-5' : 'translate-x-1'}`} />
                                </button>
                            </div>

                            <button
                                onClick={() => setShowRulesConfig(!showRulesConfig)}
                                className="w-full py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors flex items-center justify-center font-medium"
                            >
                                {showRulesConfig ? 'Close Rules' : 'Configure Rules'}
                            </button>

                            {showRulesConfig && (
                                <div className="mt-3 space-y-3 pt-3 border-t border-slate-700 animate-in fade-in slide-in-from-top-1">
                                    {/* Rule List */}
                                    <div className="space-y-2">
                                        {aggressiveRules.map(rule => (
                                            <div key={rule.id} className="flex items-center justify-between bg-slate-900/50 p-2 rounded text-xs border border-slate-700">
                                                <div className="flex items-center space-x-2">
                                                    <span className={`px-1.5 py-0.5 rounded font-bold ${rule.action === 'ALLOW' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                                                        {rule.action}
                                                    </span>
                                                    <span className="text-slate-500">if</span>
                                                    <span className="text-slate-300 font-medium">{rule.condition.replace('_', ' ')}</span>
                                                    <span className="text-white font-mono">{rule.countries.join(', ')}</span>
                                                </div>
                                                <button onClick={() => removeRule(rule.id)} className="text-slate-500 hover:text-red-400 px-1">✕</button>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Add Rule Form */}
                                    <div className="flex flex-col space-y-2 bg-slate-900 p-2 rounded border border-slate-700">
                                        <div className="flex space-x-2">
                                            <select
                                                className="bg-slate-800 text-white text-xs p-1 rounded border border-slate-700 flex-1 outline-none"
                                                value={newRule.action}
                                                onChange={e => setNewRule({ ...newRule, action: e.target.value as any })}
                                            >
                                                <option value="ALLOW">ALLOW</option>
                                                <option value="BLOCK">BLOCK</option>
                                            </select>
                                            <select
                                                className="bg-slate-800 text-white text-xs p-1 rounded border border-slate-700 flex-1 outline-none"
                                                value={newRule.condition}
                                                onChange={e => setNewRule({ ...newRule, condition: e.target.value as any })}
                                            >
                                                <option value="IS">IS</option>
                                                <option value="IS_NOT">IS NOT</option>
                                            </select>
                                        </div>
                                        <div className="flex space-x-2">
                                            <input
                                                type="text"
                                                className="bg-slate-800 text-white text-xs p-1 rounded border border-slate-700 flex-1 outline-none placeholder:text-slate-600"
                                                placeholder="US, CA, GB..."
                                                value={newRule.countries}
                                                onChange={e => setNewRule({ ...newRule, countries: e.target.value })}
                                            />
                                            <button
                                                onClick={addRule}
                                                className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 rounded font-bold transition-colors"
                                            >
                                                Add
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Blocked-on-the-spot List - filtered to current site only */}
                        {(() => {
                            const currentSiteSuspects = aggressiveBlockedList.filter(
                                item => item.initiatorSite === currentSite
                            );
                            return currentSiteSuspects.length > 0 ? (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Caught Suspects ({currentSiteSuspects.length})</h4>
                                    <ul className="divide-y divide-slate-800 rounded bg-red-900/10 border border-red-900/30">
                                        {currentSiteSuspects.map((item, idx) => (
                                            <li key={idx} className="p-3 flex items-center justify-between">
                                                <div>
                                                    <p className="text-sm font-medium text-red-300">{tryGetHostname(item.url)}</p>
                                                    <p className="text-[10px] text-red-400/70">Origin: {item.countryCode}</p>
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        const domain = tryGetHostname(item.url);
                                                        // Use the initiator site as context (website-specific blocking)
                                                        const context = item.initiatorSite || '';
                                                        toggleBlock(domain, false, context);
                                                        setPermanentlyBlocked(prev => new Set([...prev, domain]));
                                                    }}
                                                    disabled={permanentlyBlocked.has(tryGetHostname(item.url))}
                                                    className={`text-xs px-2 py-1 rounded transition-all active:scale-95 ${permanentlyBlocked.has(tryGetHostname(item.url))
                                                        ? 'bg-green-600 text-white cursor-default'
                                                        : 'bg-red-600 hover:bg-red-500 text-white'
                                                        }`}
                                                >
                                                    {permanentlyBlocked.has(tryGetHostname(item.url)) ? 'Blocked ✓' : 'Block Forever'}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ) : aggressiveMode ? (
                                <div className="text-center py-8 text-slate-600 text-xs italic">
                                    No suspects caught on this site.
                                </div>
                            ) : null;
                        })()}
                    </div>
                ) : (
                    <div className="flex flex-col p-4 space-y-4">
                        {Object.keys(blockedByContext).length === 0 ? (
                            <div className="p-4 text-center text-slate-500">
                                No domains blocked.
                            </div>
                        ) : (
                            Object.entries(blockedByContext).map(([context, items]) => {
                                const isOpen = expandedGroups.includes(context);
                                return (
                                    <div key={context} className="space-y-2">
                                        <button
                                            onClick={() => toggleGroup(context)}
                                            className="w-full flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800 pb-1 hover:text-slate-300 transition-colors"
                                        >
                                            <span>
                                                {context === currentSite ? <span className="text-blue-400">{context} (Current)</span> : context}
                                                <span className="ml-2 text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">{items.length}</span>
                                            </span>
                                            <span className="transform transition-transform duration-200" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                                                ▼
                                            </span>
                                        </button>

                                        {isOpen && (
                                            <ul className="divide-y divide-slate-800 rounded bg-slate-800/20 animate-in fade-in slide-in-from-top-1 duration-200">
                                                {items.map((b) => (
                                                    <li key={`${b.domain}-${b.context}`} className="p-3 hover:bg-slate-800 transition-colors flex items-center justify-between">
                                                        <div className="flex items-center space-x-3 overflow-hidden">
                                                            <span className="text-lg">🚫</span>
                                                            <p className="text-sm font-medium text-red-400 truncate">{b.domain}</p>
                                                        </div>
                                                        <button
                                                            onClick={() => toggleBlock(b.domain, true, b.context || '')}
                                                            className="cursor-pointer text-xs bg-slate-700 text-slate-300 hover:bg-slate-600 px-2 py-1 rounded active:scale-95 transition-transform"
                                                        >
                                                            Unblock
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function tryGetHostname(url: string) {
    try { return new URL(url).hostname; } catch { return url; }
}
