'use client';
import { useEffect, useState, useCallback } from 'react';

interface Token {
  address: string;
  symbol: string;
  name: string;
  price: number;
  volume24hUSD: number;
  price24hChangePercent: number;
  volume24hChangePercent?: number;
  logoURI?: string;
  liquidity?: number;
  fdv?: number;
  mc?: number;
}

interface MarketStats {
  totalTokens: number;
  gainers: number;
  losers: number;
  totalVolume: number;
  fearGreed: number;
  fearGreedLabel: string;
  avgChange: number;
}

function calcSafety(token: Token): number {
  let score = 100;
  const liq = token.liquidity || 0;
  const priceChange = Math.abs(token.price24hChangePercent || 0);
  const volChange = Math.abs(token.volume24hChangePercent || 0);
  if (liq < 10000) score -= 35;
  else if (liq < 50000) score -= 20;
  else if (liq < 200000) score -= 10;
  if (priceChange > 5000) score -= 30;
  else if (priceChange > 1000) score -= 20;
  else if (priceChange > 200) score -= 10;
  if (volChange > 10000) score -= 15;
  return Math.max(0, Math.min(100, score));
}

function calcMomentum(token: Token): number {
  const priceChange = token.price24hChangePercent || 0;
  const volChange = token.volume24hChangePercent || 0;
  const liq = token.liquidity || 1;
  if (priceChange <= 0) return 0;
  let score = 0;
  score += Math.min(40, priceChange / 100 * 10);
  score += Math.min(30, Math.max(0, volChange) / 100 * 8);
  score += Math.min(30, Math.log10(liq + 1) * 5);
  return Math.min(100, Math.round(score));
}

function calcPulse(token: Token): number {
  const safety = calcSafety(token);
  const momentum = calcMomentum(token);
  const volChange = token.volume24hChangePercent || 0;
  const volBonus = Math.min(20, volChange / 100 * 5);
  return Math.min(100, Math.round(safety * 0.4 + momentum * 0.4 + volBonus * 0.2));
}

function PulseBar({ score }: { score: number }) {
  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#eab308' : '#ef4444';
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-zinc-500">Pulse</span>
        <span className="font-bold font-mono" style={{ color }}>{score}</span>
      </div>
      <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, background: `linear-gradient(90deg, ${color}66, ${color})` }} />
      </div>
    </div>
  );
}

function SafetyBadge({ score }: { score: number }) {
  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#eab308' : '#ef4444';
  const label = score >= 70 ? 'SAFE' : score >= 40 ? 'CAUTION' : 'RISKY';
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold border whitespace-nowrap"
      style={{ color, borderColor: `${color}44`, background: `${color}11` }}>
      {label} {score}
    </span>
  );
}

function TokenCard({ token }: { token: Token & { pulse: number; safety: number } }) {
  const isUp = (token.price24hChangePercent || 0) > 0;
  const vol = token.volume24hUSD || 0;
  const price = token.price < 0.001 ? token.price.toExponential(2)
    : token.price < 1 ? token.price.toFixed(4) : token.price.toFixed(2);
  const safetyColor = token.safety >= 70 ? '#22c55e' : token.safety >= 40 ? '#eab308' : '#ef4444';

  return (
    <a href={`https://birdeye.so/token/${token.address}?chain=solana`} target="_blank" rel="noopener noreferrer"
      className="block rounded-2xl p-4 transition-all duration-300 hover:-translate-y-1 cursor-pointer"
      style={{ background: 'linear-gradient(135deg, #0f1117, #141820)', border: '1px solid #1f2937' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = `${safetyColor}44`; (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 30px ${safetyColor}11`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1f2937'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {token.logoURI ? (
            <img src={token.logoURI} alt={token.symbol} className="w-8 h-8 rounded-full flex-shrink-0"
              style={{ border: `2px solid ${safetyColor}33` }}
              onError={e => { e.currentTarget.style.display = 'none'; }} />
          ) : (
            <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
              style={{ background: `${safetyColor}22`, color: safetyColor }}>
              {token.symbol?.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="font-bold text-white text-sm truncate">{token.symbol}</p>
            <p className="text-zinc-500 text-xs truncate max-w-[90px]">{token.name}</p>
          </div>
        </div>
        <SafetyBadge score={token.safety} />
      </div>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-white font-mono font-bold">${price}</p>
          <p className="text-zinc-600 text-xs mt-0.5">Vol: ${(vol / 1_000_000).toFixed(2)}M</p>
        </div>
        <span className="font-bold text-sm" style={{ color: isUp ? '#22c55e' : '#ef4444' }}>
          {isUp ? '▲' : '▼'} {Math.abs(token.price24hChangePercent || 0).toFixed(2)}%
        </span>
      </div>
      <PulseBar score={token.pulse} />
    </a>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl p-4 animate-pulse" style={{ background: '#0f1117', border: '1px solid #1f2937' }}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full bg-zinc-800" />
        <div className="flex-1 space-y-1">
          <div className="h-3 w-16 bg-zinc-800 rounded" />
          <div className="h-2 w-24 bg-zinc-800 rounded" />
        </div>
      </div>
      <div className="h-4 w-20 bg-zinc-800 rounded mb-1" />
      <div className="h-2 w-28 bg-zinc-800 rounded mb-3" />
      <div className="h-1 bg-zinc-800 rounded-full" />
    </div>
  );
}

export default function Dashboard() {
  const [trending, setTrending] = useState<Token[]>([]);
  const [topVolume, setTopVolume] = useState<Token[]>([]);
  const [stats, setStats] = useState<MarketStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'trending' | 'volume'>('trending');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'pulse' | 'change' | 'volume' | 'safety'>('pulse');
  const [lastUpdated, setLastUpdated] = useState('');
  const [spinning, setSpinning] = useState(false);

  const fetchData = useCallback(async () => {
    setSpinning(true);
    setLoading(true);
    try {
      const [trendRes, volRes, statsRes] = await Promise.all([
        fetch('/api/new-tokens'),
        fetch('/api/trending'),
        fetch('/api/market-stats'),
      ]);
      const trendData = await trendRes.json();
      const volData = await volRes.json();
      const statsData = await statsRes.json();
      setTrending(trendData.data || []);
      setTopVolume(volData.data || []);
      setStats(statsData);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) { console.error(err); }
    setLoading(false);
    setTimeout(() => setSpinning(false), 500);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const baseTokens = (activeTab === 'trending' ? trending : topVolume)
    .map(t => ({ ...t, pulse: calcPulse(t), safety: calcSafety(t) }))
    .filter(t => {
      if (!search) return true;
      const q = search.toLowerCase();
      return t.symbol?.toLowerCase().includes(q) || t.name?.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (sortBy === 'pulse') return b.pulse - a.pulse;
      if (sortBy === 'change') return (b.price24hChangePercent || 0) - (a.price24hChangePercent || 0);
      if (sortBy === 'volume') return (b.volume24hUSD || 0) - (a.volume24hUSD || 0);
      if (sortBy === 'safety') return b.safety - a.safety;
      return 0;
    });

  const fearColor = !stats ? '#eab308'
    : stats.fearGreed >= 75 ? '#22c55e' : stats.fearGreed >= 60 ? '#84cc16'
    : stats.fearGreed >= 40 ? '#eab308' : stats.fearGreed >= 25 ? '#f97316' : '#ef4444';

  return (
    <main className="min-h-screen text-white" style={{ background: '#080b10', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div className="sticky top-0 z-10 px-4 sm:px-6 py-4"
        style={{ background: 'rgba(8,11,16,0.95)', borderBottom: '1px solid #1f2937', backdropFilter: 'blur(10px)' }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-xl"
              style={{ background: 'linear-gradient(135deg, #06b6d4, #3b82f6)' }}>⚡</div>
            <div>
              <h1 className="text-xl font-black text-white">SolPulse</h1>
              <p className="text-xs text-zinc-500 hidden sm:block">Powered by Birdeye Data API</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a href="https://t.me/SolPulseAlerts" target="_blank" rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 rounded-lg font-bold transition-all hidden sm:block"
              style={{ background: '#06b6d422', color: '#06b6d4', border: '1px solid #06b6d444' }}>
              📢 Join Alerts
            </a>
            {lastUpdated && <span className="text-xs text-zinc-600 hidden md:block">Updated: {lastUpdated}</span>}
            <button onClick={fetchData}
              className="p-2 rounded-lg transition-all text-zinc-500 hover:text-cyan-400"
              style={{ background: '#0d1117', border: '1px solid #1f2937' }}>
              <span className={spinning ? 'inline-block animate-spin' : 'inline-block'}>↻</span>
            </button>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="px-4 sm:px-6 py-3" style={{ background: '#0a0e14', borderBottom: '1px solid #1f2937' }}>
          <div className="max-w-7xl mx-auto flex flex-wrap gap-4 sm:gap-8 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#22c55e' }} />
              <span className="text-zinc-500">Live</span>
            </div>
            <span className="text-zinc-500">🔥 Trending: <span className="text-white font-bold">{stats.totalTokens}</span></span>
            <span className="text-zinc-500">🟢 Gainers: <span className="font-bold" style={{ color: '#22c55e' }}>{stats.gainers}</span></span>
            <span className="text-zinc-500">🔴 Losers: <span className="font-bold" style={{ color: '#ef4444' }}>{stats.losers}</span></span>
            <span className="text-zinc-500">💰 Vol: <span className="text-white font-bold">${(stats.totalVolume / 1_000_000).toFixed(1)}M</span></span>
            <span className="text-zinc-500">
              😨 Sentiment: <span className="font-bold" style={{ color: fearColor }}>{stats.fearGreedLabel} ({stats.fearGreed})</span>
            </span>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

        {/* Hero */}
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-3">
            Real-time Solana<br />
            <span style={{ background: 'linear-gradient(90deg, #06b6d4, #3b82f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Token Intelligence
            </span>
          </h2>
          <p className="text-zinc-400 text-sm max-w-md mx-auto">
            Pulse Score combines safety + momentum + volume into one number.
            Find opportunities before the crowd.
          </p>
          <div className="flex items-center justify-center gap-3 mt-4">
            <a href="https://t.me/SolPulseBirdBot" target="_blank" rel="noopener noreferrer"
              className="px-4 py-2 rounded-xl text-sm font-bold transition-all"
              style={{ background: 'linear-gradient(90deg, #06b6d4, #3b82f6)', color: '#000' }}>
              🤖 Try Telegram Bot
            </a>
            <a href="https://t.me/SolPulseAlerts" target="_blank" rel="noopener noreferrer"
              className="px-4 py-2 rounded-xl text-sm font-bold transition-all"
              style={{ background: '#1f2937', color: '#e5e7eb' }}>
              📢 Join Alerts
            </a>
          </div>
        </div>

        {/* Search */}
        <div className="mb-4 relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500">🔍</span>
          <input type="text" placeholder="Search token symbol or name..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 text-sm text-white placeholder-zinc-600 rounded-xl focus:outline-none transition-all"
            style={{ background: '#0d1117', border: '1px solid #1f2937' }}
            onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = '#06b6d4'}
            onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = '#1f2937'} />
        </div>

        {/* Tabs + Sort */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="flex p-1 rounded-xl" style={{ background: '#0d1117', border: '1px solid #1f2937' }}>
            {(['trending', 'volume'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className="px-4 py-2 rounded-lg text-sm font-bold transition-all"
                style={activeTab === tab
                  ? { background: 'linear-gradient(90deg, #06b6d4, #3b82f6)', color: '#000' }
                  : { color: '#6b7280' }}>
                {tab === 'trending' ? '🔥 Trending' : '📊 Top Volume'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="text-xs text-zinc-500 whitespace-nowrap">Sort:</span>
            {([
              { key: 'pulse', label: '⚡ Pulse' },
              { key: 'change', label: '📈 Change' },
              { key: 'volume', label: '💰 Volume' },
              { key: 'safety', label: '🛡️ Safety' },
            ] as { key: typeof sortBy; label: string }[]).map(({ key, label }) => (
              <button key={key} onClick={() => setSortBy(key)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all"
                style={sortBy === key
                  ? { background: '#06b6d422', color: '#06b6d4', border: '1px solid #06b6d444' }
                  : { color: '#4b5563' }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {!loading && (
          <p className="text-xs text-zinc-600 mb-4 uppercase tracking-wider">
            Showing <span className="text-zinc-300 font-mono">{baseTokens.length}</span> tokens
            {search && ` matching "${search}"`}
          </p>
        )}

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {loading
            ? Array(12).fill(0).map((_, i) => <SkeletonCard key={i} />)
            : baseTokens.length === 0
            ? <div className="col-span-full text-center py-20 text-zinc-600">No tokens found</div>
            : baseTokens.map((token, i) => <TokenCard key={token.address + i} token={token as any} />)
          }
        </div>

        {/* Footer */}
        <div className="mt-16 pb-8 text-center space-y-2">
          <p className="text-xs text-zinc-600">
            Built with <span className="text-zinc-400">Birdeye Data API</span> • Auto-refreshes every 60s • <span className="text-zinc-400">#BirdeyeAPI</span>
          </p>
          <p className="text-xs text-zinc-700">
            Built by{' '}
            <a href="https://adityachotaliya.vercel.app" target="_blank" rel="noopener noreferrer"
              className="font-bold transition-colors hover:text-cyan-400"
              style={{ background: 'linear-gradient(90deg, #06b6d4, #3b82f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Aditya Chotaliya
            </a>
            {' '}•{' '}
            <a href="https://github.com/adityachotaliya9299-jpg" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-white transition-colors">GitHub</a>
          </p>
        </div>
      </div>
    </main>
  );
}
