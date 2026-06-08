#!/usr/bin/env bun
// @bun
var A=import.meta.require;import{readFileSync as V,writeFileSync as J,existsSync as G,renameSync as it,unlinkSync as Se}from"fs";import{randomUUID as Re}from"crypto";import{existsSync as Ge,mkdirSync as ce,readFileSync as Ve,writeFileSync as Qe}from"fs";import{homedir as ye}from"os";import{dirname as Ze,join as k,resolve as et}from"path";var tt=k(".hasna","apps","knowledge");function ue(){return k(ye(),".open-knowledge","db.json")}function de(){return k(ye(),".hasna","apps","knowledge")}function nt(e=process.cwd()){return et(e,tt)}function B(e){return{home:e,configPath:k(e,"config.json"),jsonStorePath:k(e,"db.json"),knowledgeDbPath:k(e,"knowledge.db"),artifactsDir:k(e,"artifacts"),cacheDir:k(e,"cache"),exportsDir:k(e,"exports"),indexesDir:k(e,"indexes"),logsDir:k(e,"logs"),runsDir:k(e,"runs"),schemasDir:k(e,"schemas"),wikiDir:k(e,"wiki")}}function rt(){return{version:1,mode:"local",storage:{type:"local",artifacts_root:"artifacts"},sources:{preferred_ref:"open-files",allowed_schemes:["open-files","s3","file","https","http"]},safety:{network:{web_search_enabled:!1,s3_reads_enabled:!1,allowed_s3_buckets:[]},redaction:{enabled:!0},approvals:{generated_writes_require_approval:!0}}}}function me(e){let t=B(e);ce(t.home,{recursive:!0});for(let n of[t.artifactsDir,t.cacheDir,t.exportsDir,t.indexesDir,t.logsDir,t.runsDir,t.schemasDir,t.wikiDir])ce(n,{recursive:!0});if(!Ge(t.configPath))Qe(t.configPath,`${JSON.stringify(rt(),null,2)}
`);return t}function be(e,t=process.cwd()){if(e==="project"||e==="local")return B(nt(t));return B(de())}function Y(e){ce(Ze(e),{recursive:!0})}function we(e){let t=Ve(e,"utf8");return JSON.parse(t)}function le(){return B(de()).jsonStorePath}function fe(e){if(!G(e))if(Y(e),e===le()&&G(ue()))J(e,V(ue(),"utf8"));else J(e,JSON.stringify({items:[]},null,2))}function st(e){return`${e}.lock`}function ot(e,t){let i=Date.now();while(Date.now()-i<5000){try{if(!G(e)){J(e,JSON.stringify({owner:t,ts:Date.now()}));return}let l=JSON.parse(V(e,"utf8"));if(Date.now()-l.ts>1e4)Se(e)}catch{}let s=Date.now();while(Date.now()-s<50);}throw Error(`Could not acquire lock on ${e} after 5000ms`)}function at(e,t){try{if(G(e)){if(JSON.parse(V(e,"utf8")).owner===t)Se(e)}}catch{}}function x(e){fe(e);let t=V(e,"utf8"),n=JSON.parse(t);if(!n||!Array.isArray(n.items))return{items:[]};return n}function D(e,t){let n=`${e}.tmp.${Re()}`;J(n,JSON.stringify(t,null,2)),it(n,e)}function O(e,t){let n=Re(),r=st(e);ot(r,n);try{return t()}finally{at(r,n)}}function _e(){return`k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`}function ke(e){return e.replace(/^k_/,"").slice(0,12)}import{Database as ct}from"bun:sqlite";var ut=`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  acl_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_revisions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  hash TEXT,
  extracted_text_uri TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(source_id, revision)
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  source_revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
  wiki_page_id TEXT,
  kind TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  token_count INTEGER,
  start_offset INTEGER,
  end_offset INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(chunk_id, provider, model)
);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  artifact_uri TEXT,
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wiki_backlinks (
  from_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  to_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  label TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(from_page_id, to_page_id)
);

CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  wiki_page_id TEXT REFERENCES wiki_pages(id) ON DELETE CASCADE,
  chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL,
  source_uri TEXT NOT NULL,
  quote TEXT,
  start_offset INTEGER,
  end_offset INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_indexes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  artifact_uri TEXT,
  shard_key TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kind, name, shard_key)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  prompt TEXT,
  status TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  cost_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_usage (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redaction_findings (
  id TEXT PRIMARY KEY,
  source_uri TEXT,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  severity TEXT NOT NULL,
  finding_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS storage_objects (
  id TEXT PRIMARY KEY,
  artifact_uri TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  content_type TEXT,
  hash TEXT,
  size_bytes INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  title,
  source_uri,
  content='',
  tokenize='porter unicode61'
);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (1, datetime('now'));
`,dt=`
DROP TABLE IF EXISTS chunks_fts;

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  text,
  title,
  source_uri,
  tokenize='porter unicode61'
);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (2, datetime('now'));
`,lt=`
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  action TEXT NOT NULL,
  target_uri TEXT,
  decision TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_gates (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_uri TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  approved_by TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_events_target ON audit_events(target_uri);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_approval_gates_action ON approval_gates(action);
CREATE INDEX IF NOT EXISTS idx_approval_gates_status ON approval_gates(status);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (3, datetime('now'));
`;function C(e){Y(e);let t=new ct(e);return t.exec("PRAGMA foreign_keys = ON;"),t}function U(e){let t=C(e);try{if(t.exec(ut),Q(t)<2)t.exec(dt);if(Q(t)<3)t.exec(lt);return{path:e,schema_version:Q(t)}}finally{t.close()}}function Q(e){return e.query("SELECT MAX(version) AS version FROM schema_versions").get()?.version??0}function I(e,t){return e.query(`SELECT COUNT(*) AS n FROM ${t}`).get()?.n??0}function xe(e){let t=C(e);try{return{schema_version:Q(t),sources:I(t,"sources"),source_revisions:I(t,"source_revisions"),chunks:I(t,"chunks"),wiki_pages:I(t,"wiki_pages"),citations:I(t,"citations"),indexes:I(t,"knowledge_indexes"),runs:I(t,"runs"),run_events:I(t,"run_events"),redaction_findings:I(t,"redaction_findings"),audit_events:I(t,"audit_events"),approval_gates:I(t,"approval_gates")}}finally{t.close()}}import{existsSync as ft,mkdirSync as Oe,readFileSync as _t,writeFileSync as pt}from"fs";import{dirname as gt,join as pe,relative as Et,sep as ht}from"path";function z(e){let t=e.replace(/\\/g,"/").trim();if(!t||t.startsWith("/"))throw Error(`Invalid artifact key: ${e}`);let n=t.split("/").filter(Boolean);if(n.length===0||n.some((r)=>r==="."||r===".."))throw Error(`Invalid artifact key: ${e}`);return n.join("/")}function ge(e,t){let n=Et(e,t);if(n.startsWith("..")||n===".."||n.startsWith(`..${ht}`))throw Error(`Artifact path escapes root: ${t}`)}class Ne{root;type="local";canRead=!0;canWrite=!0;constructor(e){this.root=e;Oe(e,{recursive:!0})}async put(e){let t=z(e.key),n=pe(this.root,t);return ge(this.root,n),Oe(gt(n),{recursive:!0}),pt(n,e.body),{key:t,uri:`file://${n}`}}async getText(e){let t=z(e),n=pe(this.root,t);return ge(this.root,n),_t(n,"utf8")}async exists(e){let t=z(e),n=pe(this.root,t);return ge(this.root,n),ft(n)}}class ve{options;type="s3";canRead=!0;canWrite=!0;client;constructor(e){this.options=e;this.client=e.client}async getClient(){if(this.client)return this.client;let[{S3Client:e},{fromIni:t}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]);return this.client=new e({region:this.options.region,credentials:this.options.profile?t({profile:this.options.profile}):void 0,maxAttempts:this.options.max_attempts}),this.client}objectKey(e){let t=z(e),n=this.options.prefix?z(this.options.prefix):"";return n?`${n}/${t}`:t}async put(e){let[{PutObjectCommand:t},n]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e.key);return await n.send(new t({Bucket:this.options.bucket,Key:r,Body:e.body,ContentType:e.content_type,Metadata:e.metadata,ServerSideEncryption:this.options.server_side_encryption,SSEKMSKeyId:this.options.kms_key_id})),{key:r,uri:`s3://${this.options.bucket}/${r}`}}async getText(e){let[{GetObjectCommand:t},n]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e),i=await n.send(new t({Bucket:this.options.bucket,Key:r}));if(!i.Body)return"";return await i.Body.transformToString()}async exists(e){let[{HeadObjectCommand:t},n]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e);try{return await n.send(new t({Bucket:this.options.bucket,Key:r})),!0}catch(i){let s=i instanceof Error?i.name:"";if(s==="NotFound"||s==="NoSuchKey"||s==="NotFoundError")return!1;throw i}}}function Le(e,t){if(e.storage.type==="s3"){if(!e.storage.s3?.bucket)throw Error("S3 artifact storage requires storage.s3.bucket");return new ve({bucket:e.storage.s3.bucket,prefix:e.storage.s3.prefix,region:e.storage.s3.region,profile:e.storage.s3.profile,max_attempts:e.storage.s3.max_attempts,server_side_encryption:e.storage.s3.server_side_encryption,kms_key_id:e.storage.s3.kms_key_id})}return new Ne(t.artifactsDir)}import{createHash as vt,randomUUID as Lt}from"crypto";import{existsSync as At,readFileSync as It}from"fs";import{basename as Dt}from"path";function Ae(e,t){if(!e)throw Error(t);return e}function Tt(e){let n=e.slice(13).split("/").filter(Boolean),r=n[0];if(r!=="file"&&r!=="source")throw Error("Invalid open-files ref. Expected open-files://file/<id>, open-files://file/<id>/revision/<revision_id>, or open-files://source/<id>/path/<path>.");let i=Ae(n[1],"Invalid open-files ref. Missing id.");if(r==="file"){if(n.length===2)return{kind:"open-files",uri:e,entity:r,id:i};if(n[2]==="revision"&&n[3]&&n.length===4)return{kind:"open-files",uri:e,entity:r,id:i,revision_id:decodeURIComponent(n[3])};throw Error("Invalid open-files file ref. Expected open-files://file/<id>/revision/<revision_id>.")}let s=n.indexOf("path"),l=s>=0?decodeURIComponent(n.slice(s+1).join("/")):void 0;return{kind:"open-files",uri:e,entity:r,id:i,path:l}}function yt(e){let t=new URL(e),n=Ae(t.hostname,"Invalid s3 ref. Missing bucket."),r=decodeURIComponent(t.pathname.replace(/^\/+/,""));if(!r)throw Error("Invalid s3 ref. Missing object key.");return{kind:"s3",uri:e,bucket:n,key:r}}function mt(e){let t=new URL(e);return{kind:"file",uri:e,path:decodeURIComponent(t.pathname)}}function bt(e){let t=new URL(e);return{kind:"web",uri:e,url:t.toString()}}function v(e){if(e.startsWith("open-files://"))return Tt(e);if(e.startsWith("s3://"))return yt(e);if(e.startsWith("file://"))return mt(e);if(e.startsWith("https://")||e.startsWith("http://"))return bt(e);throw Error(`Unsupported source ref scheme: ${e}`)}function Ie(e,t=v(e)){if(t.kind==="open-files"&&t.entity==="file"&&t.revision_id)return e.replace(/\/revision\/[^/]+$/,"");return e}function De(e){let t=v(e);return t.kind==="open-files"&&t.entity==="file"?t.revision_id??null:null}import{createHash as wt,randomUUID as Ee}from"crypto";import{relative as St,resolve as Ue,sep as Rt}from"path";function Ce(e){let t=process.env[e];return t==="1"||t==="true"||t==="yes"}function je(e,t){let n=e,r=new Set(n.safety?.network?.allowed_s3_buckets??[]);if(e.storage.type==="s3"&&e.storage.s3?.bucket)r.add(e.storage.s3.bucket);if(process.env.HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS)for(let i of process.env.HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS.split(",").map((s)=>s.trim()).filter(Boolean))r.add(i);return{mode:e.mode,allowWriteRoots:[t.home,t.artifactsDir,t.cacheDir,t.exportsDir,t.indexesDir,t.logsDir,t.runsDir,t.schemasDir,t.wikiDir].map((i)=>Ue(i)),readOnlySourceAccess:!0,network:{webSearchEnabled:n.safety?.network?.web_search_enabled??Ce("HASNA_KNOWLEDGE_WEB_SEARCH"),s3ReadsEnabled:n.safety?.network?.s3_reads_enabled??Ce("HASNA_KNOWLEDGE_ALLOW_S3_READS"),allowedS3Buckets:[...r].sort()},redaction:{enabled:n.safety?.redaction?.enabled??!0},approvals:{generatedWritesRequireApproval:n.safety?.approvals?.generated_writes_require_approval??!0}}}function kt(e,t){let n=St(e,t);return n===""||!n.startsWith("..")&&n!==".."&&!n.startsWith(`..${Rt}`)}function F(e,t){let n=Ue(e);if(!t.allowWriteRoots.some((r)=>kt(r,n)))throw Error(`Safety policy denied write outside .hasna/apps/knowledge: ${e}`)}function X(e,t){let r=new URL(e).hostname;if(!t.network.s3ReadsEnabled)throw Error("Safety policy denied S3 read. Set safety.network.s3_reads_enabled=true or HASNA_KNOWLEDGE_ALLOW_S3_READS=1.");if(!t.network.allowedS3Buckets.includes(r))throw Error(`Safety policy denied S3 bucket "${r}". Add it to safety.network.allowed_s3_buckets or HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS.`)}function Z(e){if(!e.network.webSearchEnabled)throw Error("Safety policy denied web search. Set safety.network.web_search_enabled=true or HASNA_KNOWLEDGE_WEB_SEARCH=1.")}var xt=[{type:"private_key_block",severity:"high",regex:/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,replacement:"[REDACTED:private_key_block]"},{type:"secret_assignment",severity:"high",regex:/\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"]?[^'"\s]{8,}/gi,replacement:"[REDACTED:secret_assignment]"},{type:"openai_api_key",severity:"high",regex:/\bsk-[A-Za-z0-9_-]{20,}\b/g,replacement:"[REDACTED:openai_api_key]"},{type:"anthropic_api_key",severity:"high",regex:/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,replacement:"[REDACTED:anthropic_api_key]"},{type:"aws_access_key_id",severity:"high",regex:/\bA(?:KIA|SIA)[A-Z0-9]{16}\b/g,replacement:"[REDACTED:aws_access_key_id]"}];function ee(e,t){if(t&&!t.redaction.enabled)return{text:e,findings:[]};let n=e,r=[];for(let i of xt)n=n.replace(i.regex,(s,...l)=>{let _=typeof l.at(-2)==="number"?l.at(-2):n.indexOf(s);return r.push({type:i.type,severity:i.severity,start:Math.max(0,_),end:Math.max(0,_+s.length)}),i.replacement});return{text:n,findings:r}}function Ot(e){return`audit_${wt("sha256").update(`${e.event_type}\x00${e.action}\x00${e.target_uri??""}\x00${e.created_at??""}\x00${JSON.stringify(e.metadata??{})}\x00${Ee()}`).digest("hex").slice(0,24)}`}function S(e,t){let n=t.created_at??new Date().toISOString(),r=Ot({...t,created_at:n});return e.run(`INSERT INTO audit_events (id, event_type, action, target_uri, decision, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,[r,t.event_type,t.action,t.target_uri??null,t.decision,JSON.stringify(t.metadata??{}),n]),r}function te(e,t){let n=t.created_at??new Date().toISOString();for(let r of t.findings)e.run(`INSERT INTO redaction_findings (id, source_uri, run_id, severity, finding_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,[`redact_${Ee()}`,t.source_uri??null,t.run_id??null,r.severity,r.type,JSON.stringify({...t.metadata??{},start:r.start,end:r.end}),n]);return t.findings.length}function Xe(e,t){let n=t.created_at??new Date().toISOString(),r=`approval_${Ee()}`;return e.run(`INSERT INTO approval_gates (id, action, target_uri, status, reason, approved_by, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,[r,t.action,t.target_uri??null,"approved",t.reason??null,t.approved_by??"local-cli",JSON.stringify(t.metadata??{}),n,n]),{id:r,status:"approved"}}function Nt(e,t,n){let r=e.query(`SELECT id FROM approval_gates
     WHERE action = ? AND status = 'approved' AND (target_uri IS NULL OR target_uri = ? OR ? IS NULL)
     ORDER BY updated_at DESC LIMIT 1`).get(t,n??null,n??null);return Boolean(r)}function Fe(e,t,n,r){let i=n==="generated_write"&&t.approvals.generatedWritesRequireApproval,s=!i||Nt(e,n,r);return{action:n,target_uri:r??null,approval_required:i,approved:s,decision:s?"allow":"requires_approval"}}function ne(e,t){return`${e}_${vt("sha256").update(t).digest("hex").slice(0,20)}`}function P(e){return e&&typeof e==="object"&&!Array.isArray(e)?e:void 0}function w(e){return typeof e==="string"&&e.length>0?e:void 0}function Ct(e){let t=w(e.source_ref)??w(e.source_uri)??w(e.uri);if(t)return t;let n=w(e.file_id);if(n){let s=w(e.revision_id)??w(e.revision),l=`open-files://file/${encodeURIComponent(n)}`;return s?`${l}/revision/${encodeURIComponent(s)}`:l}let r=w(e.source_id),i=w(e.path);if(r&&i)return`open-files://source/${encodeURIComponent(r)}/path/${encodeURIComponent(i)}`;throw Error("Outbox event is missing source_ref, file_id, or source_id/path.")}function Ut(e,t){if(t.kind==="open-files"&&t.entity==="file"&&t.revision_id)return e.replace(/\/revision\/[^/]+$/,"");return e}function jt(e){return w(e.hash)??w(e.checksum)??w(e.sha256)??null}function Xt(e,t,n){return w(e.revision_id)??w(e.revision)??w(e.version_id)??(t.kind==="open-files"?t.revision_id:void 0)??n??null}function Ft(e){return(w(e.event)??w(e.type)??w(e.action)??w(e.change_type)??"changed").toLowerCase()}function Kt(e){let t=w(e.path);return w(e.title)??w(e.name)??(t?Dt(t):null)}function Pt(e,t){let n=Ct(e),r=v(n),i=jt(e);return{raw:e,eventType:Ft(e),sourceRef:n,sourceUri:Ut(n,r),kind:r.kind,title:Kt(e),revision:Xt(e,r,i),hash:i,status:w(e.status)?.toLowerCase()??null,updatedAt:w(e.updated_at)??t,acl:e.permissions??e.acl??void 0}}function Wt(e){let t=e.trim();if(!t)return[];if(t.startsWith("[")){let n=JSON.parse(t);if(!Array.isArray(n))throw Error("Outbox array parse failed.");return n.map((r)=>{let i=P(r);if(!i)throw Error("Outbox array entries must be objects.");return i})}if(t.startsWith("{"))try{let n=JSON.parse(t),r=P(n);if(!r)throw Error("Outbox object parse failed.");if(Array.isArray(r.events))return r.events.map((i)=>{let s=P(i);if(!s)throw Error("Outbox events entries must be objects.");return s});if("source_ref"in r||"source_uri"in r||"file_id"in r)return[r]}catch(n){let r=t.split(/\r?\n/).filter((i)=>i.trim().length>0);if(r.length<=1)throw n;return r.map((i)=>{let s=P(JSON.parse(i));if(!s)throw Error("Outbox JSONL entries must be objects.");return s})}return t.split(/\r?\n/).filter((n)=>n.trim().length>0).map((n)=>{let r=P(JSON.parse(n));if(!r)throw Error("Outbox JSONL entries must be objects.");return r})}async function Mt(e,t,n){let r=new URL(e),i=r.hostname,s=decodeURIComponent(r.pathname.replace(/^\/+/,""));if(!i||!s)throw Error(`Invalid S3 outbox URI: ${e}`);if(n)X(e,n);let[{S3Client:l,GetObjectCommand:_},{fromIni:o}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]),c=t?.storage.type==="s3"&&t.storage.s3?.bucket===i?t.storage.s3:void 0,u=await new l({region:c?.region,credentials:c?.profile?o({profile:c.profile}):void 0,maxAttempts:c?.max_attempts}).send(new _({Bucket:i,Key:s}));if(!u.Body)return"";return await u.Body.transformToString()}async function $t(e,t,n){if(e.startsWith("s3://"))return Mt(e,t,n);if(!At(e))throw Error(`Outbox not found: ${e}`);return It(e,"utf8")}function Ke(e,t){let n={};if(e)try{n=P(JSON.parse(e))??{}}catch{n={}}return JSON.stringify({...n,...t})}function Bt(e,t,n){let r=ne("src",t.sourceUri);e.run(`INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       kind = excluded.kind,
       title = COALESCE(excluded.title, sources.title),
       updated_at = excluded.updated_at`,[r,t.sourceUri,t.kind,t.title,JSON.stringify({source_ref:t.sourceRef,source_uri:t.sourceUri,status:t.status,last_outbox_event:t.eventType}),JSON.stringify(t.acl??{}),n,t.updatedAt]);let i=e.query("SELECT id, metadata_json, acl_json FROM sources WHERE uri = ?").get(t.sourceUri);if(!i)throw Error(`Failed to upsert source for outbox event: ${t.sourceUri}`);let s={source_ref:t.sourceRef,source_uri:t.sourceUri,last_outbox_event:t.eventType,last_outbox_at:t.updatedAt};if(t.status)s.status=t.status;if(w(t.raw.path))s.path=t.raw.path;return e.run("UPDATE sources SET metadata_json = ?, acl_json = CASE WHEN ? IS NULL THEN acl_json ELSE ? END, updated_at = ? WHERE id = ?",[Ke(i.metadata_json,s),t.acl===void 0?null:JSON.stringify(t.acl),t.acl===void 0?null:JSON.stringify(t.acl),t.updatedAt,i.id]),i.id}function zt(e,t,n,r){if(!n.revision)return null;let i=ne("rev",`${t}\x00${n.revision}`),s={source_ref:n.sourceRef,source_uri:n.sourceUri,status:n.status,last_outbox_event:n.eventType,reindex_required:!0};return e.run(`INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, revision) DO UPDATE SET
       hash = COALESCE(excluded.hash, source_revisions.hash),
       metadata_json = excluded.metadata_json`,[i,t,n.revision,n.hash,w(n.raw.extracted_text_ref)??null,JSON.stringify(s),r]),e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").get(t,n.revision)?.id??null}function Ht(e,t,n){if(n.revision)return e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").all(t,n.revision).map((r)=>r.id);if(n.hash)return e.query("SELECT id FROM source_revisions WHERE source_id = ? AND hash = ?").all(t,n.hash).map((r)=>r.id);return e.query("SELECT id FROM source_revisions WHERE source_id = ?").all(t).map((r)=>r.id)}function qt(e,t){let n=e.query("SELECT id FROM chunks WHERE source_revision_id = ?").all(t),r=0;for(let s of n){let l=e.query("SELECT COUNT(*) AS n FROM chunk_embeddings WHERE chunk_id = ?").get(s.id);r+=l?.n??0,e.run("DELETE FROM chunk_embeddings WHERE chunk_id = ?",[s.id]),e.run("DELETE FROM chunks_fts WHERE chunk_id = ?",[s.id])}e.run("DELETE FROM chunks WHERE source_revision_id = ?",[t]);let i=e.query("SELECT metadata_json FROM source_revisions WHERE id = ?").get(t);return e.run("UPDATE source_revisions SET metadata_json = ? WHERE id = ?",[Ke(i?.metadata_json,{reindex_required:!0,invalidated_at:new Date().toISOString()}),t]),{chunksDeleted:n.length,embeddingsDeleted:r}}function Yt(e,t){return t==="deleted"||["delete","deleted","remove","removed"].includes(e)}function Jt(e){return["move","moved","rename","renamed","path_changed"].includes(e)}function Gt(e){return["permission","permissions","permission_changed","acl_changed"].includes(e)}async function Pe(e){let t=(e.now??new Date).toISOString();if(e.safetyPolicy)F(e.dbPath,e.safetyPolicy);U(e.dbPath);let n=await $t(e.input,e.config,e.safetyPolicy),r=Wt(n),i=C(e.dbPath),s=`run_${Lt()}`;try{return i.transaction(()=>{i.run(`INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,[s,"open-files-outbox",e.input,"completed","local","open-files-outbox",JSON.stringify({path:e.input,events:r.length}),t,t]);let l=new Set,_=new Set,o=0,c=0,a=0,u=0,f=0,d=0;return S(i,{event_type:"source_read",action:e.input.startsWith("s3://")?"s3_outbox_read":"local_outbox_read",target_uri:e.input,decision:"allow",metadata:{events:r.length,read_only:!0},created_at:t}),r.forEach((h,T)=>{let p=Pt(h,t),L=Bt(i,p,t);l.add(L);let b=zt(i,L,p,t);if(b)_.add(b);let R=Ht(i,L,p);for(let g of R){_.add(g);let N=qt(i,g);o+=N.chunksDeleted,c+=N.embeddingsDeleted,a+=1}if(Yt(p.eventType,p.status))u+=1;if(Jt(p.eventType))f+=1;if(Gt(p.eventType)||p.acl!==void 0)d+=1;i.run(`INSERT INTO run_events (id, run_id, level, event, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,[ne("evt",`${s}\x00${T}\x00${p.sourceRef}\x00${p.eventType}`),s,"info",p.eventType,JSON.stringify({source_ref:p.sourceRef,source_uri:p.sourceUri,revision:p.revision,hash:p.hash,status:p.status,affected_revisions:R.length}),p.updatedAt])}),i.run(`INSERT INTO provider_usage (id, run_id, provider, model, input_tokens, output_tokens, cost_usd, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`,[ne("usage",s),s,"local","open-files-outbox",JSON.stringify({note:"No model provider used for outbox invalidation."}),t]),S(i,{event_type:"write",action:"knowledge_outbox_invalidation",target_uri:e.dbPath,decision:"allow",metadata:{run_id:s,events:r.length,sources:l.size,revisions:_.size,chunks_deleted:o,embeddings_deleted:c},created_at:t}),{path:e.input,db_path:e.dbPath,run_id:s,events_seen:r.length,sources_touched:l.size,revisions_touched:_.size,chunks_deleted:o,embeddings_deleted:c,stale_revisions:a,deleted_sources:u,moved_sources:f,permission_updates:d}})()}finally{i.close()}}import{createHash as Vt}from"crypto";import{existsSync as Qt,readFileSync as Zt}from"fs";import{basename as en}from"path";function he(e,t){return`${e}_${Vt("sha256").update(t).digest("hex").slice(0,20)}`}function W(e){return e&&typeof e==="object"&&!Array.isArray(e)?e:void 0}function E(e){return typeof e==="string"&&e.length>0?e:void 0}function tn(e){return typeof e==="number"&&Number.isFinite(e)?e:void 0}function nn(e){let t=E(e.source_ref)??E(e.source_uri)??E(e.uri);if(t)return t;let n=E(e.file_id);if(n){let s=E(e.revision_id)??E(e.revision),l=`open-files://file/${encodeURIComponent(n)}`;return s?`${l}/revision/${encodeURIComponent(s)}`:l}let r=E(e.source_id),i=E(e.path);if(r&&i)return`open-files://source/${encodeURIComponent(r)}/path/${encodeURIComponent(i)}`;throw Error("Manifest item is missing source_ref, file_id, or source_id/path.")}function rn(e,t){if(t.kind==="open-files"&&t.entity==="file"&&t.revision_id)return e.replace(/\/revision\/[^/]+$/,"");return e}function sn(e){let t=E(e.extracted_text)??E(e.text)??E(e.content_text)??E(e.markdown);if(t!==void 0)return t;let n=e.content;return typeof n==="string"?n:null}function on(e){let t=E(e.extracted_text_ref)??E(e.extracted_text_uri)??E(e.text_ref);if(t)return t;let n=W(e.content);return E(n?.extracted_text_ref)??E(n?.extracted_text_uri)??null}function an(e){let t=E(e.path);return E(e.title)??E(e.name)??(t?en(t):null)}function cn(e){return E(e.hash)??E(e.checksum)??E(e.sha256)??null}function un(e,t,n){return E(e.revision_id)??E(e.revision)??E(e.version_id)??(t.kind==="open-files"?t.revision_id:void 0)??n??E(e.updated_at)??"current"}function dn(e,t){let n={};for(let[r,i]of Object.entries(e)){if(["text","content","content_text","extracted_text","markdown"].includes(r))continue;n[r]=i}return n.source_ref=t.sourceRef,n.source_uri=t.sourceUri,n.status=t.status,n}function ln(e,t){let n=nn(e),r=v(n),i=rn(n,r),s=cn(e),l=E(e.status)??"active";return{raw:e,sourceRef:n,sourceUri:i,kind:r.kind,title:an(e),revision:un(e,r,s),hash:s,extractedTextUri:on(e),text:sn(e),metadata:dn(e,{sourceRef:n,sourceUri:i,status:l}),acl:e.permissions??e.acl??{},status:l,updatedAt:E(e.updated_at)??t}}function fn(e){let t=e.trim();if(!t)return[];if(t.startsWith("[")){let n=JSON.parse(t);if(!Array.isArray(n))throw Error("Manifest array parse failed.");return n.map((r)=>{let i=W(r);if(!i)throw Error("Manifest array entries must be objects.");return i})}if(t.startsWith("{"))try{let n=JSON.parse(t),r=W(n);if(!r)throw Error("Manifest object parse failed.");if(Array.isArray(r.items))return r.items.map((i)=>{let s=W(i);if(!s)throw Error("Manifest items entries must be objects.");return s});if("source_ref"in r||"source_uri"in r||"file_id"in r)return[r]}catch(n){let r=t.split(/\r?\n/).filter((i)=>i.trim().length>0);if(r.length<=1)throw n;return r.map((i)=>{let s=W(JSON.parse(i));if(!s)throw Error("Manifest JSONL entries must be objects.");return s})}return t.split(/\r?\n/).filter((n)=>n.trim().length>0).map((n)=>{let r=W(JSON.parse(n));if(!r)throw Error("Manifest JSONL entries must be objects.");return r})}async function _n(e,t,n){let r=new URL(e),i=r.hostname,s=decodeURIComponent(r.pathname.replace(/^\/+/,""));if(!i||!s)throw Error(`Invalid S3 manifest URI: ${e}`);if(n)X(e,n);let[{S3Client:l,GetObjectCommand:_},{fromIni:o}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]),c=t?.storage.type==="s3"&&t.storage.s3?.bucket===i?t.storage.s3:void 0,u=await new l({region:c?.region,credentials:c?.profile?o({profile:c.profile}):void 0,maxAttempts:c?.max_attempts}).send(new _({Bucket:i,Key:s}));if(!u.Body)return"";return await u.Body.transformToString()}async function pn(e,t,n){if(e.startsWith("s3://"))return _n(e,t,n);if(!Qt(e))throw Error(`Manifest not found: ${e}`);return Zt(e,"utf8")}function gn(e,t,n){let r=e.replace(/\r\n/g,`
`);if(!r.trim())return[];let i=[],s=0;while(s<r.length){let l=Math.min(r.length,s+t),_=l;if(l<r.length){let c=r.lastIndexOf(`

`,l),a=r.lastIndexOf(". ",l),u=Math.max(c,a);if(u>s+Math.floor(t*0.5))_=u+(u===c?2:1)}let o=r.slice(s,_).trim();if(o)i.push({ordinal:i.length,text:o,startOffset:s,endOffset:_});if(_>=r.length)break;s=Math.max(0,_-n)}return i}function En(e){let t=e.trim().split(/\s+/).filter(Boolean).length;return Math.max(1,Math.ceil(t*1.25))}function hn(e,t){let n=e.query("SELECT id FROM chunks WHERE source_revision_id = ?").all(t);for(let r of n)e.run("DELETE FROM chunks_fts WHERE chunk_id = ?",[r.id]);return e.run("DELETE FROM chunks WHERE source_revision_id = ?",[t]),n.length}function Tn(e,t,n){let r=he("src",t.sourceUri);e.run(`INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       kind = excluded.kind,
       title = excluded.title,
       metadata_json = excluded.metadata_json,
       acl_json = excluded.acl_json,
       updated_at = excluded.updated_at`,[r,t.sourceUri,t.kind,t.title,JSON.stringify(t.metadata),JSON.stringify(t.acl??{}),n,t.updatedAt]);let i=e.query("SELECT id FROM sources WHERE uri = ?").get(t.sourceUri);if(!i)throw Error(`Failed to upsert source: ${t.sourceUri}`);return i.id}function yn(e,t,n,r){let i=he("rev",`${t}\x00${n.revision}`);e.run(`INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, revision) DO UPDATE SET
       hash = excluded.hash,
       extracted_text_uri = excluded.extracted_text_uri,
       metadata_json = excluded.metadata_json`,[i,t,n.revision,n.hash,n.extractedTextUri,JSON.stringify(n.metadata),r]);let s=e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").get(t,n.revision);if(!s)throw Error(`Failed to upsert source revision: ${n.sourceRef}`);return s.id}function mn(e,t,n,r,i,s,l){if(!n.text||n.status.toLowerCase()==="deleted")return{chunksInserted:0,redactions:0};let _=ee(n.text,l);if(_.findings.length>0)te(e,{source_uri:n.sourceUri,findings:_.findings,metadata:{source_ref:n.sourceRef,revision:n.revision},created_at:r}),S(e,{event_type:"redaction",action:"source_text_redact",target_uri:n.sourceUri,decision:"redacted",metadata:{findings:_.findings.length,source_ref:n.sourceRef,revision:n.revision},created_at:r});let o=gn(_.text,i,s);for(let c of o){let a=he("chk",`${t}\x00${c.ordinal}\x00${c.text}`),u={source_ref:n.sourceRef,source_uri:n.sourceUri,hash:n.hash,status:n.status,path:E(n.raw.path)??null,mime:E(n.raw.mime)??E(n.raw.content_type)??null,size:tn(n.raw.size)??null};e.run(`INSERT INTO chunks (id, source_revision_id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,[a,t,"source",c.ordinal,c.text,En(c.text),c.startOffset,c.endOffset,JSON.stringify(u),r]),e.run("INSERT INTO chunks_fts (chunk_id, text, title, source_uri) VALUES (?, ?, ?, ?)",[a,c.text,n.title??"",n.sourceUri])}return{chunksInserted:o.length,redactions:_.findings.length}}async function We(e){let t=e.now??new Date;if(e.safetyPolicy)F(e.dbPath,e.safetyPolicy);U(e.dbPath);let n=await pn(e.input,e.config,e.safetyPolicy),r=fn(n);return Te({dbPath:e.dbPath,items:r,sourceLabel:e.input,safetyPolicy:e.safetyPolicy,now:t,maxChunkChars:e.maxChunkChars,chunkOverlapChars:e.chunkOverlapChars})}async function Te(e){let t=(e.now??new Date).toISOString(),n=e.maxChunkChars??4000,r=e.chunkOverlapChars??200;if(n<500)throw Error("maxChunkChars must be at least 500.");if(r<0||r>=n)throw Error("chunkOverlapChars must be less than maxChunkChars.");if(e.safetyPolicy)F(e.dbPath,e.safetyPolicy);U(e.dbPath);let i=C(e.dbPath);try{return i.transaction(()=>{let l=new Set,_=new Set,o=0,c=0,a=0,u=0;S(i,{event_type:"source_read",action:e.readAction??(e.sourceLabel.startsWith("s3://")?"s3_manifest_read":"local_manifest_read"),target_uri:e.sourceLabel,decision:"allow",metadata:{items:e.items.length,read_only:!0},created_at:t});for(let f of e.items){let d=ln(f,t),h=Tn(i,d,t),T=yn(i,h,d,t);if(l.add(h),_.add(T),d.text||d.status.toLowerCase()==="deleted")c+=hn(i,T);let p=mn(i,T,d,t,n,r,e.safetyPolicy);o+=p.chunksInserted,a+=p.redactions}return S(i,{event_type:"write",action:"knowledge_manifest_ingest",target_uri:e.dbPath,decision:"allow",metadata:{items:e.items.length,sources:l.size,revisions:_.size,chunks_inserted:o,redactions:a},created_at:t}),{path:e.sourceLabel,db_path:e.dbPath,items_seen:e.items.length,sources_upserted:l.size,revisions_upserted:_.size,chunks_inserted:o,chunks_deleted:c,redactions:a,skipped:u}})()}finally{i.close()}}import{createHash as On}from"crypto";import{existsSync as Nn,readFileSync as vn}from"fs";import{basename as se}from"path";function re(e){if(!e)return{};try{let t=JSON.parse(e);return t&&typeof t==="object"&&!Array.isArray(t)?t:{}}catch{return{}}}function M(e,t){for(let n of t){let r=e[n];if(typeof r==="string"&&r.length>0)return r}return null}function Me(e,t){for(let n of t){let r=e[n];if(typeof r==="number"&&Number.isFinite(r))return r}return null}function bn(e,t){let n=e.mode;if(typeof n==="string"&&n!=="read_only")throw Error(`Source resolver denied ${t}. Permission mode is ${n}, expected read_only.`);let r=e.denied_purposes;if(Array.isArray(r)&&r.includes(t))throw Error(`Source resolver denied ${t}. Purpose is explicitly denied.`);let i=e.allowed_purposes;if(Array.isArray(i)&&i.length>0&&!i.includes(t))throw Error(`Source resolver denied ${t}. Allowed purposes: ${i.join(", ")}`)}function wn(e,t,n){if(!t)return n;try{let r=v(e);if(r.kind==="open-files"&&r.entity==="file")return`${e}/revision/${encodeURIComponent(t.revision)}`}catch{return n}return n}function Sn(e,t,n){return e.query(`SELECT id, uri, kind, title, metadata_json, acl_json, updated_at
     FROM sources
     WHERE uri = ? OR uri = ?
     ORDER BY CASE WHEN uri = ? THEN 0 ELSE 1 END
     LIMIT 1`).get(t,n,t)??null}function Rn(e,t,n){if(n)return e.query(`SELECT id, revision, hash, extracted_text_uri, metadata_json, created_at
       FROM source_revisions
       WHERE source_id = ? AND revision = ?
       LIMIT 1`).get(t,n)??null;return e.query(`SELECT id, revision, hash, extracted_text_uri, metadata_json, created_at
     FROM source_revisions
     WHERE source_id = ?
     ORDER BY created_at DESC, revision DESC
     LIMIT 1`).get(t)??null}function kn(e,t){if(!t)return 0;return e.query("SELECT COUNT(*) AS n FROM chunks WHERE source_revision_id = ?").get(t)?.n??0}function xn(e,t,n){if(!t||n<=0)return[];return e.query(`SELECT id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json
     FROM chunks
     WHERE source_revision_id = ?
     ORDER BY ordinal ASC
     LIMIT ?`).all(t,n)}async function ie(e){let t=e.purpose??"knowledge_answer",n=Math.max(0,Math.min(e.limit??10,100)),r=(e.now??new Date).toISOString(),i=v(e.sourceRef),s=Ie(e.sourceRef,i),l=De(e.sourceRef);if(e.safetyPolicy){if(!e.safetyPolicy.readOnlySourceAccess)throw Error("Safety policy denied source resolution.");F(e.dbPath,e.safetyPolicy)}U(e.dbPath);let _=C(e.dbPath);try{return _.transaction(()=>{let o=Sn(_,s,e.sourceRef);if(!o)return S(_,{event_type:"source_read",action:"open_files_resolve_missing",target_uri:e.sourceRef,decision:"allow",metadata:{purpose:t,read_only:!0,source_uri:s},created_at:r}),{source_ref:e.sourceRef,source_uri:s,purpose:t,read_only:!0,resolved:!1,resolver:{name:"open-files-read-only",mode:"local_catalog",contract:"open-files-knowledge-source-v1"},source:null,revision:null,content:{mime:null,size:null,hash:null,text_available:!1,chunks_total:0,chunks_returned:0,char_count_returned:0,extracted_text_ref:null,bytes_available:!1,bytes_exposed:!1},chunks:[],citations:[]};let c=re(o.metadata_json),a=re(o.acl_json);try{bn(a,t)}catch(g){throw S(_,{event_type:"source_read",action:"open_files_resolve",target_uri:e.sourceRef,decision:"deny",metadata:{purpose:t,read_only:!0,source_uri:o.uri,error:g instanceof Error?g.message:String(g)},created_at:r}),g}let u=Rn(_,o.id,l),f=re(u?.metadata_json),d=kn(_,u?.id??null),h=xn(_,u?.id??null,n),T=wn(o.uri,u,e.sourceRef),p=h.map((g)=>{let N=re(g.metadata_json),y={resolver:"open-files-read-only",mode:"local_catalog",purpose:t,read_only:!0,source_ref:M(N,["source_ref"])??T,source_uri:o.uri,source_revision_id:u?.id??null,revision:u?.revision??null,hash:u?.hash??M(N,["hash"]),chunk_id:g.id,start_offset:g.start_offset,end_offset:g.end_offset,resolved_at:r};return{id:g.id,kind:g.kind,ordinal:g.ordinal,text:g.text,token_count:g.token_count,start_offset:g.start_offset,end_offset:g.end_offset,metadata:N,evidence:y}}),L=p.map((g)=>({source_ref:g.evidence.source_ref,source_uri:o.uri,chunk_id:g.id,quote:g.text.slice(0,500),start_offset:g.start_offset,end_offset:g.end_offset,evidence:g.evidence}));S(_,{event_type:"source_read",action:"open_files_resolve",target_uri:e.sourceRef,decision:"allow",metadata:{purpose:t,read_only:!0,source_uri:o.uri,revision:u?.revision??null,chunks_returned:p.length,chunks_total:d},created_at:r});let b=M(c,["mime","content_type"])??M(f,["mime","content_type"]),R=Me(c,["size","size_bytes"])??Me(f,["size","size_bytes"]);return{source_ref:T,source_uri:o.uri,purpose:t,read_only:!0,resolved:!0,resolver:{name:"open-files-read-only",mode:"local_catalog",contract:"open-files-knowledge-source-v1"},source:{id:o.id,uri:o.uri,kind:o.kind,title:o.title,metadata:c,permissions:a,updated_at:o.updated_at},revision:u?{id:u.id,revision:u.revision,hash:u.hash,extracted_text_uri:u.extracted_text_uri,metadata:f,created_at:u.created_at,reindex_required:f.reindex_required===!0}:null,content:{mime:b,size:R,hash:u?.hash??M(c,["hash","checksum","sha256"]),text_available:d>0,chunks_total:d,chunks_returned:p.length,char_count_returned:p.reduce((g,N)=>g+N.text.length,0),extracted_text_ref:u?.extracted_text_uri??M(f,["extracted_text_ref","extracted_text_uri"]),bytes_available:!1,bytes_exposed:!1},chunks:p,citations:L}})()}finally{_.close()}}function $(e){return`sha256:${On("sha256").update(e).digest("hex")}`}function Ln(e){return e.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+\n/g,`
`).replace(/\n\s+/g,`
`).replace(/[ \t]{2,}/g," ").trim()}async function An(e,t,n){let r=new URL(e),i=r.hostname,s=decodeURIComponent(r.pathname.replace(/^\/+/,""));if(!i||!s)throw Error(`Invalid S3 source URI: ${e}`);if(n)X(e,n);let[{S3Client:l,GetObjectCommand:_},{fromIni:o}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]),c=t?.storage.type==="s3"&&t.storage.s3?.bucket===i?t.storage.s3:void 0,u=await new l({region:c?.region,credentials:c?.profile?o({profile:c.profile}):void 0,maxAttempts:c?.max_attempts}).send(new _({Bucket:i,Key:s}));if(!u.Body)return"";return await u.Body.transformToString()}async function In(e,t){if(t)Z(t);let n=await fetch(e,{headers:{accept:"text/markdown,text/plain,text/html,application/json;q=0.8,*/*;q=0.5","user-agent":"@hasna/knowledge source-ingest"}});if(!n.ok)throw Error(`Web source read failed ${n.status}: ${e}`);let r=n.headers.get("content-type"),i=await n.text();return{text:r?.includes("html")?Ln(i):i,mime:r}}function oe(e){if(e.kind==="file")return se(e.path);if(e.kind==="s3")return se(e.key);if(e.kind==="web")return se(new URL(e.url).pathname)||e.url;return e.path?se(e.path):e.id}async function $e(e,t,n){if(e.kind==="file"){if(!Nn(e.path))throw Error(`Source file not found: ${e.path}`);let r=vn(e.path,"utf8");return{text:r,contentSource:"file",title:oe(e),mime:"text/plain",size:r.length,hash:$(r),revision:null,extractedTextRef:null,metadata:{path:e.path},permissions:{mode:"read_only"}}}if(e.kind==="s3"){let r=await An(e.uri,t,n);return{text:r,contentSource:"s3",title:oe(e),mime:"text/plain",size:r.length,hash:$(r),revision:null,extractedTextRef:null,metadata:{bucket:e.bucket,key:e.key},permissions:{mode:"read_only"}}}if(e.kind==="web"){let r=await In(e.url,n);return{text:r.text,contentSource:"web",title:oe(e),mime:r.mime,size:r.text.length,hash:$(r.text),revision:null,extractedTextRef:null,metadata:{url:e.url},permissions:{mode:"read_only"}}}throw Error(`Direct source reading is not available for ${e.uri}`)}async function Dn(e,t,n){if(e.startsWith("open-files://"))throw Error("Open-files extracted text refs require an open-files resolver API. Ingest an open-files manifest with extracted_text or an extracted_text_ref using file://, s3://, or https://.");let r=v(e);return{text:(await $e(r,t,n)).text,contentSource:"extracted_text_ref"}}async function Cn(e){let t=await ie({dbPath:e.dbPath,sourceRef:e.sourceRef,purpose:e.purpose??"knowledge_index",limit:100,safetyPolicy:e.safetyPolicy,now:e.now});if(!t.resolved)throw Error("Open-files source is not in the local knowledge catalog. Ingest an open-files manifest first or use the open-files resolver API.");if(t.revision?.extracted_text_uri&&!t.content.text_available){let r=await Dn(t.revision.extracted_text_uri,e.config,e.safetyPolicy);return{text:r.text,contentSource:r.contentSource,title:t.source?.title??null,mime:t.content.mime,size:r.text.length,hash:t.revision.hash??$(r.text),revision:t.revision.revision,extractedTextRef:t.revision.extracted_text_uri,metadata:t.source?.metadata??{},permissions:t.source?.permissions??{mode:"read_only"}}}if(t.chunks.length===0)throw Error("Open-files source has no extracted text chunks yet. Ingest an open-files manifest with extracted_text or extracted_text_ref first.");let n=t.chunks.map((r)=>r.text).join(`

`);return{text:n,contentSource:"catalog_chunks",title:t.source?.title??null,mime:t.content.mime,size:n.length,hash:t.revision?.hash??$(n),revision:t.revision?.revision??null,extractedTextRef:t.revision?.extracted_text_uri??null,metadata:t.source?.metadata??{},permissions:t.source?.permissions??{mode:"read_only"}}}function Un(e,t,n,r){let i=n.hash??$(n.text),s={...n.metadata,source_ref:e,content_source:n.contentSource,read_only:!0},l={source_ref:e,name:n.title??oe(t),mime:n.mime??"text/plain",size:n.size??n.text.length,hash:i,revision:n.revision??i,status:"active",updated_at:new Date().toISOString(),permissions:{mode:"read_only",allowed_purposes:[r],...n.permissions},metadata:s,extracted_text_ref:n.extractedTextRef,extracted_text:n.text};if(t.kind==="open-files"){if(t.entity==="file")l.file_id=t.id;if(t.entity==="source")l.source_id=t.id,l.path=t.path}if(t.kind==="file")l.path=t.path;if(t.kind==="s3")l.path=t.key;if(t.kind==="web")l.url=t.url;return l}async function Be(e){let t=e.purpose??"knowledge_index",n=v(e.sourceRef),r=n.kind==="open-files"?await Cn(e):await $e(n,e.config,e.safetyPolicy),i=Un(e.sourceRef,n,r,t);return{...await Te({dbPath:e.dbPath,items:[i],sourceLabel:e.sourceRef,readAction:"source_ref_ingest_read",safetyPolicy:e.safetyPolicy,now:e.now}),source_ref:e.sourceRef,content_source:r.contentSource,read_only:!0,hash:String(i.hash)}}function jn(e){let t=String(e.getUTCFullYear()),n=String(e.getUTCMonth()+1).padStart(2,"0"),r=String(e.getUTCDate()).padStart(2,"0");return{year:t,month:n,day:r}}function Xn(){return`# Knowledge Agent Schema v1

## Source Rules

- Treat open-files source references as the preferred source of truth.
- Do not copy raw source files into open-knowledge.
- Cite every durable fact with a source URI, revision/hash when available, and optional span.
- Mark uncertainty explicitly when sources disagree or are incomplete.

## Wiki Rules

- Write generated knowledge as Markdown pages under wiki/.
- Keep root indexes small; use topic, team, project, and machine-readable shards for scale.
- Preserve backlinks between related pages and decisions.
- Prefer updating existing pages over creating near-duplicates.

## Query Rules

- Search wiki pages first, then source chunks, then deeper read-only source refs.
- Use web search only when requested or when current external context is required.
- File useful answers back into the wiki only after approval or approved auto-write mode.

## Lint Rules

- Flag stale pages, missing citations, contradictions, orphan pages, duplicate pages, and unresolved source refs.
`}function Fn(){return`# Knowledge Index

This is a compact orientation index for agents. It is not the full search index.

## Shards

- wiki/
- indexes/
- schemas/
- logs/

## Source Ownership

Raw source files are resolved through open-files. This app stores source refs,
citations, chunks, generated wiki artifacts, indexes, and run records.
`}function Kn(){return`# Wiki

Generated durable knowledge pages live here.

Pages should be concise, cited, and organized for both humans and agents.
`}async function ze(e,t=new Date){let{year:n,month:r,day:i}=jn(t),s="schemas/v1.md",l="indexes/root.md",_="wiki/README.md",o=`logs/${n}/${r}/${i}.jsonl`,c={ts:t.toISOString(),event:"wiki_layout_initialized",schema_key:"schemas/v1.md",root_index_key:"indexes/root.md",wiki_readme_key:"wiki/README.md"},a=[e.put({key:"schemas/v1.md",body:Xn(),content_type:"text/markdown"}),e.put({key:"indexes/root.md",body:Fn(),content_type:"text/markdown"}),e.put({key:"wiki/README.md",body:Kn(),content_type:"text/markdown"}),e.put({key:o,body:`${JSON.stringify(c)}
`,content_type:"application/x-ndjson"})];return await Promise.all(a),{schema_key:"schemas/v1.md",root_index_key:"indexes/root.md",wiki_readme_key:"wiki/README.md",log_key:o,written:["schemas/v1.md","indexes/root.md","wiki/README.md",o]}}class He{options;ensuredWorkspace;cachedConfig;constructor(e={}){this.options=e}get scope(){return this.options.scope??"global"}get workspace(){return this.ensuredWorkspace??be(this.options.scope,this.options.cwd)}ensureWorkspace(){if(!this.ensuredWorkspace)this.ensuredWorkspace=me(this.workspace.home);return this.ensuredWorkspace}jsonStorePath(){return this.ensureWorkspace().jsonStorePath}config(){if(!this.cachedConfig){let e=this.ensureWorkspace();this.cachedConfig=we(e.configPath)}return this.cachedConfig}safetyPolicy(){return je(this.config(),this.ensureWorkspace())}artifactStore(){return Le(this.config(),this.ensureWorkspace())}paths(){let e=this.ensureWorkspace();return{ok:!0,scope:this.scope,home:e.home,config_path:e.configPath,json_store_path:e.jsonStorePath,knowledge_db_path:e.knowledgeDbPath,artifacts_dir:e.artifactsDir,indexes_dir:e.indexesDir,logs_dir:e.logsDir,runs_dir:e.runsDir,schemas_dir:e.schemasDir,wiki_dir:e.wikiDir,config:this.config(),message:e.home}}initDb(){return U(this.ensureWorkspace().knowledgeDbPath)}dbStats(){let e=this.ensureWorkspace();return U(e.knowledgeDbPath),xe(e.knowledgeDbPath)}async initWiki(){return ze(this.artifactStore())}async ingestManifest(e){let t=this.ensureWorkspace();return We({dbPath:t.knowledgeDbPath,input:e,config:this.config(),safetyPolicy:this.safetyPolicy()})}async ingestSource(e,t){let n=this.ensureWorkspace();return Be({dbPath:n.knowledgeDbPath,sourceRef:e,purpose:t,config:this.config(),safetyPolicy:this.safetyPolicy()})}async resolveSource(e,t={}){let n=this.ensureWorkspace();return ie({dbPath:n.knowledgeDbPath,sourceRef:e,purpose:t.purpose,limit:t.limit,safetyPolicy:this.safetyPolicy()})}async consumeOutbox(e){let t=this.ensureWorkspace();return Pe({dbPath:t.knowledgeDbPath,input:e,config:this.config(),safetyPolicy:this.safetyPolicy()})}}function qe(e={}){return new He(e)}var H={name:"@hasna/knowledge",version:"0.2.10",description:"Agent-friendly local knowledge CLI with JSON output, pagination, and safe destructive actions",type:"module",bin:{"open-knowledge":"bin/open-knowledge.js","open-knowledge-mcp":"bin/open-knowledge-mcp.js"},files:["bin","src","docs","LICENSE","README.md"],scripts:{test:"bun test","test:cli":"bun test tests/cli.test.ts",build:"bun build --target=bun --outfile=bin/open-knowledge.js --minify --external @aws-sdk/client-s3 --external @aws-sdk/credential-providers src/cli.ts && bun build --target=bun --outfile=bin/open-knowledge-mcp.js --external @modelcontextprotocol/sdk --external @aws-sdk/client-s3 --external @aws-sdk/credential-providers src/mcp.js",prepublishOnly:"bun run build",postinstall:"bun run build"},keywords:["knowledge","cli","agents","json","notes","local","store"],license:"Apache-2.0",publishConfig:{registry:"https://registry.npmjs.org",access:"public"},repository:{type:"git",url:"git+https://github.com/hasna/knowledge.git"},bugs:{url:"https://github.com/hasna/knowledge/issues"},author:"Hasna Inc. <hasna@example.com>",engines:{bun:">=1.0",node:">=18"},dependencies:{"@aws-sdk/client-s3":"^3.1063.0","@aws-sdk/credential-providers":"^3.1063.0","@modelcontextprotocol/sdk":"^1.29.0",zod:"^4.3.6"},devDependencies:{"@types/bun":"^1.3.14"}};var Ye={debug:0,info:1,warn:2,error:3},Wn=()=>{if(process.env.DEBUG)return"debug";if(process.env.LOG_LEVEL==="debug")return"debug";if(process.env.LOG_LEVEL==="warn")return"warn";if(process.env.LOG_LEVEL==="error")return"error";return"info"};function K(e,t,n){if(Ye[e]<Ye[Wn()])return;let r={debug:"[DEBUG]",info:"[INFO]",warn:"[WARN]",error:"[ERROR]"}[e],i=n?`${r} ${t} ${JSON.stringify(n)}`:`${r} ${t}`;if(e==="error")console.error(i);else console.error(i)}var Mn=["add","list","get","delete","update","archive","restore","upsert","untag","export","prune","dedupe","stats","paths","db","wiki","source","ingest","reindex","safety","help"],Je={ls:"list",rm:"delete",edit:"update",unarchive:"restore"};function $n(e){let t=[],n={};for(let r=0;r<e.length;r+=1){let i=e[r];if(!i.startsWith("-")){t.push(i);continue}switch(i){case"--json":n.json=!0;break;case"--yes":case"-y":n.yes=!0;break;case"--help":case"-h":n.help=!0;break;case"--version":case"-v":n.version=!0;break;case"--desc":n.desc=!0;break;case"--page":case"-p":n.page=Number(e[r+1]),r+=1;break;case"--limit":case"-l":n.limit=Number(e[r+1]),r+=1;break;case"--search":case"-s":n.search=e[r+1],r+=1;break;case"--sort":n.sort=e[r+1],r+=1;break;case"--id":n.id=e[r+1],r+=1;break;case"--store":n.store=e[r+1],r+=1;break;case"--title":n.title=e[r+1],r+=1;break;case"--content":n.content=e[r+1],r+=1;break;case"--url":n.url=e[r+1],r+=1;break;case"--tag":case"-t":n.tag=e[r+1],r+=1;break;case"--format":n.format=e[r+1],r+=1;break;case"--completions":n.completions=e[r+1],r+=1;break;case"--purpose":n.purpose=e[r+1],r+=1;break;case"--no-color":n.noColor=!0;break;case"--scope":n.scope=e[r+1],r+=1;break;case"--older-than":n.olderThan=Number(e[r+1]),r+=1;break;case"--empty":n.empty=!0;break;case"--archived":n.archived=!0;break;case"--include-archived":n.includeArchived=!0;break;default:throw Error(`Unknown flag: ${i}. Run 'open-knowledge --help' for valid options.`)}}return{positional:t,flags:n}}function Bn(e){if(!e)return"";return Je[e]??e}function zn(e,t){let n=Array.from({length:e.length+1},()=>Array(t.length+1).fill(0));for(let r=0;r<=e.length;r+=1)n[r][0]=r;for(let r=0;r<=t.length;r+=1)n[0][r]=r;for(let r=1;r<=e.length;r+=1)for(let i=1;i<=t.length;i+=1){let s=e[r-1]===t[i-1]?0:1;n[r][i]=Math.min(n[r-1][i]+1,n[r][i-1]+1,n[r-1][i-1]+s)}return n[e.length][t.length]}function Hn(e){if(!e)return"";let t=[...Mn,...Object.keys(Je)],n="",r=Number.POSITIVE_INFINITY;for(let i of t){let s=zn(e,i);if(s<r)r=s,n=i}return r<=3?n:""}function qn(){console.log(`open-knowledge - local agent knowledge store

Usage:
  open-knowledge <command> [options]

Commands:
  add <title> <content>       Add an item
  list (alias: ls)             List items (supports pagination/search/sort/tag)
  get --id <id>               Get one item
  update --id <id>            Update an item (--title, --content, --url, --tag)
  archive --id <id>           Archive an item
  restore --id <id>           Restore an archived item
  upsert [title] [content]    Create or update an item by --id
  untag --id <id> -t <tag>    Remove a tag from an item
  delete (alias: rm) --id <id> Delete item (requires --yes)
  export                       Export all items (--format jsonl)
  prune                        Remove old/empty items (requires --yes)
  dedupe                       Remove duplicate items by title+content (requires --yes)
  stats                        Show knowledge base statistics
  paths                        Show resolved workspace/store paths
  db init|stats                Initialize or inspect local knowledge.db
  wiki init                    Initialize scalable wiki/schema/index/log artifacts
  source resolve <source-ref>  Resolve read-only source content and citation evidence
  ingest manifest <file|s3://> Ingest an open-files manifest into knowledge.db
  ingest source <source-ref>   Ingest a read-only source ref into knowledge.db
  reindex outbox <file|s3://>  Consume open-files change events and invalidate chunks
  safety status|check|approve|audit|redact
  help [command]               Show help

Global Options:
  --json                      Output JSON
  --store <path>              Override store path
  --purpose <name>            Read-only source purpose (default: knowledge_answer)
  --scope local|global|project  Store scope (default: global ~/.hasna/apps/knowledge/)
  --no-color                  Disable color output
  --completions <shell>       Output completions for bash|zsh|fish
  -v, --version               Show version
  -h, --help                  Show help

List Options:
  --format table|json         Output format (default: table if TTY, json otherwise)
  -p, --page <n>              Page number (default: 1)
  -l, --limit <n>             Items per page (default: 20)
  -s, --search <text>         Filter by title/content
  -t, --tag <tag>             Filter by tag
  --sort <created|title>       Sort field (default: created)
  --desc                       Sort descending
  --archived                  Show only archived items
  --include-archived          Include archived items

Add/Update Options:
  --url <url>                 Attach source URL

Update Options:
  --id <id>                   Item id
  --title <title>             New title
  --content <content>         New content
  --url <url>                 New source URL
  -t, --tag <tag>             Add a tag

Delete Options:
  --id <id>                   Item id
  -y, --yes                   Confirm destructive action

Export Options:
  --format jsonl              Export as newline-delimited JSON (default: JSON array)

Prune Options:
  --older-than <days>          Remove items older than N days
  --empty                     Remove items with empty content`)}function Yn(e){if(e==="add"){console.log("Usage: open-knowledge add <title> <content> [--url <url>] [-t <tag>] [--json]");return}if(e==="list"||e==="ls"){console.log("Usage: open-knowledge list|ls [--format table|json] [-p <page>] [-l <limit>] [-s <search>] [-t <tag>] [--sort created|title] [--desc] [--json]");return}if(e==="get"){console.log("Usage: open-knowledge get --id <id> [--json]");return}if(e==="update"||e==="edit"){console.log("Usage: open-knowledge update|edit --id <id> [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]");return}if(e==="archive"){console.log("Usage: open-knowledge archive --id <id> [--json]");return}if(e==="restore"||e==="unarchive"){console.log("Usage: open-knowledge restore|unarchive --id <id> [--json]");return}if(e==="upsert"){console.log("Usage: open-knowledge upsert [title] [content] [--id <id>] [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]");return}if(e==="untag"){console.log("Usage: open-knowledge untag --id <id> -t <tag> [--json]");return}if(e==="delete"||e==="rm"){console.log("Usage: open-knowledge delete|rm --id <id> -y [--json]");return}if(e==="export"){console.log("Usage: open-knowledge export [--format jsonl] [--json]");return}if(e==="prune"){console.log("Usage: open-knowledge prune --yes [--older-than <days>] [--empty] [--json]");return}if(e==="dedupe"){console.log("Usage: open-knowledge dedupe --yes [--json]");return}if(e==="stats"){console.log("Usage: open-knowledge stats [--json]");return}if(e==="paths"){console.log("Usage: open-knowledge paths [--scope local|global|project] [--json]");return}if(e==="db"){console.log("Usage: open-knowledge db init|stats [--scope local|global|project] [--json]");return}if(e==="wiki"){console.log("Usage: open-knowledge wiki init [--scope local|global|project] [--json]");return}if(e==="source"){console.log("Usage: open-knowledge source resolve <source-ref> [--purpose knowledge_answer|knowledge_index] [--limit <n>] [--scope local|global|project] [--json]");return}if(e==="ingest"){console.log("Usage: open-knowledge ingest manifest <file|s3://bucket/key> | source <source-ref> [--purpose knowledge_index] [--scope local|global|project] [--json]");return}if(e==="reindex"){console.log("Usage: open-knowledge reindex outbox <file|s3://bucket/key> [--scope local|global|project] [--json]");return}if(e==="safety"){console.log("Usage: open-knowledge safety status|check|approve|audit|redact [args] [--scope local|global|project] [--json]");return}qn()}function Jn(e){if(e.noColor||process.env.NO_COLOR)return!1;if(process.env.FORCE_COLOR)return!0;return process.stdout.isTTY===!0}function m(e,t,n){if(t){console.log(JSON.stringify(e,null,2));return}if(typeof e==="string"){console.log(e);return}console.log(e.message??JSON.stringify(e,null,2))}function q(e){if(!e.id)throw Error("Missing required --id. Example: open-knowledge get --id <id>")}function Gn(e,t){let n=t.sort??"created";if(n!=="created"&&n!=="title")throw Error("Invalid --sort value. Use 'created' or 'title'.");let r=[...e].sort((i,s)=>{if(n==="title")return i.title.localeCompare(s.title);return i.created_at.localeCompare(s.created_at)});if(t.desc)r.reverse();return{sorted:r,sort:n,direction:t.desc?"desc":"asc"}}async function Vn(e){let{positional:t,flags:n}=$n(e);if(K("debug","CLI invoked",{command:t[0],flags:{json:n.json,store:n.store}}),n.version){console.log(n.json?JSON.stringify({name:H.name,version:H.version},null,2):`${H.name} ${H.version}`);return}if(n.completions){let o=n.completions;if(o==="bash")console.log('_open_knowledge() { local cur; cur="${COMP_WORDS[COMP_CWORD]}"; COMPREPLY=($(compgen -W "add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki source ingest reindex safety help ls rm edit unarchive --json --yes --help --version --desc --page --limit --search --sort --id --store --title --content --url --tag --format --completions --purpose --no-color --scope --archived --include-archived" -- "$cur")); }; complete -F _open_knowledge open-knowledge');else if(o==="zsh")console.log(`#compdef open-knowledge
_open_knowledge() { _arguments -C "1: :(add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki source ingest reindex safety help ls rm edit unarchive)" "(--json)--json" "(--yes)-y" "(--help)--help" "(--version)--version" "(--desc)--desc" "(--archived)--archived" "(--include-archived)--include-archived" "(-p --page)"{-p,--page}"[page number]:number:" "(-l --limit)"{-l,--limit}"[items per page]:number:" "(-s --search)"{-s,--search}"[search text]:text:" "(--sort)--sort"{created,title}:" "(--id)--id[item id]:id:" "(--store)--store[store path]:path:" "(--title)--title[new title]:" "(--content)--content[new content]:" "(--url)--url[source url]:" "(-t --tag)"{-t,--tag}"[tag]:tag:" "(--format)--format[json|jsonl]:" "(--completions)--completions[output completions]:shell:(bash zsh fish):" "(--purpose)--purpose[purpose]:" "(--no-color)--no-color[disable color]" "(--scope)--scope"{local,global,project}:" }; _open_knowledge`);else if(o==="fish")console.log('complete -c open-knowledge -f; complete -c open-knowledge -a "add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki source ingest reindex safety help ls rm edit unarchive"; complete -c open-knowledge -l json; complete -c open-knowledge -l yes -s y; complete -c open-knowledge -l help -s h; complete -c open-knowledge -l version -s v; complete -c open-knowledge -l desc; complete -c open-knowledge -l archived; complete -c open-knowledge -l include-archived; complete -c open-knowledge -s p -l page; complete -c open-knowledge -s l -l limit; complete -c open-knowledge -s s -l search; complete -c open-knowledge -l sort; complete -c open-knowledge -l id; complete -c open-knowledge -l store; complete -c open-knowledge -l title; complete -c open-knowledge -l content; complete -c open-knowledge -l url; complete -c open-knowledge -s t -l tag; complete -c open-knowledge -l format; complete -c open-knowledge -l completions; complete -c open-knowledge -l purpose; complete -c open-knowledge -l no-color; complete -c open-knowledge -l scope -a "local global project"');else throw Error("Invalid --completions value. Use 'bash', 'zsh', or 'fish'.");return}let r=Bn(t[0]);if(!r||n.help||r==="help"){Yn(t[1]);return}let i=qe({scope:n.scope}),s=n.store;if(!s)if(n.scope==="project"||n.scope==="local")s=i.jsonStorePath();else s=le();if(r==="paths"){m(i.paths(),n.json);return}if(r==="db"){let o=t[1]??"init";if(o!=="init"&&o!=="stats")throw Error("Invalid db action. Use 'init' or 'stats'.");if(o==="init"){let a=i.initDb();m({ok:!0,...a,message:`Initialized ${a.path}`},n.json);return}let c=i.dbStats();m({ok:!0,path:i.workspace.knowledgeDbPath,...c,message:`knowledge.db schema v${c.schema_version}`},n.json);return}if(r==="wiki"){if((t[1]??"init")!=="init")throw Error("Invalid wiki action. Use 'init'.");let c=await i.initWiki();m({ok:!0,...c,message:`Initialized wiki layout in ${i.workspace.home}`},n.json);return}if(r==="safety"){let o=t[1]??"status",c=i.ensureWorkspace(),a=i.safetyPolicy();i.initDb();let u=C(c.knowledgeDbPath);try{if(o==="status"){m({ok:!0,mode:a.mode,workspace:c.home,allow_write_roots:a.allowWriteRoots,read_only_source_access:a.readOnlySourceAccess,network:a.network,redaction:a.redaction,approvals:a.approvals,message:`Safety policy: ${a.mode}`},n.json);return}if(o==="check"){let f=t[2]??"generated_write",d=t[3]??null,h;try{if(f==="web_search")Z(a),h={action:f,target_uri:d,approval_required:!1,approved:!0,decision:"allow"};else if(f==="s3_read"){if(!d)throw Error("safety check s3_read requires an s3:// target.");X(d,a),h={action:f,target_uri:d,approval_required:!1,approved:!0,decision:"allow"}}else h=Fe(u,a,f,d);S(u,{event_type:"safety_check",action:f,target_uri:d,decision:h.decision==="allow"?"allow":"requires_approval",metadata:h}),m({ok:!0,...h,message:`Safety check ${h.decision}`},n.json);return}catch(T){throw S(u,{event_type:"safety_check",action:f,target_uri:d,decision:"deny",metadata:{error:T instanceof Error?T.message:String(T)}}),T}}if(o==="approve"){let f=t[2]??"generated_write",d=t[3]??null,h=Xe(u,{action:f,target_uri:d,reason:"local-cli approval",metadata:{scope:n.scope??"global"}});S(u,{event_type:"approval",action:f,target_uri:d,decision:"allow",metadata:{approval_id:h.id}}),m({ok:!0,...h,action:f,target_uri:d,message:`Approved ${f}`},n.json);return}if(o==="audit"){let f=u.query("SELECT id, event_type, action, target_uri, decision, metadata_json, created_at FROM audit_events ORDER BY created_at DESC LIMIT 50").all().map((d)=>({id:d.id,event_type:d.event_type,action:d.action,target_uri:d.target_uri,decision:d.decision,metadata:JSON.parse(d.metadata_json),created_at:d.created_at}));m({ok:!0,events:f,message:`${f.length} audit event(s)`},n.json);return}if(o==="redact"){let f=t.slice(2).join(" ");if(!f)throw Error("Usage: open-knowledge safety redact <text>");let d=ee(f,a);if(d.findings.length>0)te(u,{source_uri:"safety://redact",findings:d.findings,metadata:{command:"safety redact"}});S(u,{event_type:"redaction",action:"safety_redact",target_uri:"safety://redact",decision:d.findings.length>0?"redacted":"allow",metadata:{findings:d.findings.length}}),m({ok:!0,text:d.text,findings:d.findings,message:`Redacted ${d.findings.length} finding(s)`},n.json);return}throw Error("Invalid safety action. Use 'status', 'check', 'approve', 'audit', or 'redact'.")}finally{u.close()}}if(r==="source"){if((t[1]??"")!=="resolve")throw Error("Invalid source action. Use 'resolve'.");let c=t[2];if(!c)throw Error("Usage: open-knowledge source resolve <source-ref>");let a=await i.resolveSource(c,{purpose:n.purpose,limit:n.limit});m({ok:!0,...a,message:a.resolved?`Resolved ${a.source_ref} (${a.content.chunks_returned}/${a.content.chunks_total} chunks)`:`Source not indexed: ${c}`},n.json);return}if(r==="ingest"){let o=t[1]??"";if(o==="manifest"){let c=t[2];if(!c)throw Error("Usage: open-knowledge ingest manifest <file|s3://bucket/key>");let a=await i.ingestManifest(c);m({ok:!0,...a,message:`Ingested ${a.items_seen} manifest item(s)`},n.json);return}if(o==="source"){let c=t[2];if(!c)throw Error("Usage: open-knowledge ingest source <source-ref>");let a=await i.ingestSource(c,n.purpose);m({ok:!0,...a,message:`Ingested source ${a.source_ref} (${a.chunks_inserted} chunks)`},n.json);return}throw Error("Invalid ingest action. Use 'manifest' or 'source'.")}if(r==="reindex"){if((t[1]??"")!=="outbox")throw Error("Invalid reindex action. Use 'outbox'.");let c=t[2];if(!c)throw Error("Usage: open-knowledge reindex outbox <file|s3://bucket/key>");let a=await i.consumeOutbox(c);m({ok:!0,...a,message:`Consumed ${a.events_seen} outbox event(s)`},n.json);return}if(fe(s),r==="add"){let o=t[1],c=t[2];if(!o||!c)throw Error("Usage: open-knowledge add <title> <content>");O(s,()=>{let a=x(s),u={id:_e(),title:o,content:c,url:n.url??null,tags:n.tag?[n.tag]:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()};a.items.push(u),D(s,a),K("info","Item added",{id:u.id,title:u.title}),m({ok:!0,item:u,message:`Added ${u.id}`},n.json)});return}if(r==="list"){if(n.format!==void 0&&n.format!=="table"&&n.format!=="json")throw Error("Invalid --format value for list. Use 'table' or 'json'.");O(s,()=>{let o=x(s),c=Number.isFinite(n.page)&&n.page>0?n.page:1,a=Number.isFinite(n.limit)&&n.limit>0?n.limit:20,u=n.search?String(n.search).toLowerCase():"",f=n.tag?String(n.tag).toLowerCase():"",d=n.format==="table"||!n.json&&!n.format&&Jn(n),h=n.json||n.format==="json",T=o.items;if(n.archived)T=T.filter((y)=>y.archived===!0);else if(!n.includeArchived)T=T.filter((y)=>!y.archived);if(u)T=T.filter((y)=>y.title.toLowerCase().includes(u)||y.content.toLowerCase().includes(u));if(f)T=T.filter((y)=>y.tags&&y.tags.map((ae)=>ae.toLowerCase()).includes(f));let{sorted:p,sort:L,direction:b}=Gn(T,n),R=(c-1)*a,g=p.slice(R,R+a),N=Math.max(1,Math.ceil(p.length/a));if(h){m({ok:!0,page:c,limit:a,total:p.length,total_pages:N,sort:L,direction:b,items:g},!0);return}if(g.length===0){m(`No items found (search=${u||"none"}, tag=${f||"none"})`,!1);return}if(d){let y=(j)=>j,ae=`${y("ID")}	${y("TITLE")}	${y("CREATED")}	${y("URL")}	${y("TAGS")}`;console.log(ae);for(let j of g)console.log(`${j.id}	${y(j.title)}	${j.created_at}	${j.url?y(j.url):""}	${j.tags?.length?y(`[${j.tags.join(", ")}]`):""}`);console.log(`Page ${c}/${N} | showing ${g.length} of ${p.length} | sort=${L} ${b} | search=${u||"none"} | tag=${f||"none"}`)}else{for(let y of g)console.log(`${y.id}	${y.title}	${y.created_at}${y.url?`	${y.url}`:""}${y.tags?.length?`	[${y.tags.join(", ")}]`:""}`);console.log(`Page ${c}/${N} | showing ${g.length} of ${p.length} | sort=${L} ${b} | search=${u||"none"} | tag=${f||"none"}`)}});return}if(r==="get"){q(n),O(s,()=>{let c=x(s).items.find((a)=>a.id===n.id||a.short_id===n.id);if(!c)throw Error(`Item not found: ${n.id}`);m({ok:!0,item:c,message:`${c.id}: ${c.title}`},n.json)});return}if(r==="update"){q(n),O(s,()=>{let o=x(s),c=o.items.findIndex((u)=>u.id===n.id||u.short_id===n.id);if(c===-1)throw Error(`Item not found: ${n.id}`);let a=o.items[c];if(n.title!==void 0)a.title=n.title;if(n.content!==void 0)a.content=n.content;if(n.url!==void 0)a.url=n.url;if(n.tag!==void 0){if(a.tags=a.tags||[],!a.tags.map((u)=>u.toLowerCase()).includes(n.tag.toLowerCase()))a.tags.push(n.tag)}a.updated_at=new Date().toISOString(),o.items[c]=a,D(s,o),m({ok:!0,item:a,message:`Updated ${a.id}`},n.json)});return}if(r==="archive"||r==="restore"){q(n),O(s,()=>{let o=x(s),c=o.items.findIndex((u)=>u.id===n.id||u.short_id===n.id);if(c===-1)throw Error(`Item not found: ${n.id}`);let a=o.items[c];a.archived=r==="archive",a.updated_at=new Date().toISOString(),o.items[c]=a,D(s,o),m({ok:!0,item:a,message:`${r==="archive"?"Archived":"Restored"} ${a.id}`},n.json)});return}if(r==="untag"){if(q(n),!n.tag)throw Error("Missing required --tag. Example: open-knowledge untag --id <id> -t <tag>");O(s,()=>{let o=x(s),c=o.items.findIndex((f)=>f.id===n.id||f.short_id===n.id);if(c===-1)throw Error(`Item not found: ${n.id}`);let a=o.items[c],u=a.tags?.length??0;a.tags=(a.tags??[]).filter((f)=>f.toLowerCase()!==n.tag.toLowerCase()),a.updated_at=new Date().toISOString(),o.items[c]=a,D(s,o),m({ok:!0,item:a,removed:u-a.tags.length,message:`Removed tag from ${a.id}`},n.json)});return}if(r==="upsert"){let o=n.title??t[1],c=n.content??t[2];O(s,()=>{let a=x(s),u=n.id?a.items.findIndex((h)=>h.id===n.id||h.short_id===n.id):-1,f=new Date().toISOString();if(u===-1){if(!o||!c)throw Error("New item requires title and content. Example: open-knowledge upsert <title> <content> [--id <id>]");let h=n.id??_e(),T={id:h,short_id:ke(h),title:o,content:c,url:n.url??null,tags:n.tag?[n.tag]:[],metadata:{},archived:!1,created_at:f,updated_at:f};a.items.push(T),D(s,a),m({ok:!0,created:!0,item:T,message:`Upserted ${T.id}`},n.json);return}let d=a.items[u];if(o!==void 0)d.title=o;if(c!==void 0)d.content=c;if(n.url!==void 0)d.url=n.url;if(n.tag!==void 0){if(d.tags=d.tags||[],!d.tags.map((h)=>h.toLowerCase()).includes(n.tag.toLowerCase()))d.tags.push(n.tag)}d.updated_at=f,a.items[u]=d,D(s,a),m({ok:!0,created:!1,item:d,message:`Upserted ${d.id}`},n.json)});return}if(r==="delete"){if(q(n),!n.yes)throw Error("Refusing delete without --yes. Re-run with: open-knowledge delete --id <id> --yes");O(s,()=>{let o=x(s),c=o.items.length;o.items=o.items.filter((u)=>u.id!==n.id&&u.short_id!==n.id);let a=c!==o.items.length;if(D(s,o),!a)throw Error(`Item not found: ${n.id}`);K("info","Item deleted",{id:n.id}),m({ok:!0,deleted_id:n.id,message:`Deleted ${n.id}`},n.json)});return}if(r==="export"){let o=n.format??"json";if(o!=="json"&&o!=="jsonl")throw Error("Invalid --format. Use 'json' or 'jsonl'.");O(s,()=>{let c=x(s);if(o==="jsonl")for(let a of c.items)console.log(JSON.stringify(a));else m({ok:!0,items:c.items},n.json)});return}if(r==="prune"){if(!n.yes)throw Error("Refusing prune without --yes. Re-run with: open-knowledge prune --yes [--older-than <days>] [--empty]");O(s,()=>{let o=x(s),c=o.items.length;if(n.olderThan!==void 0){let u=new Date;u.setDate(u.getDate()-n.olderThan),o.items=o.items.filter((f)=>new Date(f.created_at)>=u)}if(n.empty)o.items=o.items.filter((u)=>u.content.trim().length>0);let a=c-o.items.length;D(s,o),K("info","Prune completed",{pruned:a,remaining:o.items.length}),m({ok:!0,pruned:a,remaining:o.items.length,message:`Pruned ${a} item(s)`},n.json)});return}if(r==="dedupe"){if(!n.yes)throw Error("Refusing dedupe without --yes. Re-run with: open-knowledge dedupe --yes [--json]");O(s,()=>{let o=x(s),c=new Set,a=o.items.length;o.items=o.items.filter((f)=>{let d=`${f.title}\x00${f.content}`;if(c.has(d))return!1;return c.add(d),!0});let u=a-o.items.length;D(s,o),K("info","Dedupe completed",{removed:u,remaining:o.items.length}),m({ok:!0,removed:u,remaining:o.items.length,message:`Dedupe removed ${u} duplicate(s)`},n.json)});return}if(r==="stats"){O(s,()=>{let o=x(s),c=o.items.filter((b)=>!b.archived),a=c.length,u=o.items.length-a,f=c.filter((b)=>b.url).length,d=c.filter((b)=>b.tags&&b.tags.length>0).length,h=a>0?c.map((b)=>b.created_at).sort()[0]:null,T=a>0?c.map((b)=>b.created_at).sort()[a-1]:null,p={};for(let b of c)for(let R of b.tags||[])p[R]=(p[R]||0)+1;let L=Object.entries(p).sort((b,R)=>R[1]-b[1]).slice(0,5).map(([b,R])=>({tag:b,count:R}));m({ok:!0,total:a,archived:u,with_url:f,with_tags:d,oldest:h,newest:T,top_tags:L,message:`${a} items | ${f} with URL | ${d} with tags`},n.json)});return}let l=Hn(t[0]),_=l?` Did you mean '${l}'?`:"";throw K("warn","Unknown command",{input:t[0],suggestion:l}),Error(`Unknown command: ${t[0]}.${_} Run 'open-knowledge --help' for available commands.`)}if(import.meta.main)Vn(process.argv.slice(2)).catch((e)=>{let t=e instanceof Error?e.message:String(e);K("error","CLI error",{message:t,stack:e instanceof Error?e.stack:void 0}),console.error(`Error: ${t}`),process.exitCode=1});export{Hn as suggestCommand,Gn as sortItems,Vn as run,$n as parseArgs};
