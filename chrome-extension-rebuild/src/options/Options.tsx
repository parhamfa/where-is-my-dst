import { useEffect, useState } from 'react';
import { PolicyEngine } from '../lib/PolicyEngine';

export default function Options() {
    const [blockedCountries, setBlockedCountries] = useState<string[]>([]);
    const [newCountry, setNewCountry] = useState('');

    useEffect(() => {
        loadPolicies();
    }, []);

    const loadPolicies = async () => {
        const countries = await PolicyEngine.getBlockedCountries();
        setBlockedCountries(countries);
    };

    const handleBlockCountry = async () => {
        if (newCountry && newCountry.length === 2) {
            await PolicyEngine.addBlockedCountry(newCountry.toUpperCase());
            setNewCountry('');
            await loadPolicies();
        }
    };

    const handleUnblockCountry = async (code: string) => {
        await PolicyEngine.removeBlockedCountry(code);
        await loadPolicies();
    };

    return (
        <div className="min-h-screen bg-slate-900 text-white p-8 font-sans">
            <div className="max-w-2xl mx-auto">
                <h1 className="text-3xl font-bold mb-8 flex items-center space-x-3">
                    <span>🛡️</span>
                    <span>Policy Manager</span>
                </h1>

                {/* Blocked Countries Section */}
                <div className="bg-slate-800 rounded-xl p-6 shadow-lg mb-8">
                    <h2 className="text-xl font-semibold mb-4">🚫 Country Blocking Policy</h2>
                    <p className="text-slate-400 mb-6 text-sm">
                        Traffic from these countries will be automatically blocked.
                        Note: This works by proactively blocking domains detected to be hosting in these countries.
                    </p>

                    <div className="flex space-x-2 mb-6">
                        <input
                            type="text"
                            maxLength={2}
                            placeholder="Country Code (e.g. CN)"
                            className="bg-slate-700 border border-slate-600 rounded px-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 w-full uppercase"
                            value={newCountry}
                            onChange={(e) => setNewCountry(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleBlockCountry()}
                        />
                        <button
                            onClick={handleBlockCountry}
                            disabled={newCountry.length !== 2}
                            className="bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2 rounded font-medium transition-colors"
                        >
                            Block
                        </button>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {blockedCountries.map(code => (
                            <div key={code} className="bg-slate-700 px-3 py-2 rounded flex items-center justify-between group">
                                <span className="font-mono font-bold">{code}</span>
                                <button
                                    onClick={() => handleUnblockCountry(code)}
                                    className="text-slate-400 hover:text-white bg-slate-600 hover:bg-red-500 rounded-full w-6 h-6 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
                                    title="Unblock"
                                >
                                    &times;
                                </button>
                            </div>
                        ))}
                        {blockedCountries.length === 0 && (
                            <div className="col-span-full text-center py-4 text-slate-500 italic">
                                No countries blocked.
                            </div>
                        )}
                    </div>
                </div>

                {/* Info */}
                <div className="text-center text-slate-500 text-xs">
                    Where is my Dst? v2.0 &bull; Privacy Focused &bull; No Analytics
                </div>
            </div>
        </div>
    );
}
