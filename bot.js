require('dotenv').config({ path: '.env.local' });
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const BIRDEYE_KEY = process.env.BIRDEYE_API_KEY;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '@SolPulseAlerts';
const ALERT_FILE = './alerts.json';

// Cache
let trendingCache = { data: [], time: 0 };
const CACHE_MS = 60 * 1000;

async function getTrending() {
  if (Date.now() - trendingCache.time < CACHE_MS && trendingCache.data.length > 0) return trendingCache.data;
  const res = await axios.get('https://public-api.birdeye.so/defi/token_trending?sort_by=rank&sort_type=asc&offset=0&limit=20',
    { headers: { 'X-API-KEY': BIRDEYE_KEY, 'x-chain': 'solana' } });
  trendingCache = { data: res.data?.data?.tokens || [], time: Date.now() };
  return trendingCache.data;
}

async function getTokenSecurity(address) {
  try {
    const res = await axios.get(`https://public-api.birdeye.so/defi/token_security?address=${address}`,
      { headers: { 'X-API-KEY': BIRDEYE_KEY, 'x-chain': 'solana' } });
    return res.data?.data || null;
  } catch { return null; }
}

// Scoring
function calcSafetyScore(token, security) {
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

  if (security) {
    if (security.mintAuthority) score -= 20;
    if (security.freezeAuthority) score -= 15;
    if ((security.top10HolderPercent || 0) > 80) score -= 20;
  }

  return Math.max(0, Math.min(100, score));
}

function calcMomentum(token) {
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

function calcPulseScore(token, security) {
  const safety = calcSafetyScore(token, security);
  const momentum = calcMomentum(token);
  const volChange = token.volume24hChangePercent || 0;
  const volBonus = Math.min(20, volChange / 100 * 5);
  return Math.min(100, Math.round(safety * 0.4 + momentum * 0.4 + volBonus * 0.2));
}

function calcFearGreed(tokens) {
  if (!tokens.length) return { score: 50, label: 'Neutral', emoji: '😐' };
  const gainers = tokens.filter(t => (t.price24hChangePercent || 0) > 0).length;
  const avgChange = tokens.reduce((s, t) => s + (t.price24hChangePercent || 0), 0) / tokens.length;
  let score = 50 + Math.min(25, avgChange / 100 * 5) + (gainers / tokens.length - 0.5) * 30;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const label = score >= 75 ? 'Extreme Greed' : score >= 60 ? 'Greed' : score >= 40 ? 'Neutral' : score >= 25 ? 'Fear' : 'Extreme Fear';
  const emoji = score >= 75 ? '😱' : score >= 60 ? '😀' : score >= 40 ? '😐' : score >= 25 ? '😨' : '😰';
  return { score, label, emoji };
}

// Alert tracking
let sentAlerts = new Set();
try {
  if (fs.existsSync(ALERT_FILE)) {
    const data = JSON.parse(fs.readFileSync(ALERT_FILE, 'utf8'));
    sentAlerts = new Set(data);
  }
} catch {}

function saveAlerts() {
  try { fs.writeFileSync(ALERT_FILE, JSON.stringify([...sentAlerts])); } catch {}
}

// Auto channel alerts every 5 minutes
async function sendChannelAlerts() {
  try {
    const tokens = await getTrending();
    const hotTokens = tokens.filter(t => {
      const volChange = t.volume24hChangePercent || 0;
      const priceChange = t.price24hChangePercent || 0;
      const liq = t.liquidity || 0;
      return volChange > 200 && priceChange > 10 && liq > 20000;
    });

    for (const token of hotTokens.slice(0, 3)) {
      const alertKey = `${token.symbol}-${Math.floor(Date.now() / (30 * 60 * 1000))}`;
      if (sentAlerts.has(alertKey)) continue;

      const security = await getTokenSecurity(token.address);
      const pulse = calcPulseScore(token, security);
      const safety = calcSafetyScore(token, security);
      if (safety < 50) continue;

      const price = token.price < 0.001 ? token.price.toExponential(3) : token.price.toFixed(4);
      const volChange = (token.volume24hChangePercent || 0).toFixed(0);
      const priceChange = (token.price24hChangePercent || 0).toFixed(1);
      const vol = ((token.volume24hUSD || 0) / 1_000_000).toFixed(2);
      const liq = ((token.liquidity || 0) / 1000).toFixed(0);
      const safetyLabel = safety >= 70 ? '🟢 SAFE' : safety >= 40 ? '🟡 CAUTION' : '🔴 RISKY';

      const message = `
⚡ *SOLPULSE ALERT*

Token: *${token.symbol}*
Pulse Score: *${pulse}/100*

📊 *Why this triggered:*
+ Volume +${volChange}% spike
+ Price +${priceChange}% momentum
+ Liquidity stable ($${liq}K)

💲 Price: $${price}
💰 Volume: $${vol}M
🛡️ Safety: ${safety}/100 ${safetyLabel}

🔗 [View on Birdeye](https://birdeye.so/token/${token.address}?chain=solana)

⚠️ _Not financial advice. DYOR!_
`.trim();

      await bot.sendMessage(CHANNEL_ID, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
      sentAlerts.add(alertKey);
      saveAlerts();
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch (err) {
    console.error('Channel alert error:', err.message);
  }
}

// Commands
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || 'trader';
  bot.sendMessage(msg.chat.id, `
⚡ *Welcome to SolPulse, ${name}!*

Real-time Solana token intelligence powered by Birdeye Data API.

*Commands:*
/pulse — 🔥 Top tokens by Pulse Score
/new — ⚡ Newly detected hot tokens
/analyze SYMBOL — 🔍 Deep token analysis
/compare SYM1 SYM2 — ⚔️ Token comparison
/whale — 🐋 Whale volume alerts
/fear — 😨 Market Fear & Greed
/market — 📊 Market overview
/top3 — 🏆 Top 3 opportunities

📢 Join alerts: @SolPulseAlerts

_Built by Aditya Chotaliya 🚀_
  `.trim(), { parse_mode: 'Markdown' });
});

bot.onText(/\/pulse/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '⚡ Calculating Pulse Scores...');
  try {
    const tokens = await getTrending();
    const scored = tokens
      .map(t => ({ ...t, pulse: calcPulseScore(t, null), safety: calcSafetyScore(t, null), momentum: calcMomentum(t) }))
      .filter(t => t.pulse > 40)
      .sort((a, b) => b.pulse - a.pulse)
      .slice(0, 8);

    if (scored.length === 0) {
      bot.sendMessage(chatId, '⚡ No high pulse tokens right now. Market may be quiet.\n\n_Check back in 15 minutes._');
      return;
    }

    let message = '⚡ *Top Tokens by Pulse Score*\n_Combined safety + momentum + volume_\n\n';
    scored.forEach((token, i) => {
      const change = (token.price24hChangePercent || 0).toFixed(1);
      const price = token.price < 0.001 ? token.price.toExponential(2) : token.price.toFixed(4);
      const safetyLabel = token.safety >= 70 ? '🟢' : token.safety >= 40 ? '🟡' : '🔴';
      message += `*${i + 1}. ${token.symbol}* ${safetyLabel}\n`;
      message += `⚡ Pulse: ${token.pulse}/100 | 📈 +${change}%\n`;
      message += `💲 $${price}\n\n`;
    });
    message += '_Use /analyze SYMBOL for full breakdown_';
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, '❌ Error. Try again in 30 seconds.');
  }
});

bot.onText(/\/new/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '⚡ Finding hot new tokens...');
  try {
    const tokens = await getTrending();
    const hot = tokens
      .filter(t => (t.volume24hChangePercent || 0) > 100 && (t.price24hChangePercent || 0) > 5)
      .sort((a, b) => (b.volume24hChangePercent || 0) - (a.volume24hChangePercent || 0))
      .slice(0, 5);

    if (hot.length === 0) {
      bot.sendMessage(chatId, '⚡ No hot new tokens detected right now.\n\n_Market is quiet. Check back soon._');
      return;
    }

    let message = '⚡ *Hot Tokens Detected*\n_High volume + price momentum_\n\n';
    hot.forEach((token, i) => {
      const volChange = (token.volume24hChangePercent || 0).toFixed(0);
      const priceChange = (token.price24hChangePercent || 0).toFixed(1);
      const price = token.price < 0.001 ? token.price.toExponential(2) : token.price.toFixed(4);
      const liq = ((token.liquidity || 0) / 1000).toFixed(0);
      message += `*${i + 1}. ${token.symbol}*\n`;
      message += `📊 Vol: +${volChange}% | 📈 Price: +${priceChange}%\n`;
      message += `💲 $${price} | 💧 Liq: $${liq}K\n\n`;
    });
    message += '_Use /analyze SYMBOL for safety check_';
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, '❌ Error. Try again.');
  }
});

bot.onText(/\/analyze (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const symbol = match[1].toUpperCase().trim();
  bot.sendMessage(chatId, `🔍 Analyzing *${symbol}*...`, { parse_mode: 'Markdown' });
  try {
    const tokens = await getTrending();
    const token = tokens.find(t => t.symbol?.toLowerCase() === symbol.toLowerCase());
    if (!token) {
      bot.sendMessage(chatId, `❌ *${symbol}* not found in trending.\n\nTry: /pulse for available tokens`, { parse_mode: 'Markdown' });
      return;
    }

    const security = await getTokenSecurity(token.address);
    const safety = calcSafetyScore(token, security);
    const momentum = calcMomentum(token);
    const pulse = calcPulseScore(token, security);
    const isUp = (token.price24hChangePercent || 0) > 0;
    const price = token.price < 0.001 ? token.price.toExponential(3) : token.price.toFixed(4);
    const vol = ((token.volume24hUSD || 0) / 1_000_000).toFixed(2);
    const liq = ((token.liquidity || 0) / 1000).toFixed(0);
    const volChange = (token.volume24hChangePercent || 0).toFixed(0);
    const priceChange = (token.price24hChangePercent || 0).toFixed(2);
    const safetyLabel = safety >= 70 ? '🟢 SAFE' : safety >= 40 ? '🟡 CAUTION' : '🔴 RISKY';

    let securityInfo = '';
    if (security) {
      securityInfo = `\n*Security Check:*\n`;
      securityInfo += security.mintAuthority ? '⚠️ Mint authority active\n' : '✅ No mint authority\n';
      securityInfo += security.freezeAuthority ? '⚠️ Freeze authority active\n' : '✅ No freeze authority\n';
      if (security.top10HolderPercent) {
        securityInfo += security.top10HolderPercent > 80
          ? `⚠️ Top 10 holders: ${security.top10HolderPercent.toFixed(1)}%\n`
          : `✅ Top 10 holders: ${security.top10HolderPercent.toFixed(1)}%\n`;
      }
    }

    let recommendation = '';
    if (safety >= 70 && pulse >= 60) recommendation = '🚀 *STRONG* — High pulse + safe token';
    else if (safety >= 70 && isUp) recommendation = '✅ *WATCHLIST* — Safe with momentum';
    else if (safety < 40) recommendation = '🚨 *AVOID* — High risk detected';
    else recommendation = '🟡 *RESEARCH* — Moderate risk';

    const message = `
⚡ *${token.symbol} Analysis*
_${token.name}_

💲 Price: $${price}
${isUp ? '▲' : '▼'} 24h: ${isUp ? '+' : ''}${priceChange}%
💰 Volume: $${vol}M (+${volChange}%)
💧 Liquidity: $${liq}K

━━━━━━━━━━━━━
⚡ Pulse Score: *${pulse}/100*
🛡️ Safety: ${safety}/100 ${safetyLabel}
🚀 Momentum: ${momentum}/100
${securityInfo}
${recommendation}

🔗 [View on Birdeye](https://birdeye.so/token/${token.address}?chain=solana)

⚠️ _Not financial advice. Always DYOR!_
    `.trim();

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
  } catch (err) {
    bot.sendMessage(chatId, '❌ Error analyzing. Try again in 30 seconds.');
  }
});

bot.onText(/\/compare (\S+) (\S+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const symA = match[1].toUpperCase();
  const symB = match[2].toUpperCase();
  bot.sendMessage(chatId, `⚔️ Comparing *${symA}* vs *${symB}*...`, { parse_mode: 'Markdown' });
  try {
    const tokens = await getTrending();
    const tokenA = tokens.find(t => t.symbol?.toLowerCase() === symA.toLowerCase());
    const tokenB = tokens.find(t => t.symbol?.toLowerCase() === symB.toLowerCase());

    if (!tokenA || !tokenB) {
      const symbols = tokens.slice(0, 5).map(t => t.symbol).join(', ');
      const missing = !tokenA ? symA : symB;
      bot.sendMessage(chatId, `❌ *${missing}* not found.\n\nTry: /compare ${tokens[0]?.symbol} ${tokens[1]?.symbol}\nAvailable: ${symbols}`, { parse_mode: 'Markdown' });
      return;
    }

    const pulseA = calcPulseScore(tokenA, null);
    const pulseB = calcPulseScore(tokenB, null);
    const safetyA = calcSafetyScore(tokenA, null);
    const safetyB = calcSafetyScore(tokenB, null);
    const momA = calcMomentum(tokenA);
    const momB = calcMomentum(tokenB);
    const winner = pulseA > pulseB ? symA : symB;
    const w = (a, b) => a >= b ? '🏆' : '  ';

    const message = `
⚔️ *${symA} vs ${symB}*

*Pulse Score:*
${w(pulseA, pulseB)} ${symA}: ${pulseA}/100
${w(pulseB, pulseA)} ${symB}: ${pulseB}/100

*Safety:*
${w(safetyA, safetyB)} ${symA}: ${safetyA}/100
${w(safetyB, safetyA)} ${symB}: ${safetyB}/100

*Momentum:*
${w(momA, momB)} ${symA}: ${momA}/100
${w(momB, momA)} ${symB}: ${momB}/100

*24h Change:*
${w(tokenA.price24hChangePercent || 0, tokenB.price24hChangePercent || 0)} ${symA}: +${(tokenA.price24hChangePercent || 0).toFixed(1)}%
${w(tokenB.price24hChangePercent || 0, tokenA.price24hChangePercent || 0)} ${symB}: +${(tokenB.price24hChangePercent || 0).toFixed(1)}%

*Volume:*
${w(tokenA.volume24hUSD || 0, tokenB.volume24hUSD || 0)} ${symA}: $${((tokenA.volume24hUSD || 0) / 1e6).toFixed(2)}M
${w(tokenB.volume24hUSD || 0, tokenA.volume24hUSD || 0)} ${symB}: $${((tokenB.volume24hUSD || 0) / 1e6).toFixed(2)}M

🏆 *Winner: ${winner}*

⚠️ _Not financial advice. Always DYOR!_
    `.trim();

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, '❌ Error comparing. Try again.');
  }
});

bot.onText(/\/whale/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '🐋 Detecting whale activity...');
  try {
    const tokens = await getTrending();
    const whales = tokens
      .filter(t => (t.volume24hChangePercent || 0) > 300 && (t.volume24hUSD || 0) > 10000)
      .sort((a, b) => (b.volume24hChangePercent || 0) - (a.volume24hChangePercent || 0))
      .slice(0, 5);

    if (whales.length === 0) {
      bot.sendMessage(chatId, '🐋 No major whale activity right now.\n\nCheck back in 30 minutes.');
      return;
    }

    let message = '🐋 *Whale Alerts — Volume Spikes!*\n\n';
    whales.forEach((token, i) => {
      const safety = calcSafetyScore(token, null);
      const safetyLabel = safety >= 70 ? '🟢' : safety >= 40 ? '🟡' : '🔴';
      const volChange = (token.volume24hChangePercent || 0).toFixed(0);
      const price = token.price < 0.001 ? token.price.toExponential(2) : token.price.toFixed(4);
      message += `*${i + 1}. ${token.symbol}* ${safetyLabel}\n`;
      message += `📊 +${volChange}% volume spike\n`;
      message += `💲 $${price}\n\n`;
    });
    message += '_⚠️ High volume = pump OR dump — DYOR!_';
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, '❌ Error. Try again.');
  }
});

bot.onText(/\/fear/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const tokens = await getTrending();
    const { score, label, emoji } = calcFearGreed(tokens);
    const bar = '█'.repeat(Math.floor(score / 10)) + '░'.repeat(10 - Math.floor(score / 10));
    const gainers = tokens.filter(t => (t.price24hChangePercent || 0) > 0).length;

    let signal = '';
    if (score >= 75) signal = '🚨 _Extreme greed — consider taking profits_';
    else if (score >= 60) signal = '📈 _Greed — momentum strong, stay cautious_';
    else if (score >= 40) signal = '⚖️ _Neutral — research entries carefully_';
    else signal = '📉 _Fear — potential buying opportunity_';

    bot.sendMessage(chatId, `${emoji} *Solana Fear & Greed*\n\n*${label}* — ${score}/100\n\`${bar}\`\n\n🟢 Gainers: ${gainers} | 🔴 Losers: ${tokens.length - gainers}\n\n${signal}`, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, '❌ Error. Try again.');
  }
});

bot.onText(/\/market/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '📊 Building market overview...');
  try {
    const tokens = await getTrending();
    const { score, label, emoji } = calcFearGreed(tokens);
    const gainers = tokens.filter(t => (t.price24hChangePercent || 0) > 0);
    const whales = tokens.filter(t => (t.volume24hChangePercent || 0) > 300);
    const totalVol = tokens.reduce((s, t) => s + (t.volume24hUSD || 0), 0);
    const topGainer = [...tokens].sort((a, b) => (b.price24hChangePercent || 0) - (a.price24hChangePercent || 0))[0];
    const hotTokens = tokens.filter(t => (t.volume24hChangePercent || 0) > 200 && (t.price24hChangePercent || 0) > 10);

    bot.sendMessage(chatId, `
📊 *Solana Market Overview*
_${new Date().toLocaleTimeString()}_

${emoji} Sentiment: *${label}* (${score}/100)

━━━━━━━━━━━━━
🟢 Gainers: ${gainers.length} | 🔴 Losers: ${tokens.length - gainers.length}
🐋 Whale alerts: ${whales.length}
⚡ Hot tokens: ${hotTokens.length}
💰 Total Vol: $${(totalVol / 1_000_000).toFixed(1)}M

🏆 Top gainer: *${topGainer?.symbol}* +${(topGainer?.price24hChangePercent || 0).toFixed(1)}%

_/pulse for top opportunities_
_/whale for volume spikes_
    `.trim(), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, '❌ Error. Try again.');
  }
});

bot.onText(/\/top3/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '🏆 Finding top 3 opportunities...');
  try {
    const tokens = await getTrending();
    const ranked = tokens
      .map(t => ({ ...t, pulse: calcPulseScore(t, null), safety: calcSafetyScore(t, null), momentum: calcMomentum(t) }))
      .filter(t => t.safety >= 60)
      .sort((a, b) => b.pulse - a.pulse)
      .slice(0, 3);

    if (ranked.length === 0) {
      bot.sendMessage(chatId, '🏆 No strong opportunities right now.\n\n_Check /fear for market sentiment._');
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    let message = '🏆 *Top 3 Opportunities*\n_Ranked by Pulse Score_\n\n';
    ranked.forEach((token, i) => {
      const price = token.price < 0.001 ? token.price.toExponential(2) : token.price.toFixed(4);
      message += `${medals[i]} *${token.symbol}* — Pulse ${token.pulse}/100\n`;
      message += `💲 $${price} | ▲ +${(token.price24hChangePercent || 0).toFixed(1)}%\n`;
      message += `🛡️ Safety: ${token.safety}/100\n\n`;
    });
    message += '_Use /analyze SYMBOL for full breakdown_\n⚠️ _Not financial advice. DYOR!_';
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, '❌ Error. Try again.');
  }
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, `
⚡ *SolPulse Commands*

/pulse — Top tokens by Pulse Score
/new — Hot newly detected tokens
/analyze SYMBOL — Deep analysis
/compare SYM1 SYM2 — Token battle
/whale — Whale volume alerts
/fear — Fear & Greed index
/market — Market overview
/top3 — Top 3 opportunities

📢 Auto alerts: @SolPulseAlerts
🌐 Dashboard: YOUR_VERCEL_URL

_Powered by Birdeye Data API #BirdeyeAPI_
  `.trim(), { parse_mode: 'Markdown' });
});

// Auto alerts every 5 minutes
setInterval(sendChannelAlerts, 5 * 60 * 1000);
sendChannelAlerts(); // run immediately on start

console.log('⚡ SolPulse Bot is running...');
