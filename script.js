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

let historyRecords = [];
let savedPredictions = {};

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

// === FETCH DATA VIA PROXY WORKER ===
function fetchDamanApiData() {
    return new Promise((resolve, reject) => {
        const proxyUrl = process.env.PROXY_WORKER || 'https://wingo-proxy.kingmilu676.workers.dev';
        const url = `${proxyUrl}?ts=${Date.now()}`;

        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            },
            timeout: 10000
        }, (res) => {
            let rawData = '';

            res.on('data', (chunk) => {
                rawData += chunk;
            });

            res.on('end', () => {
                try {
                    let cleanedData = rawData.trim();
                    // Fix malformed JSON if missing leading curly brace
                    if (cleanedData.startsWith('"data"') || cleanedData.startsWith('data:')) {
                        cleanedData = '{' + cleanedData + '}';
                    }
                    
                    const parsedData = JSON.parse(cleanedData);
                    if (parsedData && parsedData.data && parsedData.data.list) {
                        resolve(parsedData.data.list);
                    } else if (Array.isArray(parsedData)) {
                        resolve(parsedData);
                    } else {
                        resolve(null);
                    }
                } catch (e) {
                    console.error("JSON Parse Error:", e.message);
                    resolve(null);
                }
            });
        }).on('error', (err) => {
            console.error("Proxy Connection Error:", err.message);
            resolve(null);
        });
    });
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

function getNextPeriodNumber(lastIssue) {
    if (!lastIssue) return "Loading...";
    try {
        let bigNum = BigInt(lastIssue);
        return (bigNum + 1n).toString();
    } catch (e) {
        return lastIssue;
    }
}

function generateSmartPrediction(periodStr, history) {
    if (!history || history.length < 3) return { suggestedNum: 7, suggestedType: "Big", suggestedColor: "Green" };

    let last1 = history[0].number;
    let last2 = history[1].number;
    let last3 = history[2].number;

    let p1 = parseInt(periodStr.slice(-1)) || 0;
    let p2 = parseInt(periodStr.slice(-2, -1)) || 0;

    let hotBonus = typeof analyticsStats.hotNumber === 'number' ? analyticsStats.hotNumber : 5;

    let calculatedNum = (last1 * 3 + last2 * 2 + last3 + (p1 * 7) + p2 + hotBonus) % 10;
    if (calculatedNum < 0) calculatedNum += 10;

    let type = calculatedNum >= 5 ? "Big" : "Small";
    let color = calculatedNum % 2 === 0 ? "Red" : "Green";

    return { suggestedNum: calculatedNum, suggestedType: type, suggestedColor: color };
}

let activePeriodNumber = "Loading...";

async function updateLiveGameData() {
    try {
        const apiList = await fetchDamanApiData();
        if (apiList && apiList.length > 0) {
            let latestIssue = apiList[0].issueNumber || apiList[0].periodNumber || apiList[0].issue;
            activePeriodNumber = getNextPeriodNumber(latestIssue);

            historyRecords = apiList.map(item => {
                const issueStr = String(item.issueNumber || item.periodNumber || item.issue || '');
                const num = parseInt(item.number ?? item.result ?? 0);
                const pred = savedPredictions[issueStr] !== undefined ? savedPredictions[issueStr] : null;

                let status = "PENDING";
                if (pred !== null) {
                    let actualType = num >= 5 ? "Big" : "Small";
                    let predType = pred >= 5 ? "Big" : "Small";
                    status = (actualType === predType) ? "WIN" : "LOSS";
                }

                return {
                    issue: issueStr,
                    number: num,
                    type: num >= 5 ? "Big" : "Small",
                    color: num % 2 === 0 ? "Red" : "Green",
                    predNum: pred,
                    status: status
                };
            });

            runDeepDataAnalysis();
        }
    } catch (err) {
        console.error("Live game sync error:", err.message);
    }
}

function startSyncLoop() {
    setInterval(async () => {
        let nowSec = Math.floor(Date.now() / 1000);
        let remainingSec = 30 - (nowSec % 30);

        if (remainingSec === 30 || remainingSec === 1 || historyRecords.length === 0) {
            await updateLiveGameData();
        }

        if (activePeriodNumber !== "Loading..." && !savedPredictions[activePeriodNumber]) {
            let pred = generateSmartPrediction(activePeriodNumber, historyRecords);
            savedPredictions[activePeriodNumber] = pred.suggestedNum;
        }

        let currentPredNum = savedPredictions[activePeriodNumber] !== undefined ? savedPredictions[activePeriodNumber] : 7;
        let currentPrediction = {
            suggestedNum: currentPredNum,
            suggestedType: currentPredNum >= 5 ? "Big" : "Small",
            suggestedColor: currentPredNum % 2 === 0 ? "Red" : "Green"
        };

        io.emit('timerUpdate', {
            periodNumber: activePeriodNumber,
            countdown: remainingSec,
            prediction: currentPrediction,
            analytics: analyticsStats,
            history: historyRecords
        });
    }, 1000);
}

io.on('connection', (socket) => {
    let currentPredNum = savedPredictions[activePeriodNumber] !== undefined ? savedPredictions[activePeriodNumber] : 7;
    socket.emit('timerUpdate', {
        periodNumber: activePeriodNumber,
        countdown: 30 - (Math.floor(Date.now() / 1000) % 30),
        prediction: {
            suggestedNum: currentPredNum,
            suggestedType: currentPredNum >= 5 ? "Big" : "Small",
            suggestedColor: currentPredNum % 2 === 0 ? "Red" : "Green"
        },
        analytics: analyticsStats,
        history: historyRecords
    });
});

server.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await updateLiveGameData();
    startSyncLoop();
});
