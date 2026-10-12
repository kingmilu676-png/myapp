const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// === SUPABASE CONFIGURATION ===
const SUPABASE_URL = 'https://knafkiozaguyvemtrjfz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Lv7-h7zaLkSnPXgYc77_ig_wp71xmJ6';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const HISTORY_LIMIT = 2000;

let historyRecords = [];
let savedPredictions = {};
let lastProcessedPeriod = null;

// Accurate IST Wingo 30S Period Generator (Never fails or drifts)
function getAccurateWingoPeriod() {
    const now = new Date();
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const istTime = new Date(utcTime + (3600000 * 5.5)); // IST +5:30
    
    const YYYY = istTime.getFullYear();
    const MM = String(istTime.getMonth() + 1).padStart(2, '0');
    const DD = String(istTime.getDate()).padStart(2, '0');
    
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    const seconds = istTime.getSeconds();
    
    const totalDaySeconds = (hours * 3600) + (minutes * 60) + seconds;
    const periodIndex = Math.floor(totalDaySeconds / 30) + 1;
    
    const paddedIndex = String(periodIndex).padStart(4, '0');
    return `${YYYY}${MM}${DD}1000${paddedIndex}`;
}

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let analyticsStats = {
    totalAnalyzed: 0,
    bigPercent: 50,
    smallPercent: 50,
    hotNumber: 5,
    overdueNumber: 2,
    winRate: "0.0"
};

async function loadHistoryFromSupabase() {
    try {
        const { data, error } = await supabase
            .from('test_results')
            .select('*')
            .order('period_number', { ascending: false })
            .limit(HISTORY_LIMIT);

        if (error) {
            console.error("Supabase Load Error:", error.message);
            return;
        }

        if (data && data.length > 0) {
            historyRecords = data.map(item => ({
                issue: String(item.period_number),
                number: parseInt(item.results ?? 0),
                type: parseInt(item.results ?? 0) >= 5 ? "Big" : "Small",
                color: parseInt(item.results ?? 0) % 2 === 0 ? "Red" : "Green",
                predNum: item.pred_num ?? null,
                status: item.status || "PENDING"
            }));
            console.log(`Loaded ${historyRecords.length} records from Supabase.`);
            runDeepDataAnalysis();
        }
    } catch (e) {
        console.log("Load exception:", e);
    }
}

function runDeepDataAnalysis() {
    if (!historyRecords || historyRecords.length === 0) return;

    let total = historyRecords.length;
    let bigCount = 0;
    let smallCount = 0;
    let numFreq = Array(10).fill(0);
    let totalWins = 0;
    let evaluatedPreds = 0;

    historyRecords.forEach(item => {
        if (item.type === "Big") bigCount++;
        else smallCount++;

        if (item.number >= 0 && item.number <= 9) {
            numFreq[item.number]++;
        }

        if (item.status === "WIN") {
            totalWins++;
            evaluatedPreds++;
        } else if (item.status === "LOSS") {
            evaluatedPreds++;
        }
    });

    let maxFreq = -1;
    let minFreq = Infinity;
    let hotNum = 5;
    let overdueNum = 2;

    numFreq.forEach((freq, num) => {
        if (freq > maxFreq) {
            maxFreq = freq;
            hotNum = num;
        }
        if (freq < minFreq) {
            minFreq = freq;
            overdueNum = num;
        }
    });

    analyticsStats = {
        totalAnalyzed: total,
        bigPercent: ((bigCount / total) * 100).toFixed(1),
        smallPercent: ((smallCount / total) * 100).toFixed(1),
        hotNumber: hotNum,
        overdueNumber: overdueNum,
        winRate: evaluatedPreds > 0 ? ((totalWins / evaluatedPreds) * 100).toFixed(1) : "0.0"
    };
}

let currentRound = {
    periodNumber: getAccurateWingoPeriod(),
    countdown: 30 - (Math.floor(Date.now() / 1000) % 30),
    livePrediction: { suggestedNum: 7, suggestedType: "Big", suggestedColor: "Green" }
};

function generateProbabilityPattern(periodStr, history) {
    if (!history || history.length < 3) return { suggestedNum: 7, suggestedType: "Big", suggestedColor: "Green" };

    let last1 = history[0].number;
    let last2 = history[1].number;
    let last3 = history[2].number;

    let p1 = parseInt(periodStr.slice(-1)) || 0;
    let p2 = parseInt(periodStr.slice(-2, -1)) || 0;

    let hotBonus = typeof analyticsStats.hotNumber === 'number' ? analyticsStats.hotNumber : 5;

    let calculatedNum = (last1 * 3 + last2 * 2 + last3 + (p1 * 7) + p2 + hotBonus) % 10;
    if (calculatedNum < 0) calculatedNum += 10;

    if (calculatedNum === last1) {
        calculatedNum = (last1 + 3) % 10;
    }

    let type = calculatedNum >= 5 ? "Big" : "Small";
    let color = calculatedNum % 2 === 0 ? "Red" : "Green";

    return { suggestedNum: calculatedNum, suggestedType: type, suggestedColor: color };
}

// === OFFICIAL DAMAN API INTEGRATION WITH FALLBACK SYNC ===
async function fetchDamanApiData() {
    const timestamp = Date.now();
    const url = `https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json?ts=${timestamp}`;

    const req = https.get(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache'
        },
        timeout: 4000
    }, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', async () => {
            try {
                if (rawData.trim().startsWith('<')) {
                    return;
                }

                const json = JSON.parse(rawData);
                const dataObj = json.data || json;
                let listArray = dataObj.list || dataObj.data?.list || json.list || [];

                if (Array.isArray(listArray) && listArray.length > 0) {
                    for (let item of listArray) {
                        const iss = String(item.issueNumber || item.issue || '');
                        const num = parseInt(item.number ?? item.winningNumber ?? item.price ?? item.sum);

                        if (iss && !isNaN(num)) {
                            const type = num >= 5 ? "Big" : "Small";
                            const color = num % 2 === 0 ? "Red" : "Green";

                            let existing = historyRecords.find(h => h.issue === iss);
                            let pNum = savedPredictions[iss] !== undefined ? savedPredictions[iss] : null;
                            let status = pNum !== null ? (pNum === num ? "WIN" : "LOSS") : "PENDING";

                            if (!existing) {
                                historyRecords.push({
                                    issue: iss,
                                    number: num,
                                    type: type,
                                    color: color,
                                    predNum: pNum,
                                    status: status
                                });

                                await supabase.from('test_results').upsert({
                                    period_number: iss,
                                    results: String(num),
                                    pred_num: pNum,
                                    status: status
                                }, { onConflict: ['period_number'] });

                            } else {
                                existing.number = num;
                                existing.type = type;
                                existing.color = color;
                                if (pNum !== null) {
                                    existing.predNum = pNum;
                                    existing.status = (pNum === num) ? "WIN" : "LOSS";
                                }

                                await supabase.from('test_results').upsert({
                                    period_number: iss,
                                    results: String(num),
                                    pred_num: existing.predNum,
                                    status: existing.status
                                }, { onConflict: ['period_number'] });
                            }
                        }
                    }
                }

                historyRecords.sort((a, b) => b.issue.localeCompare(a.issue));
                if (historyRecords.length > HISTORY_LIMIT) historyRecords.length = HISTORY_LIMIT;

                runDeepDataAnalysis();
            } catch (e) {
                // Ignore parsing errors gracefully
            }
        });
    });

    req.on('error', (err) => {});
    req.on('timeout', () => { req.destroy(); });
}

function startSyncLoop() {
    setInterval(() => {
        fetchDamanApiData();

        // Always use accurate IST-based calculation for zero drift and perfect alignment
        let exactPeriod = getAccurateWingoPeriod();
        let nowSec = Math.floor(Date.now() / 1000);
        let remainingSec = 30 - (nowSec % 30);

        currentRound.periodNumber = exactPeriod;
        currentRound.countdown = remainingSec;

        if (savedPredictions[exactPeriod] === undefined) {
            let newPred = generateProbabilityPattern(exactPeriod, historyRecords);
            currentRound.livePrediction = newPred;
            savedPredictions[exactPeriod] = newPred.suggestedNum;
        } else {
            let pNum = savedPredictions[exactPeriod];
            let targetType = pNum >= 5 ? "Big" : "Small";
            let color = pNum % 2 === 0 ? "Red" : "Green";
            currentRound.livePrediction = { suggestedNum: pNum, suggestedType: targetType, suggestedColor: color };
        }

        io.emit('timerUpdate', {
            periodNumber: currentRound.periodNumber,
            countdown: currentRound.countdown,
            prediction: currentRound.livePrediction,
            analytics: analyticsStats,
            history: historyRecords
        });
    }, 1000);
}

io.on('connection', (socket) => {
    socket.emit('timerUpdate', {
        periodNumber: currentRound.periodNumber,
        countdown: currentRound.countdown,
        prediction: currentRound.livePrediction,
        analytics: analyticsStats,
        history: historyRecords
    });
});

loadHistoryFromSupabase().then(() => {
    server.listen(PORT, () => {
        console.log(`Facing AI Server running at http://localhost:${PORT}`);
        startSyncLoop();
    });
});
