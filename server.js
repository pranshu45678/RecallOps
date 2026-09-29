import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HindsightClient } from "@vectorize-io/hindsight-client";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), ".env") });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const BANK_ID = process.env.HINDSIGHT_BANK_ID || "recallops-ai";
const DATA_FILE = path.join(__dirname, "data", "incidents.json");
const FRONTEND_DIR = path.resolve(__dirname, "..");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

let hindsight = null;
let hindsightReady = false;
let incidents = [];

async function loadIncidents() {
  try { incidents = JSON.parse(await fs.readFile(DATA_FILE, "utf8")); }
  catch { incidents = []; }
}
async function saveIncidents() {
  await fs.writeFile(DATA_FILE, JSON.stringify(incidents, null, 2));
}

async function initHindsight() {
  const key = process.env.HINDSIGHT_API_KEY;
  if (!key || key === "YOUR_HINDSIGHT_API_KEY") {
    console.log("Hindsight API key not configured. Backend will use local incident data.");
    return;
  }
  hindsight = new HindsightClient({
    baseUrl: process.env.HINDSIGHT_BASE_URL || "https://api.hindsight.vectorize.io",
    apiKey: key
  });
  try {
    await hindsight.createBank(BANK_ID, {
      name: "RecallOps AI",
      background: "Organizational memory for production incident response, root causes and successful resolutions."
    });
    console.log(`Hindsight memory bank created: ${BANK_ID}`);
  } catch (e) {
    console.log(`Hindsight bank ready/exists: ${BANK_ID}`);
  }
  hindsightReady = true;
}

function nextIncidentId() {
  const nums = incidents.map(i => Number(String(i.id).replace(/\D/g, ""))).filter(Number.isFinite);
  return `INC-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0")}`;
}
function tokens(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(x => x.length > 2);
}
function localSimilarity(input, inc) {
  const a = new Set(tokens(`${input.service} ${input.error} ${input.symptoms}`));
  const b = new Set(tokens(`${inc.service} ${inc.error} ${inc.symptoms} ${inc.root_cause}`));
  let hit = 0; for (const x of a) if (b.has(x)) hit++;
  let score = a.size && b.size ? hit / Math.sqrt(a.size * b.size) : 0;
  if (String(input.service).toLowerCase() === String(inc.service).toLowerCase()) score += .2;
  return Math.min(1, score);
}
function localMatches(input) {
  return incidents.filter(i => i.status === "resolved" && i.root_cause)
    .map(i => ({i, score: localSimilarity(input, i)})).filter(x => x.score > .08)
    .sort((a,b) => b.score-a.score).slice(0,5)
    .map(x => ({ id:x.i.id, service:x.i.service, similarity:Math.round(Math.min(97,58+x.score*60)), summary:`${x.i.error} — ${x.i.root_cause}.`, root_cause:x.i.root_cause, resolution:x.i.resolution }));
}
function localStructured(input, matches, aiText="") {
  if (!matches.length) return { root_cause:"", confidence:0, matches:[], steps:[], ai_analysis:aiText };
  const votes={}; for(const m of matches) votes[m.root_cause]=(votes[m.root_cause]||0)+m.similarity;
  const root=Object.entries(votes).sort((a,b)=>b[1]-a[1])[0][0];
  const best=matches.find(m=>m.root_cause===root);
  const agree=matches.filter(m=>m.root_cause===root).length;
  return { root_cause:root, confidence:Math.round(Math.min(96,best.similarity-4+agree*2)), matches,
    steps:[
      {title:"Confirm the suspected cause",detail:`Check dashboards and logs for signs of “${root.toLowerCase()}” on ${input.service}.`},
      {title:"Review recent changes",detail:"Check deploys, configuration changes, traffic and dependency health immediately before the incident."},
      {title:"Use the proven resolution",detail:`${best.id}: ${best.resolution}.`}
    ], ai_analysis:aiText };
}

app.get("/api/health", (req,res)=>res.json({success:true,status:"ok",hindsight:hindsightReady,bank_id:BANK_ID}));
app.get("/api/incidents", (req,res)=>res.json({incidents}));
app.get("/api/memory/stats", (req,res)=>{
  const resolved=incidents.filter(i=>i.status==="resolved");
  const causes={}; for(const i of resolved) if(i.root_cause) causes[i.root_cause]=(causes[i.root_cause]||0)+1;
  res.json({total:incidents.length,resolved:resolved.length,root_causes:Object.entries(causes).sort((a,b)=>b[1]-a[1]),hindsight:hindsightReady});
});

app.post("/api/analyze", async (req,res)=>{
  const input=req.body||{};
  if(!input.service||!input.error||!input.symptoms) return res.status(400).json({error:"service, error and symptoms are required"});
  const matches=localMatches(input);
  let aiText="";
  if(hindsightReady) {
    try {
      const recalled=await hindsight.recall(BANK_ID, `Production incident. Service: ${input.service}. Error: ${input.error}. Severity: ${input.severity}. Symptoms: ${input.symptoms}. Find similar incidents, root causes and successful fixes.`, {limit:5});
      const memories=(recalled.results||[]).map(m=>m.text).filter(Boolean);
      const response=await hindsight.reflect(BANK_ID, `You are RecallOps, an incident-response assistant. Analyze this production incident using organizational memory. Incident: service=${input.service}; error=${input.error}; severity=${input.severity}; symptoms=${input.symptoms}. Give a concise diagnosis, evidence from past incidents, recommended investigation steps, and the safest previously successful resolution. Clearly separate evidence from inference. Memory retrieved: ${memories.join("\n---\n")}`);
      aiText=response?.text||"";
    } catch(e) { console.error("Hindsight analyze error:",e.message); }
  }
  const result=localStructured(input,matches,aiText);
  result.hindsight_used=hindsightReady;
  res.json(result);
});

app.post("/api/resolve", async (req,res)=>{
  const body=req.body||{};
  if(!body.service||!body.root_cause||!body.resolution) return res.status(400).json({error:"service, root_cause and resolution are required"});
  const incident={id:body.incident_id||nextIncidentId(),service:body.service,error:body.error||"",severity:body.severity||"Medium",status:"resolved",root_cause:body.root_cause,resolution:body.resolution,created_at:new Date().toISOString(),resolution_minutes:Number(body.resolution_minutes||12),symptoms:body.symptoms||""};
  const idx=incidents.findIndex(i=>i.id===incident.id);
  if(idx>=0) incidents[idx]=incident; else incidents.unshift(incident);
  await saveIncidents();
  if(hindsightReady) {
    try {
      await hindsight.retain(BANK_ID, `Resolved production incident ${incident.id}. Service: ${incident.service}. Error: ${incident.error}. Severity: ${incident.severity}. Symptoms: ${incident.symptoms}. Root cause: ${incident.root_cause}. Successful resolution: ${incident.resolution}. This is an organizational learning for future incident response.`, {context:"RecallOps incident resolution", timestamp:new Date()});
    } catch(e) { console.error("Hindsight retain error:",e.message); }
  }
  res.json({success:true,incident,hindsight_stored:hindsightReady});
});

app.get("/api/memory", async (req,res)=>{
  const query=String(req.query.query||"").trim();
  if(!query) return res.status(400).json({error:"query is required"});
  if(hindsightReady) {
    try { const r=await hindsight.recall(BANK_ID,query,{limit:10}); return res.json({success:true,memories:r.results||[],hindsight:true}); }
    catch(e) { console.error(e.message); }
  }
  const fake=incidents.filter(i=>`${i.service} ${i.error} ${i.symptoms} ${i.root_cause} ${i.resolution}`.toLowerCase().includes(query.toLowerCase()));
  res.json({success:true,memories:fake.map(i=>({text:`${i.id}: ${i.service} — ${i.error}. Root cause: ${i.root_cause}. Resolution: ${i.resolution}`})),hindsight:false});
});

// Serve the existing frontend from the parent project folder.
app.use(express.static(FRONTEND_DIR));
app.get("/", (req,res)=>res.sendFile(path.join(FRONTEND_DIR,"index.html")));

await loadIncidents();
await initHindsight();
app.listen(PORT,()=>console.log(`RecallOps AI running at http://localhost:${PORT}`));
