import { NextResponse } from 'next/server';

let cache: { data: any[]; time: number } | null = null;
const CACHE_MS = 2 * 60 * 1000;

export async function GET() {
  try {
    if (cache && Date.now() - cache.time < CACHE_MS) {
      return NextResponse.json({ data: cache.data });
    }
    const res = await fetch(
      'https://public-api.birdeye.so/defi/tokenlist?sort_by=v24hUSD&sort_type=desc&offset=0&limit=20&min_liquidity=100',
      { headers: { 'X-API-KEY': process.env.BIRDEYE_API_KEY!, 'x-chain': 'solana' } }
    );
    const json = await res.json();
    const tokens = (json?.data?.tokens || []).map((t: any) => ({
      ...t,
      volume24hUSD: t.v24hUSD || 0,
      price24hChangePercent: t.v24hChangePercent || 0,
      volume24hChangePercent: t.v24hChangePercent || 0,
    }));
    cache = { data: tokens, time: Date.now() };
    return NextResponse.json({ data: tokens });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ data: cache?.data || [] });
  }
}
