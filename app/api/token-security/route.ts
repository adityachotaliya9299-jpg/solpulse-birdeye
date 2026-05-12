import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');
  if (!address) return NextResponse.json({ error: 'No address' }, { status: 400 });
  try {
    const res = await fetch(
      `https://public-api.birdeye.so/defi/token_security?address=${address}`,
      { headers: { 'X-API-KEY': process.env.BIRDEYE_API_KEY!, 'x-chain': 'solana' } }
    );
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
