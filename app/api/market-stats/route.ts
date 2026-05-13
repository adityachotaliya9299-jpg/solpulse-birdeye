import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(
      'https://public-api.birdeye.so/defi/token_trending?sort_by=rank&sort_type=asc&offset=0&limit=20',
      {
        headers: { 'X-API-KEY': process.env.BIRDEYE_API_KEY!, 'x-chain': 'solana' },
        signal: controller.signal,
        cache: 'no-store',
      }
    );
    clearTimeout(timeout);
    const json = await res.json();
    const tokens = json?.data?.tokens || [];
    const gainers = tokens.filter((t: any) => (t.price24hChangePercent || 0) > 0).length;
    const totalVol = tokens.reduce((s: number, t: any) => s + (t.volume24hUSD || 0), 0);
    const avgChange = tokens.length > 0
      ? tokens.reduce((s: number, t: any) => s + (t.price24hChangePercent || 0), 0) / tokens.length : 0;
    let fearGreed = 50 + Math.min(25, avgChange / 100 * 5) + (gainers / Math.max(tokens.length, 1) - 0.5) * 30;
    fearGreed = Math.max(0, Math.min(100, Math.round(fearGreed)));
    const label = fearGreed >= 75 ? 'Extreme Greed' : fearGreed >= 60 ? 'Greed' : fearGreed >= 40 ? 'Neutral' : fearGreed >= 25 ? 'Fear' : 'Extreme Fear';
    return NextResponse.json({ totalTokens: tokens.length, gainers, losers: tokens.length - gainers, totalVolume: totalVol, fearGreed, fearGreedLabel: label, avgChange });
  } catch (err: any) {
    console.error('market-stats error:', err.message);
    return NextResponse.json({ totalTokens: 0, gainers: 0, losers: 0, totalVolume: 0, fearGreed: 50, fearGreedLabel: 'Neutral', avgChange: 0 });
  }
}
