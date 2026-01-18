import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';

function Interstitial() {
    const [status, setStatus] = useState<'SCANNING' | 'SAFE' | 'BLOCKED'>('SCANNING');
    const [targetUrl, setTargetUrl] = useState('');
    const [country, setCountry] = useState<string | null>(null);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const url = params.get('url');

        if (!url) {
            setStatus('BLOCKED');
            return;
        }

        setTargetUrl(url);

        // Ask background to verify this URL
        chrome.runtime.sendMessage({ type: 'CHECK_URL_SAFETY', url }, (response) => {
            if (response) {
                if (response.decision === 'ALLOW') {
                    setStatus('SAFE');
                    setCountry(response.countryCode);
                    // Redirect back to target after brief delay
                    setTimeout(() => {
                        window.location.href = url;
                    }, 1000);
                } else {
                    setStatus('BLOCKED');
                    setCountry(response.countryCode);
                }
            }
        });
    }, []);

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4">
            <div className="max-w-md w-full bg-slate-800 rounded-lg p-8 border border-slate-700 text-center space-y-6 shadow-2xl">
                {status === 'SCANNING' && (
                    <>
                        <div className="relative w-20 h-20 mx-auto">
                            <div className="absolute inset-0 border-4 border-slate-600 rounded-full"></div>
                            <div className="absolute inset-0 border-4 border-yellow-500 rounded-full border-t-transparent animate-spin"></div>
                            <span className="absolute inset-0 flex items-center justify-center text-2xl">⚡</span>
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-white mb-2">Inspecting Connection</h1>
                            <p className="text-slate-400 text-sm break-all">{targetUrl}</p>
                        </div>
                        <p className="text-xs text-slate-500 uppercase tracking-wider animate-pulse">Verifying Origin & Policy...</p>
                    </>
                )}

                {status === 'SAFE' && (
                    <>
                        <div className="w-20 h-20 mx-auto bg-green-500/20 rounded-full flex items-center justify-center text-4xl border-2 border-green-500">
                            ✓
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-green-400 mb-2">Connection Verified</h1>
                            <p className="text-slate-300 text-sm">Origin: {country || 'Safe'}</p>
                        </div>
                        <p className="text-slate-500 text-xs">Redirecting you now...</p>
                    </>
                )}

                {status === 'BLOCKED' && (
                    <>
                        <div className="w-20 h-20 mx-auto bg-red-500/20 rounded-full flex items-center justify-center text-4xl border-2 border-red-500">
                            ✕
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-red-500 mb-2">Connection Blocked</h1>
                            <p className="text-slate-300 text-sm">Origin: {country || 'Unknown'}</p>
                            <p className="text-slate-400 text-xs mt-2 break-all">{targetUrl}</p>
                        </div>
                        <div className="bg-red-900/20 p-3 rounded text-xs text-red-300 border border-red-900/50">
                            This site matches your aggressive blocking rules.
                        </div>
                        <button
                            onClick={() => window.close()}
                            className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded text-sm font-bold transition-colors"
                        >
                            Close Tab
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
    <React.StrictMode>
        <Interstitial />
    </React.StrictMode>
);
