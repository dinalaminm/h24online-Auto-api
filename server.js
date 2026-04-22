const https = require("https");

// ===== Firebase Config =====
const FIREBASE_URL = "https://test-only-12cb4-default-rtdb.firebaseio.com";

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
            res.on("end", () => resolve(JSON.parse(data)));
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

// ===== AUTO CALL LOGIC =====
async function runAutoCall() {
    try {
        const d = await firebaseGet("game");
        if (!d)              { console.log("⚠️  Firebase data নেই"); return; }
        if (!d.autoMode)     { console.log("⏸  Auto Mode OFF — কিছু করছি না"); return; }
        if (d.status === "ROUND ENDED") { console.log("🏁 Round শেষ — skip"); return; }

        const pool    = Array.isArray(d.numberPool)    ? d.numberPool    : [];
        const called  = Array.isArray(d.calledNumbers) ? d.calledNumbers : [];
        const speed   = (d.autoCallSpeed > 0 ? d.autoCallSpeed : 15); // seconds

        const remaining = pool.filter(n => !called.includes(n));

        if (remaining.length === 0) {
            await firebaseSet("game/status", "ROUND ENDED");
            console.log("✅ সব নাম্বার শেষ — ROUND ENDED set করা হয়েছে");
            return;
        }

        // এই cycle-এ কতটা call করবো
        const callsThisCycle = Math.max(1, Math.floor(CHECK_INTERVAL_MS / (speed * 1000)));
        const toCall = Math.min(callsThisCycle, remaining.length);

        let currentCalled = [...called];

        for (let i = 0; i < toCall; i++) {
            const stillRemaining = pool.filter(n => !currentCalled.includes(n));
            if (stillRemaining.length === 0) break;

            const pick = stillRemaining[Math.floor(Math.random() * stillRemaining.length)];
            currentCalled.push(pick);

            await firebaseSet("game/calledNumbers", currentCalled);
            console.log(`🎱 Auto called: ${pick}  (${currentCalled.length}/90 called, ${90 - currentCalled.length} বাকি)`);

            // পরের call-এর আগে speed-অনুযায়ী wait করো
            if (i < toCall - 1) await sleep(speed * 1000);
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

        // রাউন্ড চলমান থাকলে নতুন শুরু করবো না
        if (d.status === "GAME IS LIVE") {
            const called = Array.isArray(d.calledNumbers) ? d.calledNumbers : [];
            if (called.length < 90) {
                console.log("🔄 Round এখনো চলছে — নতুন শুরু করছি না");
                return;
            }
        }

        // Pool shuffle
        const pool = [];
        for (let i = 1; i <= 90; i++) pool.push(i);
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }

        const newRound = (d.roundNum || 0) + 1;
        await firebaseSet("game", {
            calledNumbers:  [],
            winners:        {},
            roundNum:       newRound,
            roundStartTime: Date.now(),
            numberPool:     pool,
            status:         "GAME IS LIVE",
            autoMode:       true,
            autoCallSpeed:  d.autoCallSpeed || 15,
        });

        console.log(`🚀 AUTO Round #${newRound} শুরু হয়েছে!`);
    } catch (err) {
        console.error("❌ autoRound error:", err.message);
    }
}

// ===== INTERVALS =====
const CHECK_INTERVAL_MS = 15 * 1000;   // প্রতি ১৫ সেকেন্ডে auto call চেক
const ROUND_INTERVAL_MS = 20 * 60 * 1000; // প্রতি ২০ মিনিটে round চেক

console.log("🤖 H24ONLINE Auto-Call Server চালু হয়েছে!");
console.log(`⏱  Call check: প্রতি ${CHECK_INTERVAL_MS/1000}s`);
console.log(`🔄 Round check: প্রতি ${ROUND_INTERVAL_MS/60000} মিনিট`);

// প্রথমবার সাথে সাথে চালাও
runAutoCall();

setInterval(runAutoCall,  CHECK_INTERVAL_MS);
setInterval(runAutoRound, ROUND_INTERVAL_MS);

// ===== HTTP SERVER (Render.com জীবিত রাখার জন্য) =====
const http = require("http");
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("H24ONLINE Auto-Call Server is running ✅");
}).listen(process.env.PORT || 3000, () => {
    console.log(`🌐 HTTP server চালু — port ${process.env.PORT || 3000}`);
});
