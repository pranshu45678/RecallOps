/* =========================================
   RECALL OPS AI — FRONTEND LOGIC
   - Talks to the backend when a URL is set in Settings
   - Falls back to a local demo engine, so the UI always works
========================================= */

/* -----------------------------------------
   BACKEND API CONTRACT (adjust here only)
   GET  /health     -> { status: "ok" }
   GET  /incidents  -> [ { id, service, error, severity, status,
                           root_cause, resolution, created_at,
                           resolution_minutes } ]
   POST /analyze    { service, error, severity, symptoms }
                    -> { incident_id?, root_cause, confidence,
                         matches:[{id,service,similarity,summary,root_cause,resolution}],
                         steps:[{title,detail}] }
   POST /resolve    { incident_id, service, error, severity, symptoms,
                      root_cause, resolution }  -> { ok: true }
----------------------------------------- */
const ENDPOINTS = {
    health: "/api/health",
    incidents: "/api/incidents",
    analyze: "/api/analyze",
    resolve: "/api/resolve"
};

const STORE_KEY = "recallops_demo_incidents_v1";
const API_KEY = "recallops_api_url";

const state = {
    incidents: [],
    backendOnline: false,
    lastAnalysis: null,   // { input, result }
    apiUrl: (safeGet(API_KEY) || window.RECALLOPS_API || (location.protocol !== "file:" ? location.origin : "")).replace(/\/$/, "")
};

/* =========================================
   HELPERS
========================================= */

function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
function safeDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

function $(id) { return document.getElementById(id); }

function esc(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sevClass(s) { return String(s || "medium").toLowerCase(); }

function statusLabel(s) { return String(s).toLowerCase() === "resolved" ? "Resolved" : "Investigating"; }

function relativeDate(iso) {
    const t = new Date(iso).getTime();
    if (isNaN(t)) return "";
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 30) return days + " days ago";
    return new Date(iso).toLocaleDateString();
}

function toast(message, type) {
    const el = document.createElement("div");
    el.className = "toast " + (type || "info");
    el.textContent = message;
    $("toastStack").appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
        el.classList.remove("show");
        setTimeout(() => el.remove(), 300);
    }, 3800);
}

/* =========================================
   DEMO DATA + LOCAL "MEMORY" ENGINE
========================================= */

function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString(); }

function seedIncidents() {
    return [
        { id: "INC-042", service: "Payment API", error: "Database connection errors", severity: "High", status: "resolved", root_cause: "Database connection pool exhaustion", resolution: "Increased pool size from 20 to 50 and added pool utilization alert", created_at: daysAgo(0), resolution_minutes: 14, symptoms: "503 responses, checkout failing, timeouts under load" },
        { id: "INC-041", service: "Auth Service", error: "Authentication failures", severity: "Medium", status: "resolved", root_cause: "Expired signing certificate", resolution: "Rotated JWT signing certificate and automated renewal", created_at: daysAgo(1), resolution_minutes: 22, symptoms: "401 errors, users logged out, token validation failing" },
        { id: "INC-040", service: "Order Service", error: "API latency spike", severity: "High", status: "investigating", root_cause: "", resolution: "", created_at: daysAgo(2), resolution_minutes: 0, symptoms: "p99 latency 8s, slow responses, queue growing" },
        { id: "INC-039", service: "Inventory", error: "Deployment failure", severity: "Low", status: "resolved", root_cause: "Configuration error", resolution: "Fixed missing environment variable in deploy manifest", created_at: daysAgo(3), resolution_minutes: 9, symptoms: "rollout stuck, pods crash looping, missing env var" },
        { id: "INC-035", service: "Search Service", error: "Out of memory restarts", severity: "High", status: "resolved", root_cause: "Memory leak", resolution: "Patched unbounded cache and set heap limit", created_at: daysAgo(9), resolution_minutes: 41, symptoms: "container restarts, memory climbing steadily, OOMKilled" },
        { id: "INC-029", service: "Order Service", error: "API timeout errors", severity: "High", status: "resolved", root_cause: "Database connection pool exhaustion", resolution: "Increased connection pool size and reduced idle timeout", created_at: daysAgo(16), resolution_minutes: 25, symptoms: "timeouts, 504 gateway errors, database connections maxed" },
        { id: "INC-027", service: "Notification Service", error: "Emails delayed", severity: "Medium", status: "resolved", root_cause: "API timeout", resolution: "Added retry with backoff to the mail provider client", created_at: daysAgo(19), resolution_minutes: 30, symptoms: "queue backlog, delayed emails, provider timeouts" },
        { id: "INC-021", service: "Payment API", error: "Connection pool saturation", severity: "High", status: "resolved", root_cause: "Database connection pool exhaustion", resolution: "Scaled pool size after traffic increase", created_at: daysAgo(26), resolution_minutes: 18, symptoms: "503 errors after traffic spike, connections saturated" },
        { id: "INC-018", service: "Auth Service", error: "Login page 500 errors", severity: "High", status: "resolved", root_cause: "Configuration error", resolution: "Reverted bad config push and added config validation in CI", created_at: daysAgo(31), resolution_minutes: 12, symptoms: "500 errors after deploy, login broken, config changed" },
        { id: "INC-014", service: "Payment API", error: "Repeated 503 responses", severity: "High", status: "resolved", root_cause: "Database connection pool exhaustion", resolution: "Increased the connection pool size and restarted workers", created_at: daysAgo(44), resolution_minutes: 35, symptoms: "503 responses, connection pool exhausted, requests queuing" },
        { id: "INC-011", service: "Inventory", error: "Slow stock queries", severity: "Medium", status: "resolved", root_cause: "Missing database index", resolution: "Added composite index on sku and warehouse", created_at: daysAgo(52), resolution_minutes: 28, symptoms: "slow queries, high database CPU, latency" },
        { id: "INC-008", service: "Search Service", error: "Stale search results", severity: "Low", status: "resolved", root_cause: "Configuration error", resolution: "Fixed indexer schedule in cron config", created_at: daysAgo(60), resolution_minutes: 20, symptoms: "outdated results, indexer not running" }
    ];
}

function loadDemoIncidents() {
    const raw = safeGet(STORE_KEY);
    if (raw) { try { return JSON.parse(raw); } catch (e) { /* fall through */ } }
    const seeded = seedIncidents();
    safeSet(STORE_KEY, JSON.stringify(seeded));
    return seeded;
}

function saveDemoIncidents(list) { safeSet(STORE_KEY, JSON.stringify(list)); }

const STOP = new Set("the a an and or of to in on for is are was were with after before from by at it this that be as we our error errors problem issue".split(" "));

function tokens(text) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
}

function scoreMatch(input, inc) {
    const a = new Set(tokens(input.service + " " + input.error + " " + input.symptoms));
    const b = new Set(tokens(inc.service + " " + inc.error + " " + inc.symptoms + " " + inc.root_cause));
    if (!a.size || !b.size) return 0;
    let hit = 0;
    a.forEach(w => { if (b.has(w)) hit++; });
    let s = hit / Math.sqrt(a.size * b.size);
    if (inc.service.toLowerCase() === input.service.trim().toLowerCase()) s += 0.18;
    return Math.min(s, 1);
}

async function demoAnalyze(input) {
    await sleep(1600);
    const pool = state.incidents.filter(i => i.status === "resolved" && i.root_cause);
    const ranked = pool
        .map(i => ({ inc: i, s: scoreMatch(input, i) }))
        .filter(x => x.s > 0.08)
        .sort((x, y) => y.s - x.s)
        .slice(0, 3);

    const matches = ranked.map(x => ({
        id: x.inc.id,
        service: x.inc.service,
        similarity: Math.round(Math.min(97, 58 + x.s * 60)),
        summary: x.inc.error + " — " + x.inc.root_cause + ".",
        root_cause: x.inc.root_cause,
        resolution: x.inc.resolution
    }));

    if (!matches.length) {
        return { matches: [], root_cause: "", confidence: 0, steps: [] };
    }

    // root cause = vote weighted by similarity
    const votes = {};
    matches.forEach(m => { votes[m.root_cause] = (votes[m.root_cause] || 0) + m.similarity; });
    const root = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
    const best = matches.find(m => m.root_cause === root);
    const agree = matches.filter(m => m.root_cause === root).length;

    return {
        root_cause: root,
        confidence: Math.round(Math.min(96, best.similarity - 4 + agree * 2)),
        matches,
        steps: [
            { title: "Confirm the suspected cause", detail: "Check dashboards and logs for signs of “" + root.toLowerCase() + "” on " + (input.service || "the service") + "." },
            { title: "Review recent changes", detail: "Look at deploys, config pushes and traffic changes shortly before the incident started." },
            { title: "Apply the fix that worked before", detail: best.id + ": " + best.resolution + "." }
        ]
    };
}

/* =========================================
   API LAYER (real backend with demo fallback)
========================================= */

async function api(path, options) {
    if (!state.apiUrl) throw new Error("demo");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
        const res = await fetch(state.apiUrl + path, Object.assign({
            headers: { "Content-Type": "application/json" },
            signal: ctrl.signal
        }, options));
        if (!res.ok) throw new Error("HTTP " + res.status);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

/* Accept a few reasonable response shapes so small backend differences don't break the UI */
function normalizeIncident(r) {
    return {
        id: r.id || r.incident_id || "INC-???",
        service: r.service || "Unknown",
        error: r.error || r.title || r.problem || "",
        severity: r.severity || "Medium",
        status: String(r.status || (r.root_cause ? "resolved" : "investigating")).toLowerCase(),
        root_cause: r.root_cause || r.rootCause || "",
        resolution: r.resolution || "",
        created_at: r.created_at || r.timestamp || new Date().toISOString(),
        resolution_minutes: Number(r.resolution_minutes || r.mttr || 0),
        symptoms: r.symptoms || ""
    };
}

function normalizeAnalysis(r) {
    const matches = (r.matches || r.similar_incidents || r.memories || []).map(m => {
        let sim = Number(m.similarity != null ? m.similarity : (m.score != null ? m.score : 0));
        if (sim <= 1) sim = sim * 100;
        return {
            id: m.id || m.incident_id || "INC-???",
            service: m.service || "",
            similarity: Math.round(sim),
            summary: m.summary || m.description || m.text || "",
            root_cause: m.root_cause || "",
            resolution: m.resolution || ""
        };
    });
    let conf = Number(r.confidence != null ? r.confidence : 0);
    if (conf <= 1) conf = conf * 100;
    const steps = (r.steps || r.recommended_steps || []).map(s =>
        typeof s === "string" ? { title: s, detail: "" }
            : { title: s.title || s.step || "", detail: s.detail || s.description || "" });
    return {
        incident_id: r.incident_id || r.id || null,
        root_cause: r.root_cause || r.likely_root_cause || "",
        confidence: Math.round(conf),
        matches, steps,
        ai_analysis: r.ai_analysis || r.analysis || "",
        hindsight_used: !!r.hindsight_used
    };
}

async function fetchIncidents() {
    try {
        const data = await api(ENDPOINTS.incidents);
        const list = Array.isArray(data) ? data : (data.incidents || []);
        state.incidents = list.map(normalizeIncident);
        setBackend(true);
    } catch (e) {
        state.incidents = loadDemoIncidents();
        setBackend(false);
    }
}

async function checkHealth() {
    if (!state.apiUrl) { setBackend(false); return; }
    try { await api(ENDPOINTS.health); setBackend(true); }
    catch (e) { setBackend(false); }
}

function setBackend(online) {
    state.backendOnline = online;
    const live = online && !!state.apiUrl;
    const dot = $("backendDot");
    dot.style.background = live ? "var(--green)" : "var(--orange)";
    dot.style.boxShadow = "0 0 8px " + (live ? "var(--green)" : "var(--orange)");
    $("backendStatusText").textContent = live ? "Connected to backend" : "Demo mode";
    $("backendStatusText").style.color = live ? "var(--green)" : "var(--orange)";
    $("systemStatusText").textContent = live ? "All systems operational" : "Demo mode · local memory";
}

/* =========================================
   RENDERING
========================================= */

function stats() {
    const list = state.incidents;
    const resolved = list.filter(i => i.status === "resolved");
    const causes = {};
    resolved.forEach(i => { if (i.root_cause) causes[i.root_cause] = (causes[i.root_cause] || 0) + 1; });
    const services = new Set(list.map(i => i.service));
    const timed = resolved.filter(i => i.resolution_minutes > 0);
    const avg = timed.length ? Math.round(timed.reduce((a, i) => a + i.resolution_minutes, 0) / timed.length) : 0;
    const recent = list.filter(i => (Date.now() - new Date(i.created_at).getTime()) < 30 * 86400000).length;
    const sorted = Object.entries(causes).sort((a, b) => b[1] - a[1]);
    return { list, resolved, causes: sorted, services, avg, recent };
}

function renderAll() {
    renderDashboard();
    renderHistory();
    renderMemory();
    renderServiceList();
    renderLearning();
}

function renderDashboard() {
    const s = stats();
    const total = s.list.length;

    $("statTotal").textContent = total;
    $("statTotalSub").textContent = s.recent + " in the last 30 days";
    $("statCauses").textContent = s.causes.length;
    $("statCausesSub").textContent = "Across " + s.services.size + " services";
    $("statResolved").textContent = s.resolved.length;
    $("statResolvedSub").textContent = total ? (Math.round(s.resolved.length / total * 1000) / 10) + "% resolution rate" : "–";
    $("statAvg").textContent = s.avg ? s.avg + "m" : "–";
    $("statAvgSub").textContent = "Mean time to resolve";

    const recentRows = s.list.slice().sort(byDateDesc).slice(0, 4).map(i => `
        <div class="table-row">
            <div class="incident-name"><strong>${esc(i.id)}</strong><small>${esc(i.error)}</small></div>
            <span>${esc(i.service)}</span>
            <span class="badge ${sevClass(i.severity)}">${esc(String(i.severity).toUpperCase())}</span>
            <span class="status ${i.status}">${statusLabel(i.status)}</span>
        </div>`).join("");
    $("recentRows").innerHTML = recentRows || `<p class="empty-line">No incidents yet.</p>`;

    $("memSimilar").textContent = Math.max(0, s.resolved.length * 3);
    $("memSuccess").textContent = s.resolved.length;
    $("memPatterns").textContent = s.causes.filter(c => c[1] > 1).length;

    if (s.causes.length) {
        $("topPattern").textContent = s.causes[0][0];
        $("topPatternSub").textContent = "Detected across " + s.causes[0][1] + " incidents";
    } else {
        $("topPattern").textContent = "No patterns yet";
        $("topPatternSub").textContent = "Resolve incidents to build memory";
    }

    $("sidebarCount").textContent = total + " incidents remembered";
    $("sidebarBar").style.width = Math.min(100, 20 + total * 4) + "%";
}

function byDateDesc(a, b) { return new Date(b.created_at) - new Date(a.created_at); }

function renderHistory() {
    const q = ($("historySearch").value || "").toLowerCase().trim();
    const f = $("historyFilter").value;
    const rows = state.incidents.slice().sort(byDateDesc).filter(i => {
        if (f !== "all" && i.status !== f) return false;
        if (!q) return true;
        return [i.id, i.service, i.error, i.root_cause, i.resolution, i.severity]
            .join(" ").toLowerCase().includes(q);
    });

    $("historyList").innerHTML = rows.map(i => `
        <div class="history-item">
            <div class="history-id">${esc(i.id)}</div>
            <div class="history-details">
                <strong>${esc(i.error)}</strong>
                <span>${esc(i.service)} • ${esc(i.severity)} • ${statusLabel(i.status)}</span>
                ${i.root_cause ? `<em class="history-cause">Root cause: ${esc(i.root_cause)}</em>` : ""}
            </div>
            <div class="history-date">${esc(relativeDate(i.created_at))}</div>
        </div>`).join("") || `<p class="empty-line">No incidents match your search.</p>`;
}

function renderMemory() {
    const s = stats();
    $("memBig").textContent = s.list.length;
    $("memBigBar").style.width = Math.min(100, 20 + s.list.length * 4) + "%";
    const max = s.causes.length ? s.causes[0][1] : 1;
    $("causeList").innerHTML = s.causes.slice(0, 8).map(([name, n]) => `
        <div class="cause cause-bar">
            <span>${esc(name)}</span>
            <strong>${n}</strong>
            <i style="width:${Math.round(n / max * 100)}%"></i>
        </div>`).join("") || `<p class="empty-line">No root causes recorded yet.</p>`;
}

function renderServiceList() {
    const names = Array.from(new Set(state.incidents.map(i => i.service))).sort();
    $("serviceList").innerHTML = names.map(n => `<option value="${esc(n)}">`).join("");
}

function renderAnalysis(result) {
    const box = $("analysisResult");
    if (!result.matches.length) {
        box.innerHTML = `
            <div class="panel no-match">
                <p class="eyebrow">HINDSIGHT RECALL</p>
                <h3>No similar incidents in memory yet</h3>
                <p>This looks new. Investigate it, then mark it resolved so RecallOps remembers it next time.</p>
                <button class="resolve-button" onclick="openResolveModal()">✓ Mark Incident as Resolved</button>
            </div>`;
        return;
    }

    const matchHtml = result.matches.map(m => `
        <div class="similar-incident">
            <div><strong>${esc(m.id)}</strong><span>${esc(m.service)}</span></div>
            <div class="similarity">${m.similarity}% match</div>
            <p>${esc(m.summary)}</p>
            ${m.resolution ? `<p class="past-fix"><b>Fix then:</b> ${esc(m.resolution)}</p>` : ""}
        </div>`).join("");

    const stepHtml = result.steps.map((st, i) => `
        <div class="step">
            <span>${i + 1}</span>
            <div><strong>${esc(st.title)}</strong>${st.detail ? `<p>${esc(st.detail)}</p>` : ""}</div>
        </div>`).join("");

    box.innerHTML = `
        <div class="panel">
            <div class="analysis-title">
                <div>
                    <p class="eyebrow">HINDSIGHT RECALL</p>
                    <h3>Historical Memory Found</h3>
                </div>
                <span class="match-count">${result.matches.length} match${result.matches.length > 1 ? "es" : ""}</span>
            </div>
            ${matchHtml}
        </div>

        <div class="panel ai-recommendation">
            <div class="ai-header">
                <div class="ai-icon">✦</div>
                <div>
                    <p class="eyebrow">RECALL OPS ANALYSIS</p>
                    <h3>Recommended Investigation</h3>
                </div>
            </div>

            <div class="root-cause">
                <span>LIKELY ROOT CAUSE${result.confidence ? " · " + result.confidence + "% CONFIDENCE" : ""}</span>
                <strong>${esc(result.root_cause || "Undetermined")}</strong>
                ${result.confidence ? `<div class="confidence-bar"><i style="width:${result.confidence}%"></i></div>` : ""}
            </div>

            <div class="steps">${stepHtml}</div>
            ${result.ai_analysis ? `<div class="ai-evidence"><div class="ai-evidence-title">✦ Hindsight AI reasoning</div><p>${esc(result.ai_analysis)}</p></div>` : ""}

            <button class="resolve-button" onclick="openResolveModal()">✓ Mark Incident as Resolved</button>
        </div>`;
}


/* =========================================
   LEARNING INTELLIGENCE
========================================= */

const LEARNING_KEY = "recallops_learning_v2";

function learningState() {
    try {
        const saved = JSON.parse(safeGet(LEARNING_KEY) || "{}");
        return Object.assign({
            analyses: 0,
            recalls: 0,
            resolutions: 0,
            events: []
        }, saved);
    } catch (e) {
        return { analyses: 0, recalls: 0, resolutions: 0, events: [] };
    }
}

function saveLearning(s) {
    safeSet(LEARNING_KEY, JSON.stringify(s));
}

function learningDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function recordLearning(type) {
    const s = learningState();

    if (type === "analysis") s.analyses += 1;
    if (type === "recall") s.recalls += 1;
    if (type === "resolution") s.resolutions += 1;

    s.events.push({
        type,
        date: learningDateKey(),
        at: Date.now()
    });

    s.events = s.events.slice(-250);
    saveLearning(s);
    renderLearning();
}

function learningStreak(events) {
    const dates = new Set((events || []).map(e => e.date));
    let streak = 0;
    const cursor = new Date();

    while (true) {
        const key = learningDateKey(cursor);
        if (!dates.has(key)) break;
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
}

function learningMetrics() {
    const l = learningState();
    const s = stats();

    const total = s.list.length;
    const resolved = s.resolved.length;
    const causes = s.causes.length;

    const resolutionCoverage = total ? (resolved / total) * 100 : 0;
    const causeCoverage = resolved ? Math.min(100, (causes / resolved) * 100) : 0;
    const reuseCoverage = l.analyses ? Math.min(100, (l.recalls / l.analyses) * 100) : 0;
    const volumeCoverage = Math.min(100, (resolved / 20) * 100);

    const score = Math.round(
        resolutionCoverage * 0.30 +
        causeCoverage * 0.20 +
        reuseCoverage * 0.30 +
        volumeCoverage * 0.20
    );

    return {
        state: l,
        stats: s,
        score: Math.min(100, score),
        streak: learningStreak(l.events)
    };
}

function renderLearning() {
    const scoreEl = $("learningScore");
    if (!scoreEl) return;

    const m = learningMetrics();
    const { state: l, stats: s } = m;

    const score = m.score;
    const fill = $("learningProgressFill");
    const text = $("learningProgressText");

    scoreEl.textContent = score + "%";
    if (fill) fill.style.width = score + "%";

    if (text) {
        if (score < 25) text.textContent = "Starting the organizational memory journey.";
        else if (score < 50) text.textContent = "RecallOps is building reusable incident knowledge.";
        else if (score < 75) text.textContent = "The team is building a strong operational memory.";
        else text.textContent = "Mature learning loop — experience is becoming reusable knowledge.";
    }

    const kc = $("knowledgeCaptured");
    const rr = $("resolutionsReused");
    const pf = $("patternsFound");

    if (kc) kc.textContent = s.resolved.length;
    if (rr) rr.textContent = l.recalls;
    if (pf) pf.textContent = s.causes.filter(c => c[1] > 1).length;

    const streak = $("learningStreak");
    const streakFill = $("streakFill");
    const streakMessage = $("streakMessage");

    if (streak) streak.textContent = m.streak;
    if (streakFill) streakFill.style.width = Math.min(100, (m.streak / 7) * 100) + "%";

    if (streakMessage) {
        if (m.streak >= 7) streakMessage.textContent = "7-day learning streak achieved.";
        else if (m.streak > 0) streakMessage.textContent = (7 - m.streak) + " more day(s) to reach 7 days.";
        else streakMessage.textContent = "Resolve or analyze an incident to start your streak.";
    }

    renderPulse(l.events);
    renderMilestones(m);
    renderNextGoal(m);
}

function renderPulse(events) {
    const chart = $("pulseChart");
    const total = $("pulseTotal");
    if (!chart) return;

    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push({
            key: d.toISOString().slice(0, 10),
            label: i === 0 ? "Today" : d.toLocaleDateString(undefined, { weekday: "short" })
        });
    }

    const counts = days.map(day =>
        (events || []).filter(e => e.date === day.key).length
    );

    const max = Math.max(1, ...counts);
    chart.innerHTML = days.map((day, i) => `
        <div class="pulse-day">
            <div class="pulse-bar-wrap">
                <span class="pulse-bar" style="height:${Math.max(12, Math.round(counts[i] / max * 100))}%"></span>
                <em>${counts[i]}</em>
            </div>
            <small>${esc(day.label)}</small>
        </div>
    `).join("");

    if (total) total.textContent = counts.reduce((a, b) => a + b, 0);
}

function renderMilestones(m) {
    const items = document.querySelectorAll(".milestone");
    let completed = 0;

    items.forEach(item => {
        const key = item.dataset.key;
        const target = Number(item.dataset.target || 1);

        let current = 0;

        if (key === "memory") current = m.stats.resolved.length;
        if (key === "resolutions") current = m.state.resolutions;
        if (key === "recalls") current = m.state.recalls;
        if (key === "events") current = m.state.events.length;

        const progress = Math.min(1, current / target);
        const bar = item.querySelector(".milestone-track i");
        const status = item.querySelector("b");

        if (bar) bar.style.width = (progress * 100) + "%";

        if (progress >= 1) {
            item.classList.add("completed");
            if (status) status.textContent = "✓";
            completed += 1;
        } else {
            item.classList.remove("completed");
            if (status) status.textContent = "○";
        }
    });

    const count = $("milestoneCount");
    if (count) count.textContent = completed + "/4";
}

function renderNextGoal(m) {
    const title = $("nextGoalTitle");
    const text = $("nextGoalText");
    const progress = $("goalProgress");
    const percent = $("goalPercent");

    if (!title) return;

    let current = 0;
    let target = 1;
    let t = "";
    let d = "";

    if (m.stats.resolved.length < 10) {
        current = m.stats.resolved.length;
        target = 10;
        t = "Capture 10 resolved incidents";
        d = "Turn successful fixes into durable organizational knowledge.";
    } else if (m.state.resolutions < 15) {
        current = m.state.resolutions;
        target = 15;
        t = "Build a 15-fix resolution library";
        d = "Keep capturing the exact fixes that worked in production.";
    } else if (m.state.recalls < 10) {
        current = m.state.recalls;
        target = 10;
        t = "Use memory in 10 analyses";
        d = "Let Hindsight connect more investigations to past experience.";
    } else {
        current = m.state.events.length;
        target = 25;
        t = "Reach 25 learning events";
        d = "Keep the incident → recall → resolve → learn loop active.";
    }

    const pct = Math.round(Math.min(1, current / target) * 100);
    title.textContent = t;
    text.textContent = d;
    if (progress) progress.style.width = pct + "%";
    if (percent) percent.textContent = pct + "%";
}

/* =========================================
   PAGE NAVIGATION
========================================= */

const PAGE_META = {
    dashboard: ["Incident Intelligence", "Workspace / Overview"],
    incident: ["Analyze Incident", "Workspace / New Incident"],
    history: ["Incident History", "Workspace / History"],
    memory: ["Organizational Memory", "Workspace / Memory"],
    learning: ["Learning Intelligence", "Workspace / Learning"],
    settings: ["Settings", "System / Settings"]
};

function showPage(pageId) {
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active-page"));
    const page = $(pageId);
    if (page) page.classList.add("active-page");

    document.querySelectorAll(".nav-item").forEach(n =>
        n.classList.toggle("active", n.dataset.page === pageId));

    const meta = PAGE_META[pageId] || ["RecallOps AI", "Workspace"];
    $("pageTitle").textContent = meta[0];
    $("breadcrumb").textContent = meta[1];
    window.scrollTo({ top: 0 });
}

/* =========================================
   INCIDENT ANALYSIS
========================================= */

function readForm() {
    return {
        service: $("serviceInput").value.trim(),
        error: $("errorInput").value.trim(),
        severity: $("severityInput").value,
        symptoms: $("symptomsInput").value.trim()
    };
}

function validate(input) {
    const checks = { service: !!input.service, error: !!input.error, symptoms: !!input.symptoms };
    Object.keys(checks).forEach(k => $("err-" + k).classList.toggle("hidden", checks[k]));
    if (!checks.service) $("serviceInput").focus();
    else if (!checks.error) $("errorInput").focus();
    else if (!checks.symptoms) $("symptomsInput").focus();
    return checks.service && checks.error && checks.symptoms;
}

function loadSample() {
    $("serviceInput").value = "Payment API";
    $("errorInput").value = "HTTP 503 errors";
    $("severityInput").value = "High";
    $("symptomsInput").value = "Checkout requests failing with 503 after a traffic spike. Database connections look maxed out and requests are queuing.";
    ["service", "error", "symptoms"].forEach(k => $("err-" + k).classList.add("hidden"));
}

let analyzing = false;

async function analyzeIncident() {
    if (analyzing) return;
    const input = readForm();
    if (!validate(input)) return;

    analyzing = true;
    const btn = $("analyzeBtn");
    btn.disabled = true;
    btn.classList.add("busy");

    $("analysisEmpty").classList.add("hidden");
    $("analysisResult").classList.add("hidden");
    $("analysisLoading").classList.remove("hidden");
    animateLoadingSteps();

    try {
        let result;
        try {
            result = normalizeAnalysis(await api(ENDPOINTS.analyze, { method: "POST", body: JSON.stringify(input) }));
            setBackend(true);
        } catch (e) {
            if (state.apiUrl) toast("Backend unreachable — showing demo analysis", "warn");
            result = await demoAnalyze(input);
            if (state.apiUrl) setBackend(false);
        }

        state.lastAnalysis = { input, result };
        renderAnalysis(result);

        recordLearning("analysis");
        if (result.matches && result.matches.length) recordLearning("recall");

        $("analysisLoading").classList.add("hidden");
        $("analysisResult").classList.remove("hidden");
        setTimeout(() => $("analysisResult").scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } finally {
        analyzing = false;
        btn.disabled = false;
        btn.classList.remove("busy");
    }
}

function animateLoadingSteps() {
    const items = Array.from(document.querySelectorAll("#loadingSteps li"));
    items.forEach(li => li.className = "");
    items.forEach((li, i) => {
        setTimeout(() => { if (analyzing) li.className = "active"; }, i * 380);
        setTimeout(() => { if (analyzing) li.className = "done"; }, i * 380 + 380);
    });
}

/* =========================================
   RESOLVE FLOW (the memory loop)
========================================= */

function openResolveModal() {
    if (!state.lastAnalysis) return;
    $("rootCauseInput").value = state.lastAnalysis.result.root_cause || "";
    $("resolutionInput").value = "";
    $("resolveModal").classList.remove("hidden");
    setTimeout(() => $("resolutionInput").focus(), 50);
}

function closeResolveModal() { $("resolveModal").classList.add("hidden"); }

function nextIncidentId() {
    const nums = state.incidents.map(i => parseInt(String(i.id).replace(/\D/g, ""), 10)).filter(n => !isNaN(n));
    const n = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
    return "INC-" + String(n).padStart(3, "0");
}

async function submitResolution() {
    const root = $("rootCauseInput").value.trim();
    const fix = $("resolutionInput").value.trim();
    if (!root || !fix) { toast("Add the root cause and what fixed it.", "warn"); return; }

    const { input, result } = state.lastAnalysis;
    const payload = Object.assign({}, input, {
        incident_id: result.incident_id, root_cause: root, resolution: fix
    });

    let savedRemotely = false;
    try {
        await api(ENDPOINTS.resolve, { method: "POST", body: JSON.stringify(payload) });
        savedRemotely = true;
    } catch (e) {
        if (state.apiUrl) toast("Backend unreachable — saved locally in demo memory", "warn");
    }

    if (savedRemotely) {
        await fetchIncidents();
    } else {
        const rec = {
            id: result.incident_id || nextIncidentId(),
            service: input.service, error: input.error, severity: input.severity,
            symptoms: input.symptoms, status: "resolved", root_cause: root, resolution: fix,
            created_at: new Date().toISOString(),
            resolution_minutes: 12
        };
        state.incidents.push(rec);
        saveDemoIncidents(state.incidents);
    }

    closeResolveModal();
    renderAll();
    recordLearning("resolution");

    const btn = document.querySelector("#analysisResult .resolve-button");
    if (btn) {
        btn.textContent = "✓ Resolution captured — learning stored";
        btn.classList.add("done");
        btn.disabled = true;
    }
    toast("Stored in Hindsight. The next similar incident will recall this fix.", "success");
    state.lastAnalysis = null;
}

/* =========================================
   SETTINGS
========================================= */

async function saveSettings() {
    const url = $("apiUrlInput").value.trim().replace(/\/$/, "");
    state.apiUrl = url;
    if (url) safeSet(API_KEY, url); else safeDel(API_KEY);
    await checkHealth();
    await fetchIncidents();
    renderAll();
    if (state.apiUrl && state.backendOnline) toast("Connected to backend.", "success");
    else if (state.apiUrl) toast("Could not reach the backend. Running in demo mode.", "warn");
    else toast("Demo mode enabled.", "info");
}

function resetDemoData() {
    safeDel(STORE_KEY);
    safeDel(LEARNING_KEY);
    if (!state.apiUrl) state.incidents = loadDemoIncidents();
    renderAll();
    toast("Demo data and learning progress reset.", "info");
}

/* =========================================
   INIT
========================================= */

document.addEventListener("DOMContentLoaded", async function () {
    $("apiUrlInput").value = state.apiUrl;
    $("historySearch").addEventListener("input", renderHistory);
    $("historyFilter").addEventListener("change", renderHistory);

    ["service", "error", "symptoms"].forEach(k => {
        $(k + "Input").addEventListener("input", () => $("err-" + k).classList.add("hidden"));
    });

    document.addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && $("incident").classList.contains("active-page")) analyzeIncident();
        if (e.key === "Escape") closeResolveModal();
    });

    await fetchIncidents();
    renderAll();
});
