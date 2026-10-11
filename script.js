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

// === SUPABASE CONFIGURATION (Your Exact Setup) ===
const SUPABASE_URL = 'https://knafkiozaguyvemtrjfz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Lv7-h7zaLkSnPXgYc77_ig_wp71xmJ6';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// === PREDICTION SETTINGS (yahan se tune karo) ===
const HISTORY_LIMIT = 500;   // Supabase se kitna data load ho
const WINDOW = 30;           // prediction ke liye kitne recent draws dekhein
const W_FREQ = 0.5;          // number kitni baar aaya (frequency) ka weight
const W_DUE = 0.5;           // number kitne din se nahi aaya (overdue) ka weight

let historyRecords = [];
let savedPredictions = {};
let lastProcessedPeriod = null;

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
        }
    } catch (e) {
        console.log("Load exception:", e);
    }
}

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Facing AI Pattern Matcher Tool - Milu Bhai</title>
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
                max-width: 440px;
                margin: 20px auto;
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
            .prediction-card {
                background: #252525;
                border: 2px solid #00e676;
                padding: 15px;
                border-radius: 8px;
                margin: 15px 0;
            }
            .prediction-card h3 { margin: 0 0 8px 0; color: #00e676; font-size: 16px; }
            .pred-num-box {
                font-size: 36px;
                font-weight: bold;
                color: #ffffff;
                margin: 5px 0;
            }
            .pred-details {
                font-size: 14px;
                color: #b0bec5;
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
            <div class="period-box">Period: <span id="periodNumber" style="color: #fff; font-weight: bold;">Loading...</span></div>
            <div class="timer-box">Time Left: <span id="timer">30</span>s</div>

            <div class="prediction-card">
                <h3>High Chance Number Prediction</h3>
                <div class="pred-num-box" id="predNum">-</div>
                <div class="pred-details">
                    Type: <span id="predType">-</span> | Color: <span id="predColor">-</span>
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

function generateProbabilityPattern(periodStr, history) {
    if (!history || history.length === 0) {
        return { suggestedNum: 5, suggestedType: "Big", suggestedColor: "Green" };
    }

    const recent = history.slice(0, Math.min(history.length, WINDOW));

    const freq = new Array(10).fill(0);       // window mein number kitni baar aaya
    const lastSeen = new Array(10).fill(-1);  // pichhli baar kab aaya (index)

    recent.forEach((h, i) => {
        freq[h.number] += 1;
        if (lastSeen[h.number] === -1) lastSeen[h.number] = i;
    });

    // gap = kitne draws se nahi aaya (0 = abhi aaya, zyada = overdue)
    const gap = lastSeen.map(idx => (idx === -1 ? recent.length : idx));

    const maxFreq = Math.max(...freq) || 1;
    const maxGap = Math.max(...gap) || 1;

    let bestNum = 0;
    let bestScore = -Infinity;
    for (let n = 0; n < 10; n++) {
        const freqScore = freq[n] / maxFreq;   // 0 se 1
        const dueScore = gap[n] / maxGap;      // 0 se 1
        const score = freqScore * W_FREQ + dueScore * W_DUE;
        if (score > bestScore) {
            bestScore = score;
            bestNum = n;
        }
    }

    const type = bestNum >= 5 ? "Big" : "Small";
    const color = bestNum % 2 === 0 ? "Red" : "Green";

    return { suggestedNum: bestNum, suggestedType: type, suggestedColor: color };
}

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
            currentRound.countdown--;
        } else {
            currentRound.countdown = 30;
        }

        io.emit('timerUpdate', {
            periodNumber: currentRound.periodNumber,
            countdown: currentRound.countdown,
            prediction: currentRound.livePrediction,
            history: historyRecords
        });
    }, 1000);
}

loadHistoryFromSupabase().then(() => {
    server.listen(PORT, () => {
        console.log(`Facing AI Server running at http://localhost:${PORT} with Supabase Connected!`);
        startSyncLoop();
    });
});