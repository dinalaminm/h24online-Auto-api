const https = require("https");

// ===== Firebase Config =====
const FIREBASE_URL = "https://test-only-12cb4-default-rtdb.firebaseio.com";
const FIRESTORE_ROUNDS_URL = "https://firestore.googleapis.com/v1/projects/h24-online/databases/(default)/documents/settings/rounds";

// ===== Firestore থেকে rounds list লোড করো =====
let _roundsListCache = null;
async function loadRoundsList() {
    if (_roundsListCache) return _roundsListCache;
    try {
        const res = await new Promise((resolve, reject) => {
            https.get(FIRESTORE_ROUNDS_URL, r => {
                let data = "";
                r.on("data", c => data += c);
                r.on("end", () => resolve(JSON.parse(data)));
            }).on("error", reject);
        });
        const listArr = res.fields?.list?.arrayValue?.values || [];
        _roundsListCache = listArr.map(v => {
            const m = v.mapValue?.fields || {};
            return {
                label: m.label?.stringValue || '',
                time:  m.time?.stringValue  || ''
            };
        });
        console.log(`📋 Rounds loaded: ${_roundsListCache.length}টি`);
        return _roundsListCache;
    } catch(e) {
        console.warn("⚠️ Rounds load failed:", e.message);
        return [];
    }
}

function parseRoundTime(str) {
    if (!str) return null;
    const p = str.trim().split(" ");
    if (p.length < 2) return null;
    const [hh, mm] = p[0].split(":");
    const mer = p[1].toUpperCase();
    let h = parseInt(hh)||0, m = parseInt(mm)||0;
    if (mer === "PM" && h !== 12) h += 12;
    if (mer === "AM" && h === 12) h = 0;
    return {h, m};
}

async function getAutoRoundLabel() {
    const rounds = await loadRoundsList();
    if (!rounds.length) return "";
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    for (let i = 0; i < rounds.length; i++) {
        const r = rounds[i];
        let p = parseRoundTime(r.time || "");
        if (!p && r.label) {
            const parts = r.label.split(" - ");
            p = parseRoundTime((parts[1]||"").trim());
        }
        if (!p) continue;
        const rm = (p.h===0 && p.m===0) ? 1440 : p.h*60+p.m;
        if (nowMin < rm) return r.label;
    }
    return rounds[rounds.length-1]?.label || "";
}

// ===== Timing Config (live.html এর সাথে মিলিয়ে রাখুন) =====
const NEXT_ROUND_DELAY   = 10 * 60 * 1000;  // 10 মিনিট — live.html এর মতোই
const CHECK_INTERVAL_MS  = 15 * 1000;        // প্রতি ১৫ সেকেন্ডে auto call চেক
const ROUND_CHECK_MS     = 30 * 1000;        // প্রতি ৩০ সেকেন্ডে round চেক (round শুরু দ্রুত হবে)

// ===== Firebase REST API helpers =====
function firebaseGet(path) {
    return new Promise((resolve, reject) => {
        https.get(`${FIREBASE_URL}/${path}.json`, res => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        }).on("error", reject);
    });
}

function firebaseSet(path, value) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(value);
        const url  = new URL(`${FIREBASE_URL}/${path}.json`);
        const options = {
            hostname: url.hostname,
            path:     url.pathname + url.search,
            method:   "PUT",
            headers:  {
                "Content-Type":   "application/json",
                "Content-Length": Buffer.byteLength(body),
            },
        };
        const req = https.request(options, res => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(null); } });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

function firebasePatch(path, value) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(value);
        const url  = new URL(`${FIREBASE_URL}/${path}.json`);
        const options = {
            hostname: url.hostname,
            path:     url.pathname + url.search,
            method:   "PATCH",
            headers:  {
                "Content-Type":   "application/json",
                "Content-Length": Buffer.byteLength(body),
            },
        };
        const req = https.request(options, res => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(null); } });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

// ===== Sleep helper =====
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== WINNER DETECTION (live.html এর মতো একই algorithm) =====

function seededRand(seed) {
    let s = seed;
    return () => {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        return (s >>> 0) / 0xffffffff;
    };
}

function generateSet(setNo) {
    const rand = seededRand(setNo * 999983 + 7);
    const colPools = [
        [1,2,3,4,5,6,7,8,9],
        [10,11,12,13,14,15,16,17,18,19],
        [20,21,22,23,24,25,26,27,28,29],
        [30,31,32,33,34,35,36,37,38,39],
        [40,41,42,43,44,45,46,47,48,49],
        [50,51,52,53,54,55,56,57,58,59],
        [60,61,62,63,64,65,66,67,68,69],
        [70,71,72,73,74,75,76,77,78,79],
        [80,81,82,83,84,85,86,87,88,89,90]
    ];
    const shuffled = colPools.map(pool => {
        const arr = [...pool];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    });
    const tickets = Array.from({ length: 6 }, () => ({
        grid: Array.from({ length: 3 }, () => Array(9).fill(null)),
        nums: []
    }));
    const matrix = generateMatrix(rand, shuffled.map(p => p.length));
    const ptrs   = Array(9).fill(0);
    for (let r = 0; r < 18; r++) {
        const ti = Math.floor(r / 3);
        const ri = r % 3;
        for (let c = 0; c < 9; c++) {
            if (matrix[r][c]) {
                const n = shuffled[c][ptrs[c]++];
                tickets[ti].grid[ri][c] = n;
                tickets[ti].nums.push(n);
            }
        }
    }
    return tickets;
}

function generateMatrix(rand, colCounts) {
    const mat = Array.from({ length: 18 }, () => Array(9).fill(false));
    const rem = [...colCounts];
    for (let r = 0; r < 18; r++) {
        const rowsLeft = 18 - r;
        const chosen   = [];
        const cols     = Array.from({ length: 9 }, (_, i) => i);
        for (let i = cols.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [cols[i], cols[j]] = [cols[j], cols[i]];
        }
        for (const c of cols) {
            if (rem[c] >= rowsLeft && !chosen.includes(c)) chosen.push(c);
        }
        const rest = cols.filter(c => !chosen.includes(c) && rem[c] > 0);
        for (let i = rest.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        for (const c of rest) {
            if (chosen.length >= 5) break;
            if (rem[c] > 0) chosen.push(c);
        }
        for (let i = 0; i < Math.min(5, chosen.length); i++) {
            mat[r][chosen[i]] = true;
            rem[chosen[i]]--;
        }
    }
    return mat;
}

// 100 সেট cache
let allSetsCache = null;
function getAllSets() {
    if (allSetsCache) return allSetsCache;
    allSetsCache = [];
    for (let s = 1; s <= 100; s++) allSetsCache.push(generateSet(s));
    return allSetsCache;
}

function getTNO(setNo, ti)  { return (setNo - 1) * 6 + ti + 1; }
function getSeat(setNo)     { return `N${String(setNo).padStart(3, '0')}`; }

// Prize check functions
const PRIZE_CHECKS = {
    earlyfive: (nums, grid, cs) => nums.filter(n => cs.has(n)).length >= 5,
    quick7:    (nums, grid, cs) => nums.filter(n => cs.has(n)).length >= 7,
    topline:   (nums, grid, cs) => {
        const top = grid[0].filter(n => n !== null);
        return top.length === 5 && top.every(n => cs.has(n));
    },
    middleline: (nums, grid, cs) => {
        const mid = grid[1].filter(n => n !== null);
        return mid.length === 5 && mid.every(n => cs.has(n));
    },
    bottomline: (nums, grid, cs) => {
        const bot = grid[2].filter(n => n !== null);
        return bot.length === 5 && bot.every(n => cs.has(n));
    },
    corner: (nums, grid, cs) => {
        let tL = null, tR = null, bL = null, bR = null;
        for (let c = 0; c < 9; c++) {
            const v = grid[0][c];
            if (v !== null) { if (tL === null) tL = v; tR = v; }
        }
        for (let c = 0; c < 9; c++) {
            const v = grid[2][c];
            if (v !== null) { if (bL === null) bL = v; bR = v; }
        }
        if (tL === null || bL === null) return false;
        const corners = [...new Set([tL, tR, bL, bR])];
        return corners.length === 4 && corners.every(n => cs.has(n));
    },
    fullhouse: (nums, grid, cs) => nums.length === 15 && nums.every(n => cs.has(n)),
};

function detectWinners(called, existingWinners) {
    const cs  = new Set(called.map(Number));
    const sets = getAllSets();
    const newWinners = {};

    for (const [prizeKey, checkFn] of Object.entries(PRIZE_CHECKS)) {
        if (existingWinners && existingWinners[prizeKey]) continue; // already won

        for (let s = 0; s < 100; s++) {
            let found = false;
            for (let ti = 0; ti < 6; ti++) {
                const tk = sets[s][ti];
                if (checkFn(tk.nums, tk.grid, cs)) {
                    newWinners[prizeKey] = {
                        tno:      getTNO(s + 1, ti),
                        seat:     getSeat(s + 1),
                        calledAt: called.length,
                        time:     new Date().toLocaleTimeString('bn-BD')
                    };
                    found = true;
                    break;
                }
            }
            if (found) break;
        }
    }

    return newWinners;
}

// ===== AUTO CALL LOGIC =====
async function runAutoCall() {
    try {
        const d = await firebaseGet("game");
        if (!d)           { console.log("⚠️  Firebase data নেই"); return; }
        if (!d.autoMode)  { console.log("⏸  Auto Mode OFF"); return; }
        if (d.status === "ROUND ENDED") { console.log("🏁 Round শেষ — skip"); return; }
        if (d.status !== "GAME IS LIVE") { console.log(`⏳ Status: ${d.status} — skip`); return; }

        const pool   = Array.isArray(d.numberPool)    ? d.numberPool    : [];
        const called = Array.isArray(d.calledNumbers) ? d.calledNumbers : [];
        const speed  = d.autoCallSpeed > 0 ? d.autoCallSpeed : 15;

        // pool-এর ক্রম অনুযায়ী পরবর্তী number বের করো (random নয়)
        const remaining = pool.filter(n => !called.includes(n));

        if (remaining.length === 0) {
            // সব number শেষ — round end করো
            const endNow = Date.now();
            await firebasePatch("game", {
                status:       "ROUND ENDED",
                roundEndTime: endNow,
                nextRoundAt:  endNow + NEXT_ROUND_DELAY
            });
            console.log("✅ সব নম্বর শেষ — ROUND ENDED");
            return;
        }

        // Pool-এর ক্রম অনুযায়ী প্রথম number নাও
        const pick = remaining[0];
        const newCalled = [...called, pick];

        await firebaseSet("game/calledNumbers", newCalled);
        console.log(`🎱 Called: ${pick}  (${newCalled.length}/90, বাকি: ${remaining.length - 1})`);

        // ── Winner Detection ──
        const existingWinners = d.winners || {};
        const newWinners = detectWinners(newCalled, existingWinners);

        if (Object.keys(newWinners).length > 0) {
            const winUpdates = {};
            for (const [key, val] of Object.entries(newWinners)) {
                winUpdates[`game/winners/${key}`] = val;
                console.log(`🏆 Winner: ${key} → TNO:${val.tno} সীট-${val.seat} (${val.calledAt} নম্বরে)`);
            }
            // Winners Firebase-এ লেখো
            for (const [path, val] of Object.entries(winUpdates)) {
                await firebaseSet(path, val);
            }

            // Full House হলে Round শেষ করো
            if (newWinners.fullhouse || existingWinners.fullhouse) {
                const endNow = Date.now();
                await firebasePatch("game", {
                    status:       "ROUND ENDED",
                    roundEndTime: endNow,
                    nextRoundAt:  endNow + NEXT_ROUND_DELAY
                });
                console.log(`🎮 Full House! ROUND ENDED — পরবর্তী রাউন্ড ${NEXT_ROUND_DELAY / 60000} মিনিট পরে`);
            }
        }

    } catch (err) {
        console.error("❌ autoCall error:", err.message);
    }
}

// ===== AUTO ROUND LOGIC =====
async function runAutoRound() {
    try {
        const d = await firebaseGet("game");
        if (!d || !d.autoMode) return;

        // রাউন্ড এখনো LIVE → শুরু করবো না
        if (d.status === "GAME IS LIVE") {
            console.log("🔄 Round এখনো চলছে — skip");
            return;
        }

        // ROUND ENDED — nextRoundAt পেরিয়ে গেলে নতুন round শুরু করো
        if (d.status === "ROUND ENDED") {
            const nextRoundAt = d.nextRoundAt || 0;
            const now         = Date.now();
            if (nextRoundAt > 0 && now < nextRoundAt) {
                const waitSec = Math.round((nextRoundAt - now) / 1000);
                console.log(`⏳ পরবর্তী রাউন্ড ${waitSec}s পরে`);
                return;
            }
        }

        // নতুন round শুরু
        const pool = [];
        for (let i = 1; i <= 90; i++) pool.push(i);
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }

        const newRound = (d.roundNum || 0) + 1;
        const now      = Date.now();

        // সময় অনুযায়ী roundLabel বের করো
        const roundLabel = await getAutoRoundLabel();
        console.log(`🏷️  Round Label: ${roundLabel || "(পাওয়া যায়নি)"}`);

        await firebaseSet("game", {
            calledNumbers:  [],
            winners:        {},
            roundNum:       newRound,
            roundLabel:     roundLabel,
            roundStartTime: now,
            numberPool:     pool,
            status:         "GAME IS LIVE",
            autoMode:       true,
            autoCallSpeed:  d.autoCallSpeed || 15,
            roundEndTime:   0,
            nextRoundAt:    0
        });

        // Cache reset করো — নতুন round এ নতুন করে detect হবে
        console.log(`🚀 AUTO Round #${newRound} "${roundLabel}" শুরু হয়েছে!`);

    } catch (err) {
        console.error("❌ autoRound error:", err.message);
    }
}

// ===== INTERVALS =====
console.log("🤖 H24ONLINE Auto-Call Server চালু হয়েছে!");
console.log(`⏱  Call check: প্রতি ${CHECK_INTERVAL_MS / 1000}s`);
console.log(`🔄 Round check: প্রতি ${ROUND_CHECK_MS / 1000}s`);
console.log(`⏰ Next round delay: ${NEXT_ROUND_DELAY / 60000} মিনিট`);

// প্রথমবার সাথে সাথে চালাও
runAutoCall();
runAutoRound();

setInterval(runAutoCall,  CHECK_INTERVAL_MS);
setInterval(runAutoRound, ROUND_CHECK_MS);

// ===== HTTP SERVER (Render.com জীবিত রাখার জন্য) =====
const http = require("http");
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("H24ONLINE Auto-Call Server is running ✅");
}).listen(process.env.PORT || 3000, () => {
    console.log(`🌐 HTTP server চালু — port ${process.env.PORT || 3000}`);
});
