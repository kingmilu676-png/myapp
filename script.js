const express = require('express');
const http = require('http');
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

// Accurate IST Wingo 30S Period Generator (100% Reliable & Independent)
function getAccurateWingoPeriod() {
    const now = new Date();
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const istTime = new Date(utcTime + (3600000 * 5.5)); // IST Offset (+5:30)
    
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

// Load History directly from Supabase Database
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

// Track previous period to handle transition
let lastProcessedPeriod = currentRound.periodNumber;

// Main Real-Time Sync & Loop
function startSyncLoop() {
    setInterval(async () => {
        let exactPeriod = getAccurateWingoPeriod();
        let nowSec = Math.floor(Date.now() / 1000);
        let remainingSec = 30 - (nowSec % 30);

        // If period changes, process the finished period and save result to Supabase
        if (exactPeriod !== lastProcessedPeriod) {
            let finishedPeriod = lastProcessedPeriod;
            lastProcessedPeriod = exactPeriod;
            currentRound.periodNumber = exactPeriod;

            let generatedResult = Math.floor(Math.random() * 10);
            let predNumUsed = savedPredictions[finishedPeriod] !== undefined ? savedPredictions[finishedPeriod] : null;
            
            let status = "PENDING";
            if (predNumUsed !== null) {
                let actualType = generatedResult >= 5 ? "Big" : "Small";
                let predType = predNumUsed >= 5 ? "Big" : "Small";
                status = (actualType === predType) ? "WIN" : "LOSS";
            }

            try {
                await supabase.from('test_results').insert([
                    {
                        period_number: finishedPeriod,
                        results: generatedResult,
                        pred_num: predNumUsed,
                        status: status
                    }
                ]);
                
                await loadHistoryFromSupabase();
            } catch (err) {
                console.error("Error auto-saving result:", err.message);
            }
        }

        currentRound.countdown = remainingSec;

        if (!savedPredictions[exactPeriod]) {
            let pred = generateSmartPrediction(exactPeriod, historyRecords);
            currentRound.livePrediction = pred;
            savedPredictions[exactPeriod] = pred.suggestedNum;
        } else {
            let pNum = savedPredictions[exactPeriod];
            currentRound.livePrediction = {
                suggestedNum: pNum,
                suggestedType: pNum >= 5 ? "Big" : "Small",
                suggestedColor: pNum % 2 === 0 ? "Red" : "Green"
            };
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
        console.log(`Server running on port ${PORT}`);
        startSyncLoop();
    });
});
