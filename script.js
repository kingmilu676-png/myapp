const express = require('express');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { createClient } = require('@supabase/supabase-js');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const PORT = process.env.PORT || 3000;

// === SUPABASE ===
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://knafkiozaguyvemtrjfz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_Lv7-h7zaLkSnPXgYc77_ig_wp71xmJ6';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const HISTORY_LIMIT = 2000;
const POLL_MS = 3000;
const PERIOD_SECONDS = 30;
const WATCHDOG_MS = 60000;

let historyRecords = [];
let savedPredictions = {};
let lastProcessedPeriod = null;
let usingFallback = false;
let isFetching = false;
let lastAdvanceAt = Date.now();

let analyticsStats = {
    totalAnalyzed: 0,
    bigPercent: 50,
    smallPercent: 50,
    hotNumber: '-',
    overdueNumber: '-',
    winRate: 0
};

let currentRound = {
    periodNumber: 'Loading...',
    countdown: PERIOD_SECONDS,
    livePrediction: null
};

// ============================================================
// === ROBUST API FETCH (BYPASS + PROXIES + FALLBACK) ===
// ============================================================
const API_BASE = 'https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json';
const FALLBACK_NEXT = 'https://indialotteryapi.com/wp-json/wingo/v1/next?market=0.5';
const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY || '';

const PROXIES = [
    (u) => 'https://proxy.cors.dev/' + u,
    (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    (u) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
    (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
    (u) => 'https://api.cors.lol/?url=' + encodeURIComponent(u)
];

const API_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Origin': 'https://draw.ar-lottery01.com',
    'Referer': 'https://draw.ar-lottery01.com/',
    'Cache-Control': 'no-cache'
};

function httpGetText(url, redirectsLeft = 5) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: API_HEADERS, timeout: 12000 }, (res) => {
            const status = res.statusCode;
            if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
                res.resume();
                let next;
                try { next = new URL(res.headers.location, url).toString(); }
                catch (e) { return reject(e); }
                return resolve(httpGetText(next, redirectsLeft - 1));
            }
            let stream = res;
            const enc = (res.headers['content-encoding'] || '').toLowerCase();
            try {
                if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
                else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
                else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
            } catch (e) { /* ignore */ }
            let raw = '';
            stream.on('data', (c) => { raw += c.toString('utf8'); });
            stream.on('end', () => resolve({ status, contentType: res.headers['content-type'] || '', raw }));
            stream.on('error', reject);
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
    });
}

function tryParseJson(text) {
    if (!text) return null;
    let t = text.trim().replace(/^\uFEFF/, '');
    if (t.startsWith('```')) t = t.replace(/```json/gi, '').replace(/```/g, '').trim();
    try { return JSON.parse(t); } catch (e) {}
    const starts = [t.indexOf('{'), t.indexOf('[')].filter(x => x >= 0);
    if (starts.length) {
        const start = Math.min(...starts);
        const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
        if (end > start) {
            try { return JSON.parse(t.slice(start, end + 1)); } catch (e) {}
        }
    }
    return null;
}

function extractList(json) {
    if (!json) return [];
    const candidates = [
        json.data && json.data.list,
        json.data && json.data.data && json.data.data.list,
        json.list,
        json.data
    ];
    for (const c of candidates) if (Array.isArray(c)) return c;
    let found = [];
    (function walk(x) {
        if (found.length) return;
        if (Array.isArray(x)) {
            if (x.some(v => v && typeof v === 'object')) { found = x; return; }
            x.forEach(walk);
        } else if (x && typeof x === 'object') {
            Object.values(x).forEach(walk);
        }
    })(json);
    return found;
}

async function fetchRawApi() {
    const target = `${API_BASE}?ts=${Date.now()}`;
    const attempts = [];
    if (SCRAPERAPI_KEY) {
        attempts.push({ name: 'scraperapi', url: 'https://api.scraperapi.com/?api_key=' + SCRAPERAPI_KEY + '&url=' + encodeURIComponent(target) });
    }
    attempts.push({ name: 'direct', url: target });
    PROXIES.forEach((p, i) => attempts.push({ name: `proxy${i + 1}`, url: p(target) }));

    for (const att of attempts) {
        try {
            const res = await httpGetText(att.url);
            const isHtml = /text\/html/i.test(res.contentType) || res.raw.trim().startsWith('<');
            if (res.status >= 400 || isHtml) { console.log(`[API] ${att.name} fail (${res.status})`); continue; }
            const json = tryParseJson(res.raw);
            if (!json) { console.log(`[API] ${att.name} not JSON`); continue; }
            if (json.error && !(json.data && json.data.list)) { console.log(`[API] ${att.name} err json`); continue; }
            console.log(`[API] ${att.name} OK`);
            return json;
        } catch (e) {
            console.log(`[API] ${att.name} error: ${e.message}`);
        }
    }
    return null;
}

async function fetchFallback() {
    try {
        const nx = tryParseJson((await httpGetText(FALLBACK_NEXT)).raw);
        if (currentRound.periodNumber === 'Loading...') {
            if (historyRecords.length > 0) {
                try { currentRound.periodNumber = (BigInt(historyRecords[0].issue) + 1n).toString(); } catch (e) {}
            }
            if (currentRound.periodNumber === 'Loading...' && nx && nx.period) {
                currentRound.periodNumber = String(nx.period).replace('-', '');
            }
        }
        if (nx && typeof nx.remain === 'number' && Math.abs(nx.remain - currentRound.countdown) >= 2) {
            currentRound.countdown = nx.remain;
        }
        return true;
    } catch (e) {
        console.log('[API] fallback error:', e.message);
        return false;
    }
}
// ============================================================

// ============================================================
// === HELPERS ===
// ============================================================
function colorFor(n) {
    if (n === 0 || n === 5) return 'Violet';
    return n % 2 === 0 ? 'Red' : 'Green';
}
function typeFor(n) { return n >= 5 ? 'Big' : 'Small'; }

function sortDesc() {
    historyRecords.sort((a, b) => {
        try { return BigInt(b.issue) > BigInt(a.issue) ? 1 : (BigInt(b.issue) < BigInt(a.issue) ? -1 : 0); }
        catch (e) { return b.issue.localeCompare(a.issue); }
    });
}

function hashPeriod(p) {
    const s = String(p);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
    return h;
}

// ============================================================
// === SUPABASE PERSIST ===
// ============================================================
async function persistPrediction(period, num) {
    const { error } = await supabase.from('test_results').upsert({
        period_number: period,
        pred_num: num,
        status: 'PENDING'
    }, { onConflict: 'period_number' });
    if (error) console.error('persistPrediction:', error.message);
}

async function persistResult(period, num, predNum, status) {
    const { error } = await supabase.from('test_results').upsert({
        period_number: period,
        results: String(num),
        pred_num: predNum,
        status: status
    }, { onConflict: 'period_number' });
    if (error) console.error('persistResult:', error.message);
}

async function loadHistoryFromSupabase() {
    try {
        const { data, error } = await supabase
            .from('test_results')
            .select('*')
            .order('period_number', { ascending: false })
            .limit(HISTORY_LIMIT);

        if (error) { console.error('Supabase Load Error:', error.message); return; }
        if (!data || !data.length) return;

        historyRecords = [];
        for (const item of data) {
            const period = String(item.period_number);
            if (item.pred_num !== null && item.pred_num !== undefined) {
                savedPredictions[period] = item.pred_num;
            }
            const raw = item.results;
            if (raw === null || raw === undefined || raw === '') continue;
            const num = parseInt(raw);
            if (isNaN(num)) continue;
            historyRecords.push({
                issue: period,
                number: num,
                type: typeFor(num),
                color: colorFor(num),
                predNum: item.pred_num ?? null,
                status: item.status || 'PENDING'
            });
        }
        sortDesc();
        if (historyRecords.length > HISTORY_LIMIT) historyRecords.length = HISTORY_LIMIT;
        console.log(`Loaded ${historyRecords.length} real records from Supabase.`);
        runDeepDataAnalysis();
    } catch (e) {
        console.log('Load exception:', e.message);
    }
}

// ============================================================
// === ANALYSIS (NULL-safe) ===
// ============================================================
function runDeepDataAnalysis() {
    if (!historyRecords.length) return;
    let total = 0, bigCount = 0, smallCount = 0;
    let numFreq = Array(10).fill(0);
    let totalWins = 0, evaluated = 0;

    historyRecords.forEach(item => {
        if (item.number === null || item.number === undefined) return;
        total++;
        if (item.type === 'Big') bigCount++; else smallCount++;
        if (item.number >= 0 && item.number <= 9) numFreq[item.number]++;
        if (item.status === 'WIN') { totalWins++; evaluated++; }
        else if (item.status === 'LOSS') { evaluated++; }
    });
    if (!total) return;

    let maxFreq = -1, minFreq = Infinity, hotNum = 0, dueNum = 0;
    numFreq.forEach((freq, num) => {
        if (freq > maxFreq) { maxFreq = freq; hotNum = num; }
        if (freq < minFreq) { minFreq = freq; dueNum = num; }
    });

    analyticsStats = {
        totalAnalyzed: total,
        bigPercent: ((bigCount / total) * 100).toFixed(1),
        smallPercent: ((smallCount / total) * 100).toFixed(1),
        hotNumber: hotNum,
        overdueNumber: dueNum,
        winRate: evaluated > 0 ? ((totalWins / evaluated) * 100).toFixed(1) : '0.0'
    };
}

// ============================================================
// === PATTERN-BASED PREDICTION ENGINE ===
// ============================================================
function toChrono(history) { return history.slice().reverse(); }

function patternNextOutcome(history) {
    const chrono = toChrono(history);
    if (chrono.length < 15) return { big: 0.5, small: 0.5, matches: 0, pattern: '' };

    const seq = chrono.map(h => (h.type === 'Big' ? 'B' : 'S'));
    let bigW = 0, smallW = 0, total = 0, bestPattern = '';

    for (let k = 6; k >= 2; k--) {
        if (seq.length <= k + 1) continue;
        const tail = seq.slice(-k).join('');
        let b = 0, s = 0;
        for (let i = 0; i + k < seq.length; i++) {
            if (seq.slice(i, i + k).join('') === tail) {
                if (seq[i + k] === 'B') b++; else s++;
            }
        }
        if (b + s === 0) continue;
        const w = k;
        bigW += b * w;
        smallW += s * w;
        total += b + s;
        if (!bestPattern) bestPattern = tail;
    }

    if (total === 0) return { big: 0.5, small: 0.5, matches: 0, pattern: '' };

    let big = bigW / (bigW + smallW);

    const longW = history.slice(0, Math.min(500, history.length));
    let lb = 0, ls = 0;
    longW.forEach(h => h.type === 'Big' ? lb++ : ls++);
    const baseBig = (lb + ls) ? lb / (lb + ls) : 0.5;
    big = big * 0.8 + baseBig * 0.2;

    big = Math.max(0.2, Math.min(0.8, big));
    return { big, small: 1 - big, matches: total, pattern: bestPattern };
}

function pickNumberInRange(low, high, history, periodStr) {
    const chrono = toChrono(history);
    const nums = chrono.map(h => h.number).filter(n => typeof n === 'number' && !isNaN(n));
    const rangeSize = high - low + 1;
    if (!nums.length) return low + (hashPeriod(periodStr) % rangeSize);

    const win = nums.slice(-300);
    const last = win[win.length - 1];

    const freq = {}, markov = {}, lastSeen = {};
    for (let n = low; n <= high; n++) { freq[n] = 0; markov[n] = 0; lastSeen[n] = -1; }

    for (let i = 0; i < win.length; i++) {
        const n = win[i];
        if (n < low || n > high) continue;
        freq[n]++;
        lastSeen[n] = i;
        if (i > 0 && win[i - 1] === last) markov[n]++;
    }

    const maxFreq = Math.max(1, ...Object.values(freq));
    const maxMarkov = Math.max(1, ...Object.values(markov));
    const len = win.length;
    const jitter = hashPeriod(periodStr);

    let best = low, bestScore = -Infinity;
    for (let n = low; n <= high; n++) {
        const overdue = lastSeen[n] === -1 ? len : (len - 1 - lastSeen[n]);
        const fN = freq[n] / maxFreq;
        const mN = markov[n] / maxMarkov;
        const oN = overdue / len;
        let score = mN * 0.45 + fN * 0.30 + oN * 0.25;
        if (n === last) score -= 0.12;
        score += ((jitter + n * 7) % 100) / 10000;
        if (score > bestScore) { bestScore = score; best = n; }
    }
    return best;
}

function generatePrediction(periodStr, history) {
    const p = patternNextOutcome(history);
    const goBig = p.big >= p.small;
    const low = goBig ? 5 : 0;
    const high = goBig ? 9 : 4;
    const num = pickNumberInRange(low, high, history, periodStr);

    return {
        suggestedNum: num,
        suggestedType: goBig ? 'Big' : 'Small',
        suggestedColor: colorFor(num),
        bigChance: (p.big * 100).toFixed(1),
        smallChance: (p.small * 100).toFixed(1),
        pattern: p.pattern,
        sample: p.matches
    };
}

function setPredictionFor(period) {
    if (savedPredictions[period] === undefined) {
        let np = generatePrediction(period, historyRecords);

        // lagatar same number avoid
        const prevP = savedPredictions[lastProcessedPeriod];
        if (prevP !== undefined && np.suggestedNum === prevP) {
            const low = np.suggestedType === 'Big' ? 5 : 0;
            const high = np.suggestedType === 'Big' ? 9 : 4;
            let alt = np.suggestedNum + 1;
            if (alt > high) alt = low;
            np = { ...np, suggestedNum: alt, suggestedColor: colorFor(alt) };
        }

        currentRound.livePrediction = np;
        savedPredictions[period] = np.suggestedNum;
        persistPrediction(period, np.suggestedNum);
    } else {
        const p = savedPredictions[period];
        const prev = currentRound.livePrediction || {};
        currentRound.livePrediction = {
            suggestedNum: p,
            suggestedType: typeFor(p),
            suggestedColor: colorFor(p),
            bigChance: prev.bigChance ?? '-',
            smallChance: prev.smallChance ?? '-',
            pattern: prev.pattern ?? '',
            sample: prev.sample ?? 0
        };
    }
}

function advancePeriod() {
    let base = String(currentRound.periodNumber);
    if (!/^\d+$/.test(base)) {
        if (historyRecords.length) {
            try { base = (BigInt(historyRecords[0].issue) + 1n).toString(); } catch (e) { return; }
        } else {
            return;
        }
    }
    try {
        currentRound.periodNumber = (BigInt(base) + 1n).toString();
    } catch (e) { return; }
    currentRound.countdown = PERIOD_SECONDS;
    setPredictionFor(currentRound.periodNumber);
}

// ============================================================
// === FRONTEND ===
// ============================================================
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Facing AI Pattern Matcher Tool - Milu</title>
<style>
body { font-family: Arial, sans-serif; background:#121212; color:#fff; text-align:center; padding:15px; margin:0; }
.container { max-width:460px; margin:15px auto; background:#1e1e1e; padding:20px; border-radius:12px; box-shadow:0 6px 15px rgba(0,0,0,.6); }
h2 { color:#00e676; margin-bottom:15px; font-size:22px; }
.timer-box { font-size:24px; font-weight:bold; color:#ff9800; margin:10px 0; background:#2a2a2a; padding:8px; border-radius:8px; }
.period-box { font-size:16px; color:#b0bec5; margin-bottom:10px; }
.analytics-card { background:#1a232a; border:1px solid #00b0ff; border-radius:8px; padding:10px; margin:12px 0; font-size:13px; text-align:left; }
.analytics-card h4 { margin:0 0 8px 0; color:#00b0ff; text-align:center; }
.stats-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.stat-item { background:#252d35; padding:6px 8px; border-radius:4px; }
.prediction-card { background:#252525; border:2px solid #00e676; padding:15px; border-radius:8px; margin:15px 0; }
.prediction-card h3 { margin:0 0 8px 0; color:#00e676; font-size:16px; }
.pred-num-box { font-size:40px; font-weight:bold; color:#00e676; margin:5px 0; }
.pred-details { font-size:15px; color:#fff; font-weight:bold; }
.chance-bar { height:10px; background:#333; border-radius:5px; margin:8px 0; overflow:hidden; display:flex; }
.chance-big { background:#4caf50; }
.chance-small { background:#ff5252; }
.history-container { margin-top:20px; text-align:left; background:#252525; padding:12px; border-radius:8px; max-height:250px; overflow-y:auto; border:1px solid #333; }
.history-container h3 { margin-top:0; font-size:15px; color:#90caf9; border-bottom:1px solid #444; padding-bottom:6px; }
.history-item { padding:8px 6px; border-bottom:1px solid #333; font-size:12px; display:flex; justify-content:space-between; align-items:center; }
.badge-big { background:#4caf50; color:#fff; padding:2px 5px; border-radius:3px; }
.badge-small { background:#ff5252; color:#fff; padding:2px 5px; border-radius:3px; }
.badge-violet { background:#9c27b0; color:#fff; padding:2px 5px; border-radius:3px; }
.status-win { background:#2e7d32; color:#fff; padding:2px 6px; border-radius:4px; font-weight:bold; }
.status-loss { background:#c62828; color:#fff; padding:2px 6px; border-radius:4px; font-weight:bold; }
</style>
</head>
<body>
<div class="container">
    <h2>Facing AI Pattern Tool - Milu</h2>
    <div class="period-box">Target Period: <span id="periodNumber" style="color:#fff;font-weight:bold;">Loading...</span></div>
    <div class="timer-box">Time Left: <span id="timer">30</span>s</div>

    <div class="analytics-card">
        <h4>2000 Records Deep Analysis</h4>
        <div class="stats-grid">
            <div class="stat-item">Analyzed: <b id="statTotal" style="color:#00e676;">0</b></div>
            <div class="stat-item">Win Rate: <b id="statWinRate" style="color:#ffb74d;">0%</b></div>
            <div class="stat-item">Big/Small: <b id="statRatio">0% / 0%</b></div>
            <div class="stat-item">Hot/Due: <b id="statHotDue" style="color:#29b6f6;">- / -</b></div>
        </div>
    </div>

    <div class="prediction-card">
        <h3>Next Expected Number</h3>
        <div class="pred-num-box" id="predNum">-</div>
        <div class="pred-details">
            Type: <span id="predType" style="color:#00b0ff;">-</span> | Color: <span id="predColor">-</span>
        </div>
        <div style="font-size:12px;color:#aaa;margin-top:8px;">
            Big <b id="bigPct" style="color:#4caf50;">0%</b> / Small <b id="smallPct" style="color:#ff5252;">0%</b>
        </div>
        <div class="chance-bar"><div class="chance-big" id="bigBar" style="width:50%"></div><div class="chance-small" id="smallBar" style="width:50%"></div></div>
        <div style="font-size:11px;color:#888;margin-top:6px;">
            Pattern: <b id="predPattern" style="color:#90caf9;">-</b> | Sample: <b id="predSample">0</b> hits
        </div>
    </div>

    <div class="history-container">
        <h3>Live History & Win/Loss Status</h3>
        <div id="historyList">Loading history...</div>
    </div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();

socket.on('timerUpdate', (data) => {
    if (data.periodNumber && data.periodNumber !== 'Loading...') {
        document.getElementById('periodNumber').innerText = data.periodNumber;
    }
    if (data.countdown !== undefined) {
        document.getElementById('timer').innerText = data.countdown;
    }
    if (data.analytics) {
        document.getElementById('statTotal').innerText = data.analytics.totalAnalyzed;
        document.getElementById('statWinRate').innerText = data.analytics.winRate + '%';
        document.getElementById('statRatio').innerText = data.analytics.bigPercent + '% / ' + data.analytics.smallPercent + '%';
        document.getElementById('statHotDue').innerText = 'Hot:' + data.analytics.hotNumber + ' | Due:' + data.analytics.overdueNumber;
    }
    if (data.prediction) {
        document.getElementById('predNum').innerText = data.prediction.suggestedNum;
        document.getElementById('predType').innerText = data.prediction.suggestedType;
        const pc = document.getElementById('predColor');
        pc.innerText = data.prediction.suggestedColor;
        pc.style.color = data.prediction.suggestedColor === 'Red' ? '#ff5252'
                        : data.prediction.suggestedColor === 'Green' ? '#4caf50' : '#ba68c8';
        const bp = parseFloat(data.prediction.bigChance) || 0;
        document.getElementById('bigPct').innerText = data.prediction.bigChance + '%';
        document.getElementById('smallPct').innerText = data.prediction.smallChance + '%';
        document.getElementById('bigBar').style.width = bp + '%';
        document.getElementById('smallBar').style.width = (100 - bp) + '%';
        document.getElementById('predPattern').innerText = data.prediction.pattern || '-';
        document.getElementById('predSample').innerText = data.prediction.sample || 0;
    }
    if (data.history) {
        let html = '';
        data.history.forEach(item => {
            const badgeClass = item.color === 'Violet' ? 'badge-violet' : (item.type === 'Big' ? 'badge-big' : 'badge-small');
            let statusHtml = '<span style="color:#aaa;">Pending</span>';
            if (item.status === 'WIN') statusHtml = '<span class="status-win">WIN</span>';
            else if (item.status === 'LOSS') statusHtml = '<span class="status-loss">LOSS</span>';
            html += '<div class="history-item">' +
                '<span><b>' + String(item.issue).slice(-4) + '</b></span>' +
                '<span>Res: <b>' + item.number + '</b> <span class="' + badgeClass + '">' + item.type + '</span></span>' +
                '<span>Pred: ' + (item.predNum ?? '-') + '</span>' +
                '<span>' + statusHtml + '</span></div>';
        });
        document.getElementById('historyList').innerHTML = html;
    }
});
</script>
</body>
</html>`);
});

// ============================================================
// === MAIN SYNC ===
// ============================================================
async function fetchDamanApiData() {
    if (isFetching) return;
    isFetching = true;
    try {
        const json = await fetchRawApi();

        if (!json) {
            usingFallback = true;
            await fetchFallback();
            return;
        }
        usingFallback = false;

        const listArray = extractList(json);
        if (Array.isArray(listArray) && listArray.length > 0) {
            for (const item of listArray) {
                const iss = String(item.issueNumber || item.issue || '');
                const num = parseInt(item.number ?? item.winningNumber ?? item.price ?? item.sum);
                if (!iss || isNaN(num)) continue;

                const type = typeFor(num);
                const color = colorFor(num);
                const existing = historyRecords.find(h => h.issue === iss);
                const pNum = savedPredictions[iss] !== undefined ? savedPredictions[iss] : null;
                const status = pNum !== null ? (pNum === num ? 'WIN' : 'LOSS') : 'PENDING';

                if (!existing) {
                    historyRecords.push({ issue: iss, number: num, type, color, predNum: pNum, status });
                    await persistResult(iss, num, pNum, status);
                } else {
                    existing.number = num;
                    existing.type = type;
                    existing.color = color;
                    if (pNum !== null) {
                        existing.predNum = pNum;
                        existing.status = (pNum === num) ? 'WIN' : 'LOSS';
                    }
                    await persistResult(iss, num, existing.predNum, existing.status);
                }
            }
        }

        sortDesc();
        if (historyRecords.length > HISTORY_LIMIT) historyRecords.length = HISTORY_LIMIT;
        runDeepDataAnalysis();

        if (historyRecords.length > 0) {
            let nextIssueStr = null;
            try { nextIssueStr = (BigInt(historyRecords[0].issue) + 1n).toString(); } catch (e) {}
            if (nextIssueStr && nextIssueStr !== lastProcessedPeriod) {
                lastProcessedPeriod = nextIssueStr;
                currentRound.periodNumber = nextIssueStr;
                currentRound.countdown = PERIOD_SECONDS;
                lastAdvanceAt = Date.now();
                setPredictionFor(nextIssueStr);
            }
        }
    } catch (e) {
        console.error('API Parse Error:', e.message);
    } finally {
        isFetching = false;
    }
}

function startCountdownLoop() {
    setInterval(() => {
        if (currentRound.countdown > 0) {
            currentRound.countdown--;
        } else {
            advancePeriod();
            lastAdvanceAt = Date.now();
        }

        // WATCHDOG: 60s tak period na badhe to force advance
        if (Date.now() - lastAdvanceAt > WATCHDOG_MS) {
            advancePeriod();
            lastAdvanceAt = Date.now();
        }

        io.emit('timerUpdate', {
            periodNumber: currentRound.periodNumber,
            countdown: currentRound.countdown,
            prediction: currentRound.livePrediction,
            analytics: analyticsStats,
            history: historyRecords.slice(0, 40)
        });
    }, 1000);
}

function startPollLoop() {
    setInterval(fetchDamanApiData, POLL_MS);
}

loadHistoryFromSupabase()
    .catch(e => console.error('Load failed:', e))
    .finally(() => {
        server.listen(PORT, () => {
            console.log(`Facing AI Server on http://localhost:${PORT} | pattern prediction ON`);
            fetchDamanApiData();
            startCountdownLoop();
            startPollLoop();
        });
    });
