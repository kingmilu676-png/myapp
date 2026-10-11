Const express = require('express');
Const http = require('http');
Const https = require('https');
Const { createClient } = require('@supabase/supabase-js');
Const { Server } = require('socket.io');

Const app = express();
Const server = http.createServer(app);
Const io = new Server(server, {
    Cors: {
        Origin: "*",
        Methods: ["GET", "POST"]
    }
});

Const PORT = process.env.PORT || 3000;

// === SUPABASE CONFIGURATION ===
Const SUPABASE_URL = 'https://knafkiozaguyvemtrjfz.supabase.co';
Const SUPABASE_KEY = 'sb_publishable_Lv7-h7zaLkSnPXgYc77_ig_wp71xmJ6';
Const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// === 2000 RECORDS LIMIT SETTING ===
Const HISTORY_LIMIT = 2000;

Let historyRecords = [];
Let savedPredictions = {};
Let lastProcessedPeriod = null;

// Analytics Stats Object
Let analyticsStats = {
    TotalAnalyzed: 0,
    BigPercent: 50,
    SmallPercent: 50,
    HotNumber: "-",
    OverdueNumber: "-",
    WinRate: 0
};

// Supabase se 2000 data load karein aur Analyze karein
Async function loadHistoryFromSupabase() {
    Try {
        Const { data, error } = await supabase
            .from('test_results')
            .select('*')
            .order('period_number', { ascending: false })
            .limit(HISTORY_LIMIT);

        If (error) {
            Console.error("Supabase Load Error:", error.message);
            Return;
        }

        If (data && data.length > 0) {
            HistoryRecords = data.map(item => ({
                Issue: String(item.period_number),
                Number: parseInt(item.results ?? 0),
                Type: parseInt(item.results ?? 0) >= 5 ? "Big" : "Small",
                Color: parseInt(item.results ?? 0) % 2 === 0 ? "Red" : "Green",
                PredNum: item.pred_num ?? null,
                Status: item.status || "PENDING"
            }));
            Console.log(`Loaded ${historyRecords.length} records from Supabase.`);
            RunDeepDataAnalysis();
        }
    } catch (e) {
        Console.log("Load exception:", e);
    }
}

// === 2000 RECORDS ANALYSIS ENGINE ===
Function runDeepDataAnalysis() {
    If (!historyRecords || historyRecords.length === 0) return;

    Let total = historyRecords.length;
    Let bigCount = 0;
    Let smallCount = 0;
    Let numFreq = Array(10).fill(0);
    Let totalWins = 0;
    Let evaluatedPreds = 0;

    HistoryRecords.forEach(item => {
        If (item.type === "Big") bigCount++;
        Else smallCount++;

        If (item.number >= 0 && item.number <= 9) {
            NumFreq[item.number]++;
        }

        If (item.status === "WIN") {
            TotalWins++;
            EvaluatedPreds++;
        } else if (item.status === "LOSS") {
            EvaluatedPreds++;
        }
    });

    Let maxFreq = -1;
    Let minFreq = Infinity;
    Let hotNum = 0;
    Let overdueNum = 0;

    NumFreq.forEach((freq, num) => {
        If (freq > maxFreq) {
            MaxFreq = freq;
            HotNum = num;
        }
        If (freq < minFreq) {
            MinFreq = freq;
            OverdueNum = num;
        }
    });

    AnalyticsStats = {
        TotalAnalyzed: total,
        BigPercent: ((bigCount / total) * 100).toFixed(1),
        SmallPercent: ((smallCount / total) * 100).toFixed(1),
        HotNumber: hotNum,
        OverdueNumber: overdueNum,
        WinRate: evaluatedPreds > 0 ? ((totalWins / evaluatedPreds) * 100).toFixed(1) : "0.0"
    };
}

// Frontend HTML Interface
App.get('/', (req, res) => {
    Res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Facing AI Pattern Matcher Tool - Milu</title>
        <style>
            Body {
                Font-family: Arial, sans-serif;
                Background-color: #121212;
                Color: #ffffff;
                Text-align: center;
                Padding: 15px;
                Margin: 0;
            }
            .container {
                Max-width: 460px;
                Margin: 15px auto;
                Background: #1e1e1e;
                Padding: 20px;
                Border-radius: 12px;
                Box-shadow: 0 6px 15px rgba(0,0,0,0.6);
            }
            H2 { color: #00e676; margin-bottom: 15px; font-size: 22px; }
            .timer-box {
                Font-size: 24px;
                Font-weight: bold;
                Color: #ff9800;
                Margin: 10px 0;
                Background: #2a2a2a;
                Padding: 8px;
                Border-radius: 8px;
            }
            .period-box {
                Font-size: 16px;
                Color: #b0bec5;
                Margin-bottom: 10px;
            }
            .analytics-card {
                Background: #1a232a;
                Border: 1px solid #00b0ff;
                Border-radius: 8px;
                Padding: 10px;
                Margin: 12px 0;
                Font-size: 13px;
                Text-align: left;
            }
            .analytics-card h4 {
                Margin: 0 0 8px 0;
                Color: #00b0ff;
                Text-align: center;
            }
            .stats-grid {
                Display: grid;
                Grid-template-columns: 1fr 1fr;
                Gap: 8px;
            }
            .stat-item {
                Background: #252d35;
                Padding: 6px 8px;
                Border-radius: 4px;
            }
            .prediction-card {
                Background: #252525;
                Border: 2px solid #00e676;
                Padding: 15px;
                Border-radius: 8px;
                Margin: 15px 0;
            }
            .prediction-card h3 { margin: 0 0 8px 0; color: #00e676; font-size: 16px; }
            .pred-num-box {
                Font-size: 40px;
                Font-weight: bold;
                Color: #00e676;
                Margin: 5px 0;
            }
            .pred-details {
                Font-size: 15px;
                Color: #ffffff;
                Font-weight: bold;
            }
            .history-container {
                Margin-top: 20px;
                Text-align: left;
                Background: #252525;
                Padding: 12px;
                Border-radius: 8px;
                Max-height: 250px;
                Overflow-y: auto;
                Border: 1px solid #333;
            }
            .history-container h3 {
                Margin-top: 0;
                Font-size: 15px;
                Color: #90caf9;
                Border-bottom: 1px solid #444;
                Padding-bottom: 6px;
            }
            .history-item {
                Padding: 8px 6px;
                Border-bottom: 1px solid #333;
                Font-size: 12px;
                Display: flex;
                Justify-content: space-between;
                Align-items: center;
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
            Const socket = io();

            Socket.on('timerUpdate', (data) => {
                If (data.periodNumber && data.periodNumber !== "Loading...") {
                    Document.getElementById('periodNumber').innerText = data.periodNumber;
                }
                If (data.countdown !== undefined) {
                    Document.getElementById('timer').innerText = data.countdown;
                }

                // Update Analytics Stats
                If (data.analytics) {
                    Document.getElementById('statTotal').innerText = data.analytics.totalAnalyzed;
                    Document.getElementById('statWinRate').innerText = data.analytics.winRate + '%';
                    Document.getElementById('statRatio').innerText = data.analytics.bigPercent + '% / ' + data.analytics.smallPercent + '%';
                    Document.getElementById('statHotDue').innerText = 'Hot:' + data.analytics.hotNumber + ' | Due:' + data.analytics.overdueNumber;
                }

                // Display Expected Prediction Number on Screen
                If (data.prediction) {
                    Document.getElementById('predNum').innerText = data.prediction.suggestedNum;
                    Document.getElementById('predType').innerText = data.prediction.suggestedType;
                    Document.getElementById('predColor').innerText = data.prediction.suggestedColor;
                    Document.getElementById('predColor').style.color = data.prediction.suggestedColor === 'Red' ? '#ff5252' : '#4caf50';
                }

                If (data.history && data.history.length > 0) {
                    Let html = '';
                    Data.history.forEach(item => {
                        Const badgeClass = item.type === 'Big' ? 'badge-big' : 'badge-small';
                        Let statusHtml = '<span style="color:#aaa;">Pending</span>';
                        If (item.status === 'WIN') {
                            StatusHtml = '<span class="status-win">WIN</span>';
                        } else if (item.status === 'LOSS') {
                            StatusHtml = '<span class="status-loss">LOSS</span>';
                        }
                        
                        Html += \`<div class="history-item">
                            <span><b>\${String(item.issue).slice(-4)}</b></span>
                            <span>Res: <b>\${item.number}</b> <span class="\${badgeClass}">\${item.type}</span></span>
                            <span>Pred: \${item.predNum ?? '-'}</span>
                            <span>\${statusHtml}</span>
                        </div>\`;
                    });
                    Document.getElementById('historyList').innerHTML = html;
                }
            });
        </script>
    </body>
    </html>
    `);
});

Let currentRound = {
    PeriodNumber: "Loading...",
    Countdown: 30,
    LivePrediction: { suggestedNum: 6, suggestedType: "Big", suggestedColor: "Green" }
};

// Smart Prediction Logic
Function generateProbabilityPattern(periodStr, history) {
    If (!history || history.length < 3) return { suggestedNum: 6, suggestedType: "Big", suggestedColor: "Green" };

    Let last1 = history[0].number;
    Let last2 = history[1].number;
    Let last3 = history[2].number;

    Let p1 = parseInt(periodStr.slice(-1)) || 0;
    Let p2 = parseInt(periodStr.slice(-2, -1)) || 0;

    Let hotBonus = typeof analyticsStats.hotNumber === 'number' ? analyticsStats.hotNumber : 5;

    Let calculatedNum = (last1 * 3 + last2 * 2 + last3 + (p1 * 7) + p2 + hotBonus) % 10;
    If (calculatedNum < 0) calculatedNum += 10;

    // Strict Repeat Blocker
    If (calculatedNum === last1) {
        CalculatedNum = (last1 + 3) % 10;
    }

    Let type = calculatedNum >= 5 ? "Big" : "Small";
    Let color = calculatedNum % 2 === 0 ? "Red" : "Green";

    Return { suggestedNum: calculatedNum, suggestedType: type, suggestedColor: color };
}

// Fetch Official API & Sync with Supabase (Updated with proper headers to prevent HTML block)
Async function fetchDamanApiData() {
    Const timestamp = Date.now();
    Const url = `https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json?ts=${timestamp}`;

    Https.get(url, {
        Headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache'
        }
    }, (res) => {
        Let rawData = '';
        Res.on('data', (chunk) => { rawData += chunk; });
        Res.on('end', async () => {
            Try {
                // Check if response starts with HTML instead of JSON
                If (rawData.trim().startsWith('<')) {
                    Console.log("API returned HTML (Block page). Skipping this cycle...");
                    Return;
                }

                Const json = JSON.parse(rawData);
                Const dataObj = json.data || json;
                Let listArray = dataObj.list || dataObj.data?.list || json.list || [];

                If (Array.isArray(listArray) && listArray.length > 0) {
                    For (let item of listArray) {
                        Const iss = String(item.issueNumber || item.issue || '');
                        Const num = parseInt(item.number ?? item.winningNumber ?? item.price ?? item.sum);

                        If (iss && !isNaN(num)) {
                            Const type = num >= 5 ? "Big" : "Small";
                            Const color = num % 2 === 0 ? "Red" : "Green";

                            Let existing = historyRecords.find(h => h.issue === iss);
                            Let pNum = savedPredictions[iss] !== undefined ? savedPredictions[iss] : null;
                            Let status = pNum !== null ? (pNum === num ? "WIN" : "LOSS") : "PENDING";

                            If (!existing) {
                                HistoryRecords.push({
                                    Issue: iss,
                                    Number: num,
                                    Type: type,
                                    Color: color,
                                    PredNum: pNum,
                                    Status: status
                                });

                                Await supabase.from('test_results').upsert({
                                    Period_number: iss,
                                    Results: String(num),
                                    Pred_num: pNum,
                                    Status: status
                                }, { onConflict: ['period_number'] });

                            } else {
                                Existing.number = num;
                                Existing.type = type;
                                Existing.color = color;
                                If (pNum !== null) {
                                    Existing.predNum = pNum;
                                    Existing.status = (pNum === num) ? "WIN" : "LOSS";
                                }

                                Await supabase.from('test_results').upsert({
                                    Period_number: iss,
                                    Results: String(num),
                                    Pred_num: existing.predNum,
                                    Status: existing.status
                                }, { onConflict: ['period_number'] });
                            }
                        }
                    }
                }

                HistoryRecords.sort((a, b) => b.issue.localeCompare(a.issue));
                If (historyRecords.length > HISTORY_LIMIT) historyRecords.length = HISTORY_LIMIT;

                RunDeepDataAnalysis();

                If (historyRecords.length > 0) {
                    Let latestIssue = BigInt(historyRecords[0].issue);
                    Let nextIssueStr = (latestIssue + 1n).toString();

                    If (nextIssueStr !== lastProcessedPeriod) {
                        LastProcessedPeriod = nextIssueStr;
                        CurrentRound.periodNumber = nextIssueStr;

                        If (savedPredictions[nextIssueStr] === undefined) {
                            Let newPred = generateProbabilityPattern(nextIssueStr, historyRecords);
                            CurrentRound.livePrediction = newPred;
                            SavedPredictions[nextIssueStr] = newPred.suggestedNum;
                        } else {
                            Let pNum = savedPredictions[nextIssueStr];
                            Let targetType = pNum >= 5 ? "Big" : "Small";
                            Let color = pNum % 2 === 0 ? "Red" : "Green";
                            CurrentRound.livePrediction = { suggestedNum: pNum, suggestedType: targetType, suggestedColor: color };
                        }
                    }
                }
            } catch (e) {
                Console.error("API Parse Error:", e.message);
            }
        });
    }).on('error', (err) => {
        Console.error("Network/API Error:", err.message);
    });
}

Function startSyncLoop() {
    SetInterval(() => {
        FetchDamanApiData();

        If (currentRound.countdown > 0) {
            CurrentRound.countdown--;
        } else {
            CurrentRound.countdown = 30;
        }

        Io.emit('timerUpdate', {
            PeriodNumber: currentRound.periodNumber,
            Countdown: currentRound.countdown,
            Prediction: currentRound.livePrediction,
            Analytics: analyticsStats,
            History: historyRecords
        });
    }, 1000);
}

LoadHistoryFromSupabase().then(() => {
    Server.listen(PORT, () => {
        Console.log(`Facing AI Server running at http://localhost:${PORT} with 2000 Records & Live Display!`);
        StartSyncLoop();
    });
});
