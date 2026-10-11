const express = require('express');
const http = require('http');
const https = require('https');
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

// === 2000 RECORDS LIMIT SETTING ===
const HISTORY_LIMIT = 2000;

let historyRecords = [];
let savedPredictions = {};
let lastProcessedPeriod = null;

// Analytics Stats Object
let analyticsStats = {
    totalAnalyzed: 0,
    bigPercent: 50,
    smallPercent: 50,
    hotNumber: "-",
    overdueNumber: "-",
    winRate: 0
};

// Supabase se 2000 data load karein aur Analyze karein
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

// === 2000 RECORDS ANALYSIS ENGINE ===
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
    let hotNum = 0;
    let overdueNum = 0;

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

// Frontend HTML Interface
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Facing AI Pattern Matcher Tool - Milu</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                background-color: #121212;
                color: #ffffff;
                text-align: center;
                padding: 15px;
                margin: 0;
            }
            .container {
                max-width: 460px;
                margin: 15px auto;
                background: #1e1e1e;
                padding: 20px;
                border-radius: 12px;
                box-shadow: 0 6px 15px rgba(0,0,0,0.6);
            }
            h2 { color: #00e676; margin-bottom: 15px; font-size: 22px; }
            .timer-box {
                font-size: 24px;
                font-weight: bold;
                color: #ff9800;
                margin: 10px 0;
                background: #2a2a2a;
                padding: 8px;
                border-radius: 8px;
            }
            .period-box {
                font-size: 16px;
                color: #b0bec5;
                margin-bottom: 10px;
            }
            .analytics-card {
                background: #1a232a;
                border: 1px solid #00b0ff;
                border-radius: 8px;
                padding: 10px;
                margin: 12px 0;
                font-size: 13px;
                text-align: left;
            }
            .analytics-card h4 {
                margin: 0 0 8px 0;
                color: #00b0ff;
                text-align: center;
            }
            .stats-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
            }
            .stat-item {
                background: #252d35;
                padding: 6px 8px;
                border-radius: 4px;
            }
            .prediction-card {
                background: #252525;
                border: 2px solid #00e676;
                padding: 15px;
                border-radius: 8px;
                margin: 15px 0;
            }
            .prediction-card h3 { margin: 0 0 8px 0; color: #00e676; font-size: 16px; }
            .pred-num-box {
                font-size: 40px;
                font-weight: bold;
                color: #00e676;
                margin: 5px 0;
            }
            .pred-details {
                font-size: 15px;
                color: #ffffff;
                font-weight: bold;
            }
            .history-container {
                margin-top: 20px;
                text-align: left;
                background: #252525;
                padding: 12px;
                border-radius: 8px;
                max-height: 250px;
                overflow-y: auto;
                border: 1px solid #333;
            }
            .history-container h3 {
                margin-top: 0;
                font-size: 15px;
                color: #90caf9;
                border-bottom: 1px solid #444;
                padding-bottom: 6px;
            }
            .history-item {
                padding: 8px 6px;
                border-bottom: 1px solid #333;
                font-size: 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .badge-big { background: #4caf50; color: white; padding: 2px 5px; border-radius: 3px; }
            .badge-small { background: #ff5252; color: white; padding: 2px 5px; border-radius: 3px; }
            .status-win { background: #2e7d32; color: #fff; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
            .status-loss { background: #c62828; color: #fff; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
        </style>
    </head>
    <body>

        <div class="container">
            <h2>Facing AI Pattern Tool - Milu</h2>
            <div class="period-box">Target Period: <span id="periodNumber" style="color: #fff; font-weight: bold;">Loading...</span></div>
            <div class="timer-box">Time Left: <span id="timer">30</span>s</div>

            <!-- 2000 Records Data Analytics Card -->
            <div class="analytics-card">
                <h4>2000 Records Deep Analysis</h4>
                <div class="stats-grid">
                    <div class="stat-item">Analyzed: <b id="statTotal" style="color:#00e676;">0</b></div>
                    <div class="stat-item">Win Rate: <b id="statWinRate" style="color:#ffb74d;">0%</b></div>
                    <div class="stat-item">Big/Small: <b id="statRatio">0% / 0%</b></div>
                    <div class="stat-item">Hot/Due: <b id="statHotDue" style="color:#29b6f6;">- / -</b></div>
                </div>
            </div>

            <!-- Prediction Display Card (Shows the exact suggested number & details) -->
            <div class="prediction-card">
                <h3>Next Expected Number Prediction</h3>
                <div class="pred-num-box" id="predNum">-</div>
                <div class="pred-details">
                    Type: <span id="predType" style="color:#00b0ff;">-</span> | Color: <span id="predColor">-</span>
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
                if (data.periodNumber && data.periodNumber !== "Loading...") {
                    document.getElementById('periodNumber').innerText = data.periodNumber;
                }
                if (data.countdown !== undefined) {
                    document.getElementById('timer').innerText = data.countdown;
                }

                // Update Analytics Stats
                if (data.analytics) {
                    document.getElementById('statTotal').innerText = data.analytics.totalAnalyzed;
                    document.getElementById('statWinRate').innerText = data.analytics.winRate + '%';
                    document.getElementById('statRatio').innerText = data.analytics.bigPercent + '% / ' + data.analytics.smallPercent + '%';
                    document.getElementById('statHotDue').innerText = 'Hot:' + data.analytics.hotNumber + ' | Due:' + data.analytics.overdueNumber;
                }

                // Display Expected Prediction Number on Screen
                if (data.prediction) {
                    document.getElementById('predNum').innerText = data.prediction.suggestedNum;
                    document.getElementById('predType').innerText = data.prediction.suggestedType;
                    document.getElementById('predColor').innerText = data.prediction.suggestedColor;
                    document.getElementById('predColor').style.color = data.prediction.suggestedColor === 'Red' ? '#ff5252' : '#4caf50';
                }

                if (data.history && data.history.length > 0) {
                    let html = '';
                    data.history.forEach(item => {
                        const badgeClass = item.type === 'Big' ? 'badge-big' : 'badge-small';
                        let statusHtml = '<span style="color:#aaa;">Pending</span>';
                        if (item.status === 'WIN') {
                            statusHtml = '<span class="status-win">WIN</span>';
                        } else if (item.status === 'LOSS') {
                            statusHtml = '<span class="status-loss">LOSS</span>';
                        }
                        
                        html += \`<div class="history-item">
                            <span><b>\${String(item.issue).slice(-4)}</b></span>
                            <span>Res: <b>\${item.number}</b> <span class="\${badgeClass}">\${item.type}</span></span>
                            <span>Pred: \${item.predNum ?? '-'}</span>
                            <span>\${statusHtml}</span>
                        </div>\`;
                    });
                    document.getElementById('historyList').innerHTML = html;
                }
            });
        </script>
    </body>
    </html>
    `);
});

let currentRound = {
    periodNumber: "Loading...",
    countdown: 30,
    livePrediction: { suggestedNum: 6, suggestedType: "Big", suggestedColor: "Green" }
};

// Smart Prediction Logic
function generateProbabilityPattern(periodStr, history) {
    if (!history || history.length < 3) return { suggestedNum: 6, suggestedType: "Big", suggestedColor: "Green" };

    let last1 = history[0].number;
    let last2 = history[1].number;
    let last3 = history[2].number;

    let p1 = parseInt(periodStr.slice(-1)) || 0;
    let p2 = parseInt(periodStr.slice(-2, -1)) || 0;

    let hotBonus = typeof analyticsStats.hotNumber === 'number' ? analyticsStats.hotNumber : 5;

    let calculatedNum = (last1 * 3 + last2 * 2 + last3 + (p1 * 7) + p2 + hotBonus) % 10;
    if (calculatedNum < 0) calculatedNum += 10;

    // Strict Repeat Blocker
    if (calculatedNum === last1) {
        calculatedNum = (last1 + 3) % 10;
    }

    let type = calculatedNum >= 5 ? "Big" : "Small";
    let color = calculatedNum % 2 === 0 ? "Red" : "Green";

    return { suggestedNum: calculatedNum, suggestedType: type, suggestedColor: color };
}

// Fetch Official API & Sync with Supabase
async function fetchDamanApiData() {
    const timestamp = Date.now();
    const url = `https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json?ts=${timestamp}`;

    https.get(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
        }
    }, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', async () => {
            try {
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

                if (historyRecords.length > 0) {
                    let latestIssue = BigInt(historyRecords[0].issue);
                    let nextIssueStr = (latestIssue + 1n).toString();

                    if (nextIssueStr !== lastProcessedPeriod) {
                        lastProcessedPeriod = nextIssueStr;
                        currentRound.periodNumber = nextIssueStr;

                        if (savedPredictions[nextIssueStr] === undefined) {
                            let newPred = generateProbabilityPattern(nextIssueStr, historyRecords);
                            currentRound.livePrediction = newPred;
                            savedPredictions[nextIssueStr] = newPred.suggestedNum;
                        } else {
                            let pNum = savedPredictions[nextIssueStr];
                            let targetType = pNum >= 5 ? "Big" : "Small";
                            let color = pNum % 2 === 0 ? "Red" : "Green";
                            currentRound.livePrediction = { suggestedNum: pNum, suggestedType: targetType, suggestedColor: color };
                        }
                    }
                }
            } catch (e) {
                console.error("API Parse Error:", e.message);
            }
        });
    }).on('error', (err) => {
        console.error("Network/API Error:", err.message);
    });
}

function startSyncLoop() {
    setInterval(() => {
        fetchDamanApiData();

        if (currentRound.countdown > 0) {
            currentRunCountdown = currentRound.countdown--;
        } else {
            currentRound.countdown = 30;
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

loadHistoryFromSupabase().then(() => {
    server.listen(PORT, () => {
        console.log(`Facing AI Server running at http://localhost:${PORT} with 2000 Records & Live Display!`);
        startSyncLoop();
    });
});
