#!/usr/bin/env bun
// @bun
var I=import.meta.require;import{readFileSync as ne,writeFileSync as te,existsSync as re,renameSync as Ft,unlinkSync as je}from"fs";import{randomUUID as Ke}from"crypto";import{existsSync as Lt,mkdirSync as ge,readFileSync as Ct,writeFileSync as Dt}from"fs";import{homedir as Ce}from"os";import{dirname as Pt,join as O,resolve as Ut}from"path";var Y=O(".hasna","apps","knowledge");function pe(){return O(Ce(),".open-knowledge","db.json")}function me(){return O(Ce(),".hasna","apps","knowledge")}function jt(e=process.cwd()){return Ut(e,Y)}function H(e){return{home:e,configPath:O(e,"config.json"),jsonStorePath:O(e,"db.json"),knowledgeDbPath:O(e,"knowledge.db"),artifactsDir:O(e,"artifacts"),cacheDir:O(e,"cache"),exportsDir:O(e,"exports"),indexesDir:O(e,"indexes"),logsDir:O(e,"logs"),runsDir:O(e,"runs"),schemasDir:O(e,"schemas"),wikiDir:O(e,"wiki")}}function Kt(){return{version:1,mode:"local",storage:{type:"local",artifacts_root:"artifacts"},sources:{preferred_ref:"open-files",allowed_schemes:["open-files","s3","file","https","http"]},providers:{default_model:"openai:gpt-5.2",aliases:{fast:"openai:gpt-5-mini",reasoning:"anthropic:claude-opus-4-6",sonnet:"anthropic:claude-sonnet-4-6",deepseek:"deepseek:deepseek-chat","deepseek-reasoning":"deepseek:deepseek-reasoner"},openai:{api_key_env:"OPENAI_API_KEY",default_model:"gpt-5.2"},anthropic:{api_key_env:"ANTHROPIC_API_KEY",default_model:"claude-sonnet-4-6"},deepseek:{api_key_env:"DEEPSEEK_API_KEY",default_model:"deepseek-chat"}},embeddings:{default_model:"openai:text-embedding-3-small",dimensions:1536,batch_size:64,max_parallel_calls:4},safety:{network:{web_search_enabled:!1,s3_reads_enabled:!1,allowed_s3_buckets:[]},redaction:{enabled:!0},approvals:{generated_writes_require_approval:!0}}}}function De(e){let t=H(e);ge(t.home,{recursive:!0});for(let r of[t.artifactsDir,t.cacheDir,t.exportsDir,t.indexesDir,t.logsDir,t.runsDir,t.schemasDir,t.wikiDir])ge(r,{recursive:!0});if(!Lt(t.configPath))Dt(t.configPath,`${JSON.stringify(Kt(),null,2)}
`);return t}function Pe(e,t=process.cwd()){if(e==="project"||e==="local")return H(jt(t));return H(me())}function ee(e){ge(Pt(e),{recursive:!0})}function Ue(e){let t=Ct(e,"utf8");return JSON.parse(t)}function he(){return H(me()).jsonStorePath}function Ee(e){if(!re(e))if(ee(e),e===he()&&re(pe()))te(e,ne(pe(),"utf8"));else te(e,JSON.stringify({items:[]},null,2))}function Mt(e){return`${e}.lock`}function Xt(e,t){let i=Date.now();while(Date.now()-i<5000){try{if(!re(e)){te(e,JSON.stringify({owner:t,ts:Date.now()}));return}let u=JSON.parse(ne(e,"utf8"));if(Date.now()-u.ts>1e4)je(e)}catch{}let o=Date.now();while(Date.now()-o<50);}throw Error(`Could not acquire lock on ${e} after 5000ms`)}function Wt(e,t){try{if(re(e)){if(JSON.parse(ne(e,"utf8")).owner===t)je(e)}}catch{}}function L(e){Ee(e);let t=ne(e,"utf8"),r=JSON.parse(t);if(!r||!Array.isArray(r.items))return{items:[]};return r}function U(e,t){let r=`${e}.tmp.${Ke()}`;te(r,JSON.stringify(t,null,2)),Ft(r,e)}function C(e,t){let r=Ke(),n=Mt(e);Xt(n,r);try{return t()}finally{Wt(n,r)}}function ye(){return`k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`}function Fe(e){return e.replace(/^k_/,"").slice(0,12)}import{Database as $t}from"bun:sqlite";var Bt=`
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
`,qt=`
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
`,zt=`
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
`,Gt=`
CREATE TABLE IF NOT EXISTS vector_index_entries (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  source_revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  vector_norm REAL NOT NULL,
  source_uri TEXT,
  source_ref TEXT,
  revision TEXT,
  hash TEXT,
  start_offset INTEGER,
  end_offset INTEGER,
  token_count INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(chunk_id, provider, model)
);

CREATE INDEX IF NOT EXISTS idx_vector_index_provider_model ON vector_index_entries(provider, model);
CREATE INDEX IF NOT EXISTS idx_vector_index_source_revision ON vector_index_entries(source_revision_id);
CREATE INDEX IF NOT EXISTS idx_vector_index_source_uri ON vector_index_entries(source_uri);
CREATE INDEX IF NOT EXISTS idx_vector_index_status ON vector_index_entries(status);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (4, datetime('now'));
`;function x(e){ee(e);let t=new $t(e);return t.exec("PRAGMA foreign_keys = ON;"),t.exec("PRAGMA busy_timeout = 5000;"),t}function S(e){let t=x(e);try{if(t.exec(Bt),J(t)<2)t.exec(qt);if(J(t)<3)t.exec(zt);if(J(t)<4)t.exec(Gt);return{path:e,schema_version:J(t)}}finally{t.close()}}function J(e){return e.query("SELECT MAX(version) AS version FROM schema_versions").get()?.version??0}function N(e,t){return e.query(`SELECT COUNT(*) AS n FROM ${t}`).get()?.n??0}function Me(e){let t=x(e);try{return{schema_version:J(t),sources:N(t,"sources"),source_revisions:N(t,"source_revisions"),chunks:N(t,"chunks"),wiki_pages:N(t,"wiki_pages"),citations:N(t,"citations"),indexes:N(t,"knowledge_indexes"),runs:N(t,"runs"),run_events:N(t,"run_events"),redaction_findings:N(t,"redaction_findings"),audit_events:N(t,"audit_events"),approval_gates:N(t,"approval_gates"),storage_objects:N(t,"storage_objects"),embeddings:N(t,"chunk_embeddings"),vector_entries:N(t,"vector_index_entries")}}finally{t.close()}}import{existsSync as Ht,mkdirSync as Xe,readFileSync as Yt,writeFileSync as Jt}from"fs";import{dirname as Vt,join as Te,relative as Qt,sep as Zt}from"path";function V(e){let t=e.replace(/\\/g,"/").trim();if(!t||t.startsWith("/"))throw Error(`Invalid artifact key: ${e}`);let r=t.split("/").filter(Boolean);if(r.length===0||r.some((n)=>n==="."||n===".."))throw Error(`Invalid artifact key: ${e}`);return r.join("/")}function be(e,t){let r=Qt(e,t);if(r.startsWith("..")||r===".."||r.startsWith(`..${Zt}`))throw Error(`Artifact path escapes root: ${t}`)}class We{root;type="local";canRead=!0;canWrite=!0;constructor(e){this.root=e;Xe(e,{recursive:!0})}async put(e){let t=V(e.key),r=Te(this.root,t);return be(this.root,r),Xe(Vt(r),{recursive:!0}),Jt(r,e.body),{key:t,uri:`file://${r}`}}async getText(e){let t=V(e),r=Te(this.root,t);return be(this.root,r),Yt(r,"utf8")}async exists(e){let t=V(e),r=Te(this.root,t);return be(this.root,r),Ht(r)}}class $e{options;type="s3";canRead=!0;canWrite=!0;client;constructor(e){this.options=e;this.client=e.client}async getClient(){if(this.client)return this.client;let[{S3Client:e},{fromIni:t}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]);return this.client=new e({region:this.options.region,credentials:this.options.profile?t({profile:this.options.profile}):void 0,maxAttempts:this.options.max_attempts}),this.client}objectKey(e){let t=V(e),r=this.options.prefix?V(this.options.prefix):"";return r?`${r}/${t}`:t}async put(e){let[{PutObjectCommand:t},r]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),n=this.objectKey(e.key);return await r.send(new t({Bucket:this.options.bucket,Key:n,Body:e.body,ContentType:e.content_type,Metadata:e.metadata,ServerSideEncryption:this.options.server_side_encryption,SSEKMSKeyId:this.options.kms_key_id})),{key:n,uri:`s3://${this.options.bucket}/${n}`}}async getText(e){let[{GetObjectCommand:t},r]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),n=this.objectKey(e),i=await r.send(new t({Bucket:this.options.bucket,Key:n}));if(!i.Body)return"";return await i.Body.transformToString()}async exists(e){let[{HeadObjectCommand:t},r]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),n=this.objectKey(e);try{return await r.send(new t({Bucket:this.options.bucket,Key:n})),!0}catch(i){let o=i instanceof Error?i.name:"";if(o==="NotFound"||o==="NoSuchKey"||o==="NotFoundError")return!1;throw i}}}function Be(e,t){if(e.storage.type==="s3"){if(!e.storage.s3?.bucket)throw Error("S3 artifact storage requires storage.s3.bucket");return new $e({bucket:e.storage.s3.bucket,prefix:e.storage.s3.prefix,region:e.storage.s3.region,profile:e.storage.s3.profile,max_attempts:e.storage.s3.max_attempts,server_side_encryption:e.storage.s3.server_side_encryption,kms_key_id:e.storage.s3.kms_key_id})}return new We(t.artifactsDir)}import{createHash as Ze}from"crypto";var qe={openai:{api_key_env:"OPENAI_API_KEY",default_model:"gpt-5.2"},anthropic:{api_key_env:"ANTHROPIC_API_KEY",default_model:"claude-sonnet-4-6"},deepseek:{api_key_env:"DEEPSEEK_API_KEY",default_model:"deepseek-chat"}},er={openai:{text_generation:!0,structured_output:!0,tool_usage:!0,tool_streaming:!0,image_input:!0,native_web_search:!0,reasoning:!0,embeddings:!0},anthropic:{text_generation:!0,structured_output:!0,tool_usage:!0,tool_streaming:!0,image_input:!0,native_web_search:!1,reasoning:!0,embeddings:!1},deepseek:{text_generation:!0,structured_output:!0,tool_usage:!0,tool_streaming:!0,image_input:!1,native_web_search:!1,reasoning:!0,embeddings:!1}},tr={default:"openai:gpt-5.2",fast:"openai:gpt-5-mini",reasoning:"anthropic:claude-opus-4-6",sonnet:"anthropic:claude-sonnet-4-6",deepseek:"deepseek:deepseek-chat","deepseek-reasoning":"deepseek:deepseek-reasoner"};function ze(e){return e.providers??{}}function ke(e,t){let r=ze(e)[t]??{};return{...qe[t],...r}}function Ge(e){let t=ze(e);return{...tr,...t.default_model?{default:t.default_model}:{},...t.aliases??{}}}function F(e){let[t,...r]=e.split(":"),n=r.join(":");if(t!=="openai"&&t!=="anthropic"&&t!=="deepseek")throw Error(`Unsupported AI provider: ${t}`);if(!n)throw Error(`Invalid model ref: ${e}. Expected provider:model.`);return{provider:t,model:n}}function ve(e,t){return Ge(t)[e]??e}function xe(e){let t=Ge(e);return Object.entries(t).map(([r,n])=>{let i=F(n);return{alias:r,model_ref:n,provider:i.provider,model:i.model,default:r==="default",capabilities:er[i.provider]}})}function He(e,t=process.env){return Object.keys(qe).map((r)=>{let n=ke(e,r),i=Boolean(t[n.api_key_env]);return{provider:r,api_key_env:n.api_key_env,configured:i,source:i?"env":"missing",base_url:n.base_url??null,default_model:n.default_model}})}function Ye(e,t=process.env){return{default_model:ve("default",e),providers:He(e,t),models:xe(e)}}function ie(e,t,r=process.env){let n=He(t,r).find((i)=>i.provider===e);if(!n)throw Error(`Unsupported AI provider: ${e}`);if(!n.configured)throw Error(`Missing ${n.api_key_env} for ${e}. Set the env var to use this provider.`);return n}function rr(e){return["deleted","stale","invalidated","reindex_required"].includes((e??"").toLowerCase())}function $(e){let t=e.status??null;return{source_owner:"open-files",source_ref:e.source_ref??null,source_uri:e.source_uri??null,source_kind:e.source_kind??null,source_revision_id:e.source_revision_id??null,revision:e.revision??null,hash:e.hash??null,chunk_id:e.chunk_id??null,start_offset:e.start_offset??null,end_offset:e.end_offset??null,status:t,read_only:!0,citation_required:!0,resolver:e.resolver??null,stale:rr(t)}}function we(e){return{source_owner:"open-files",generated_from:e.generated_from,artifact_key:e.artifact_key,source_refs:e.source_refs??[],read_only_sources:!0,citation_required:e.citation_required??!0,raw_source_bytes_stored_in_open_knowledge:!1}}function Je(e,t){return{...e,provenance:t}}var nr="openai:text-embedding-3-small",et=1536;function se(e){return e?.embeddings??{}}function Ve(e,t){return`${e}_${Ze("sha256").update(t).digest("hex").slice(0,20)}`}function Re(e){if(!e)return{};try{let t=JSON.parse(e);return t&&typeof t==="object"&&!Array.isArray(t)?t:{}}catch{return{}}}function P(e,t){for(let r of t){let n=e[r];if(typeof n==="string"&&n.length>0)return n}return null}function Qe(e,t){for(let r of t){let n=e[r];if(typeof n==="number"&&Number.isFinite(n))return n}return null}function Se(e){return Math.sqrt(e.reduce((t,r)=>t+r*r,0))}function ir(e,t,r=Se(t)){let n=Se(e);if(n===0||r===0)return 0;let i=Math.min(e.length,t.length),o=0;for(let u=0;u<i;u+=1)o+=e[u]*t[u];return o/(n*r)}function sr(e,t){let r=Ze("sha256").update(e).digest();return Array.from({length:t},(n,i)=>{let o=r[i%r.length]/255;return Number((o*2-1).toFixed(6))})}async function or(e,t,r=process.env){ie("openai",t,r);let n=ke(t,"openai"),{createOpenAI:i}=await import("@ai-sdk/openai"),o=i({apiKey:r[n.api_key_env],baseURL:n.base_url});if(o.embeddingModel)return o.embeddingModel(e);if(o.textEmbedding)return o.textEmbedding(e);if(o.textEmbeddingModel)return o.textEmbeddingModel(e);throw Error("OpenAI provider does not expose an embedding model factory.")}function Oe(e,t){if(!e||e==="default"||e==="embedding")return se(t).default_model??nr;return e}async function tt(e,t={}){let r=Oe(t.modelRef,t.config),n=F(r);if(n.provider!=="openai")throw Error(`Embedding provider ${n.provider} is not supported yet. Use openai:text-embedding-3-small.`);let i=t.dimensions??se(t.config).dimensions??et;if(t.fake)return{provider:n.provider,model:n.model,dimensions:i,vectors:e.map((s)=>sr(s,i)),usage:{input_tokens:e.reduce((s,d)=>s+Math.max(1,Math.ceil(d.split(/\s+/).filter(Boolean).length*1.25)),0)}};let{embedMany:o}=await import("ai"),u=await or(n.model,t.config,t.env),_=await o({model:u,values:e,maxParallelCalls:t.maxParallelCalls??se(t.config).max_parallel_calls,providerOptions:{openai:{dimensions:i}}}),a=_.embeddings;return{provider:n.provider,model:n.model,dimensions:a[0]?.length??i,vectors:a,usage:{input_tokens:_.usage?.tokens??0}}}function ar(e,t){if(t.sourceRevisionId)return e.query(`SELECT
       c.id,
       c.text,
       c.token_count,
       c.start_offset,
       c.end_offset,
       c.metadata_json,
       c.source_revision_id,
       sr.revision,
       sr.hash,
       s.uri AS source_uri,
       s.kind AS source_kind
     FROM chunks c
     LEFT JOIN source_revisions sr ON sr.id = c.source_revision_id
     LEFT JOIN sources s ON s.id = sr.source_id
     LEFT JOIN vector_index_entries v
       ON v.chunk_id = c.id AND v.provider = ? AND v.model = ?
     WHERE v.id IS NULL AND c.source_revision_id = ?
     ORDER BY c.created_at ASC, c.ordinal ASC
     LIMIT ?`).all(t.provider,t.model,t.sourceRevisionId,t.limit);return e.query(`SELECT
       c.id,
       c.text,
       c.token_count,
       c.start_offset,
       c.end_offset,
       c.metadata_json,
       c.source_revision_id,
       sr.revision,
       sr.hash,
       s.uri AS source_uri,
       s.kind AS source_kind
     FROM chunks c
     LEFT JOIN source_revisions sr ON sr.id = c.source_revision_id
     LEFT JOIN sources s ON s.id = sr.source_id
     LEFT JOIN vector_index_entries v
       ON v.chunk_id = c.id AND v.provider = ? AND v.model = ?
     WHERE v.id IS NULL
     ORDER BY c.created_at ASC, c.ordinal ASC
     LIMIT ?`).all(t.provider,t.model,t.limit)}function dr(e){let t=Re(e.metadata_json),r=t.provenance;if(r&&typeof r==="object"&&!Array.isArray(r))return r;return $({source_ref:P(t,["source_ref"]),source_uri:e.source_uri??P(t,["source_uri"]),source_kind:e.source_kind??P(t,["source_kind"]),source_revision_id:e.source_revision_id,revision:e.revision??P(t,["revision"]),hash:e.hash??P(t,["hash"]),chunk_id:e.id,start_offset:e.start_offset??Qe(t,["start_offset"]),end_offset:e.end_offset??Qe(t,["end_offset"]),status:P(t,["status"]),resolver:"open-files-read-only"})}function cr(e,t,r,n){let i=e.prepare(`
    INSERT INTO chunk_embeddings (id, chunk_id, provider, model, dimensions, vector_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chunk_id, provider, model) DO UPDATE SET
      dimensions = excluded.dimensions,
      vector_json = excluded.vector_json,
      created_at = excluded.created_at
  `),o=e.prepare(`
    INSERT INTO vector_index_entries (
      id, chunk_id, source_revision_id, provider, model, dimensions, vector_json, vector_norm,
      source_uri, source_ref, revision, hash, start_offset, end_offset, token_count, status,
      metadata_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chunk_id, provider, model) DO UPDATE SET
      source_revision_id = excluded.source_revision_id,
      dimensions = excluded.dimensions,
      vector_json = excluded.vector_json,
      vector_norm = excluded.vector_norm,
      source_uri = excluded.source_uri,
      source_ref = excluded.source_ref,
      revision = excluded.revision,
      hash = excluded.hash,
      start_offset = excluded.start_offset,
      end_offset = excluded.end_offset,
      token_count = excluded.token_count,
      status = excluded.status,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);return e.transaction(()=>{for(let _=0;_<t.length;_+=1){let a=t[_],s=r.vectors[_];if(!s)continue;let d=Re(a.metadata_json),c=dr(a),l=c.source_ref??P(d,["source_ref"]),f=c.source_uri??a.source_uri??P(d,["source_uri"]),h=c.revision??a.revision??P(d,["revision"]),y=c.hash??a.hash??P(d,["hash"]),v=c.status??P(d,["status"])??"active",T=JSON.stringify(s);i.run(Ve("emb",`${a.id}\x00${r.provider}\x00${r.model}`),a.id,r.provider,r.model,r.dimensions,T,n),o.run(Ve("vec",`${a.id}\x00${r.provider}\x00${r.model}`),a.id,a.source_revision_id,r.provider,r.model,r.dimensions,T,Se(s),f,l,h,y,c.start_offset,c.end_offset,a.token_count,v,JSON.stringify({...d,provenance:c,embedded_at:n}),n,n)}})(),t.length}async function rt(e){let t=Oe(e.modelRef,e.config),r=F(t);if(r.provider!=="openai")throw Error(`Embedding provider ${r.provider} is not supported yet.`);let n=(e.now??new Date).toISOString(),i=Math.max(1,Math.min(e.limit??100,1000));S(e.dbPath);let o=x(e.dbPath),u;try{u=ar(o,{provider:r.provider,model:r.model,limit:i,sourceRevisionId:e.sourceRevisionId})}finally{o.close()}if(u.length===0)return{provider:r.provider,model:r.model,dimensions:e.dimensions??se(e.config).dimensions??et,chunks_seen:0,chunks_embedded:0,embeddings_upserted:0,vector_entries_upserted:0,usage:{input_tokens:0}};let _=await tt(u.map((s)=>s.text),e),a=x(e.dbPath);try{let s=cr(a,u,_,n);return{provider:_.provider,model:_.model,dimensions:_.dimensions,chunks_seen:u.length,chunks_embedded:u.length,embeddings_upserted:s,vector_entries_upserted:s,usage:_.usage}}finally{a.close()}}function nt(e){S(e);let t=x(e);try{let r=t.query("SELECT COUNT(*) AS n FROM chunk_embeddings").get()?.n??0,n=t.query("SELECT COUNT(*) AS n FROM vector_index_entries").get()?.n??0,i=t.query(`SELECT provider, model, dimensions, COUNT(*) AS entries, MAX(updated_at) AS updated_at
       FROM vector_index_entries
       GROUP BY provider, model, dimensions
       ORDER BY provider, model`).all();return{total_embeddings:r,total_vector_entries:n,indexes:i}}finally{t.close()}}async function it(e){let t=Oe(e.modelRef,e.config),r=F(t),n=Math.max(1,Math.min(e.limit??10,100)),i=await tt([e.query],e),o=i.vectors[0]??[];S(e.dbPath);let u=x(e.dbPath);try{let a=u.query(`SELECT
         v.chunk_id,
         c.text,
         v.vector_json,
         v.vector_norm,
         v.source_uri,
         v.source_ref,
         v.revision,
         v.hash,
         v.metadata_json
       FROM vector_index_entries v
       JOIN chunks c ON c.id = v.chunk_id
       WHERE v.provider = ? AND v.model = ? AND v.status = 'active'`).all(r.provider,r.model).map((s)=>{let d=JSON.parse(s.vector_json),c=Re(s.metadata_json),l=c.provenance&&typeof c.provenance==="object"&&!Array.isArray(c.provenance)?c.provenance:null;return{chunk_id:s.chunk_id,score:ir(o,d,s.vector_norm),text:s.text,source_uri:s.source_uri,source_ref:s.source_ref,revision:s.revision,hash:s.hash,provenance:l}}).sort((s,d)=>d.score-s.score).slice(0,n);return{provider:r.provider,model:r.model,dimensions:i.dimensions,query:e.query,results:a}}finally{u.close()}}import{createHash as br,randomUUID as kr}from"crypto";import{existsSync as vr,readFileSync as xr}from"fs";import{basename as wr}from"path";function st(e,t){if(!e)throw Error(t);return e}function ur(e){let r=e.slice(13).split("/").filter(Boolean),n=r[0];if(n!=="file"&&n!=="source")throw Error("Invalid open-files ref. Expected open-files://file/<id>, open-files://file/<id>/revision/<revision_id>, or open-files://source/<id>/path/<path>.");let i=st(r[1],"Invalid open-files ref. Missing id.");if(n==="file"){if(r.length===2)return{kind:"open-files",uri:e,entity:n,id:i};if(r[2]==="revision"&&r[3]&&r.length===4)return{kind:"open-files",uri:e,entity:n,id:i,revision_id:decodeURIComponent(r[3])};throw Error("Invalid open-files file ref. Expected open-files://file/<id>/revision/<revision_id>.")}let o=r.indexOf("path"),u=o>=0?decodeURIComponent(r.slice(o+1).join("/")):void 0;return{kind:"open-files",uri:e,entity:n,id:i,path:u}}function lr(e){let t=new URL(e),r=st(t.hostname,"Invalid s3 ref. Missing bucket."),n=decodeURIComponent(t.pathname.replace(/^\/+/,""));if(!n)throw Error("Invalid s3 ref. Missing object key.");return{kind:"s3",uri:e,bucket:r,key:n}}function _r(e){let t=new URL(e);return{kind:"file",uri:e,path:decodeURIComponent(t.pathname)}}function fr(e){let t=new URL(e);return{kind:"web",uri:e,url:t.toString()}}function D(e){if(e.startsWith("open-files://"))return ur(e);if(e.startsWith("s3://"))return lr(e);if(e.startsWith("file://"))return _r(e);if(e.startsWith("https://")||e.startsWith("http://"))return fr(e);throw Error(`Unsupported source ref scheme: ${e}`)}function ot(e,t=D(e)){if(t.kind==="open-files"&&t.entity==="file"&&t.revision_id)return e.replace(/\/revision\/[^/]+$/,"");return e}function at(e){let t=D(e);return t.kind==="open-files"&&t.entity==="file"?t.revision_id??null:null}import{createHash as gr,randomUUID as Ne}from"crypto";import{relative as pr,resolve as ct,sep as mr}from"path";function dt(e){let t=process.env[e];return t==="1"||t==="true"||t==="yes"}function ut(e,t){let r=e,n=new Set(r.safety?.network?.allowed_s3_buckets??[]);if(e.storage.type==="s3"&&e.storage.s3?.bucket)n.add(e.storage.s3.bucket);if(process.env.HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS)for(let i of process.env.HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS.split(",").map((o)=>o.trim()).filter(Boolean))n.add(i);return{mode:e.mode,allowWriteRoots:[t.home,t.artifactsDir,t.cacheDir,t.exportsDir,t.indexesDir,t.logsDir,t.runsDir,t.schemasDir,t.wikiDir].map((i)=>ct(i)),readOnlySourceAccess:!0,network:{webSearchEnabled:r.safety?.network?.web_search_enabled??dt("HASNA_KNOWLEDGE_WEB_SEARCH"),s3ReadsEnabled:r.safety?.network?.s3_reads_enabled??dt("HASNA_KNOWLEDGE_ALLOW_S3_READS"),allowedS3Buckets:[...n].sort()},redaction:{enabled:r.safety?.redaction?.enabled??!0},approvals:{generatedWritesRequireApproval:r.safety?.approvals?.generated_writes_require_approval??!0}}}function hr(e,t){let r=pr(e,t);return r===""||!r.startsWith("..")&&r!==".."&&!r.startsWith(`..${mr}`)}function M(e,t){let r=ct(e);if(!t.allowWriteRoots.some((n)=>hr(n,r)))throw Error(`Safety policy denied write outside .hasna/apps/knowledge: ${e}`)}function K(e,t){let n=new URL(e).hostname;if(!t.network.s3ReadsEnabled)throw Error("Safety policy denied S3 read. Set safety.network.s3_reads_enabled=true or HASNA_KNOWLEDGE_ALLOW_S3_READS=1.");if(!t.network.allowedS3Buckets.includes(n))throw Error(`Safety policy denied S3 bucket "${n}". Add it to safety.network.allowed_s3_buckets or HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS.`)}function oe(e){if(!e.network.webSearchEnabled)throw Error("Safety policy denied web search. Set safety.network.web_search_enabled=true or HASNA_KNOWLEDGE_WEB_SEARCH=1.")}var Er=[{type:"private_key_block",severity:"high",regex:/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,replacement:"[REDACTED:private_key_block]"},{type:"secret_assignment",severity:"high",regex:/\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"]?[^'"\s]{8,}/gi,replacement:"[REDACTED:secret_assignment]"},{type:"openai_api_key",severity:"high",regex:/\bsk-[A-Za-z0-9_-]{20,}\b/g,replacement:"[REDACTED:openai_api_key]"},{type:"anthropic_api_key",severity:"high",regex:/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,replacement:"[REDACTED:anthropic_api_key]"},{type:"aws_access_key_id",severity:"high",regex:/\bA(?:KIA|SIA)[A-Z0-9]{16}\b/g,replacement:"[REDACTED:aws_access_key_id]"}];function ae(e,t){if(t&&!t.redaction.enabled)return{text:e,findings:[]};let r=e,n=[];for(let i of Er)r=r.replace(i.regex,(o,...u)=>{let _=typeof u.at(-2)==="number"?u.at(-2):r.indexOf(o);return n.push({type:i.type,severity:i.severity,start:Math.max(0,_),end:Math.max(0,_+o.length)}),i.replacement});return{text:r,findings:n}}function yr(e){return`audit_${gr("sha256").update(`${e.event_type}\x00${e.action}\x00${e.target_uri??""}\x00${e.created_at??""}\x00${JSON.stringify(e.metadata??{})}\x00${Ne()}`).digest("hex").slice(0,24)}`}function w(e,t){let r=t.created_at??new Date().toISOString(),n=yr({...t,created_at:r});return e.run(`INSERT INTO audit_events (id, event_type, action, target_uri, decision, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,[n,t.event_type,t.action,t.target_uri??null,t.decision,JSON.stringify(t.metadata??{}),r]),n}function de(e,t){let r=t.created_at??new Date().toISOString();for(let n of t.findings)e.run(`INSERT INTO redaction_findings (id, source_uri, run_id, severity, finding_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,[`redact_${Ne()}`,t.source_uri??null,t.run_id??null,n.severity,n.type,JSON.stringify({...t.metadata??{},start:n.start,end:n.end}),r]);return t.findings.length}function lt(e,t){let r=t.created_at??new Date().toISOString(),n=`approval_${Ne()}`;return e.run(`INSERT INTO approval_gates (id, action, target_uri, status, reason, approved_by, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,[n,t.action,t.target_uri??null,"approved",t.reason??null,t.approved_by??"local-cli",JSON.stringify(t.metadata??{}),r,r]),{id:n,status:"approved"}}function Tr(e,t,r){let n=e.query(`SELECT id FROM approval_gates
     WHERE action = ? AND status = 'approved' AND (target_uri IS NULL OR target_uri = ? OR ? IS NULL)
     ORDER BY updated_at DESC LIMIT 1`).get(t,r??null,r??null);return Boolean(n)}function _t(e,t,r,n){let i=r==="generated_write"&&t.approvals.generatedWritesRequireApproval,o=!i||Tr(e,r,n);return{action:r,target_uri:n??null,approval_required:i,approved:o,decision:o?"allow":"requires_approval"}}function ce(e,t){return`${e}_${br("sha256").update(t).digest("hex").slice(0,20)}`}function B(e){return e&&typeof e==="object"&&!Array.isArray(e)?e:void 0}function k(e){return typeof e==="string"&&e.length>0?e:void 0}function Sr(e){let t=k(e.source_ref)??k(e.source_uri)??k(e.uri);if(t)return t;let r=k(e.file_id);if(r){let o=k(e.revision_id)??k(e.revision),u=`open-files://file/${encodeURIComponent(r)}`;return o?`${u}/revision/${encodeURIComponent(o)}`:u}let n=k(e.source_id),i=k(e.path);if(n&&i)return`open-files://source/${encodeURIComponent(n)}/path/${encodeURIComponent(i)}`;throw Error("Outbox event is missing source_ref, file_id, or source_id/path.")}function Rr(e,t){if(t.kind==="open-files"&&t.entity==="file"&&t.revision_id)return e.replace(/\/revision\/[^/]+$/,"");return e}function Or(e){return k(e.hash)??k(e.checksum)??k(e.sha256)??null}function Nr(e,t,r){return k(e.revision_id)??k(e.revision)??k(e.version_id)??(t.kind==="open-files"?t.revision_id:void 0)??r??null}function Ar(e){return(k(e.event)??k(e.type)??k(e.action)??k(e.change_type)??"changed").toLowerCase()}function Ir(e){let t=k(e.path);return k(e.title)??k(e.name)??(t?wr(t):null)}function Lr(e,t){let r=Sr(e),n=D(r),i=Or(e);return{raw:e,eventType:Ar(e),sourceRef:r,sourceUri:Rr(r,n),kind:n.kind,title:Ir(e),revision:Nr(e,n,i),hash:i,status:k(e.status)?.toLowerCase()??null,updatedAt:k(e.updated_at)??t,acl:e.permissions??e.acl??void 0}}function Cr(e){let t=e.trim();if(!t)return[];if(t.startsWith("[")){let r=JSON.parse(t);if(!Array.isArray(r))throw Error("Outbox array parse failed.");return r.map((n)=>{let i=B(n);if(!i)throw Error("Outbox array entries must be objects.");return i})}if(t.startsWith("{"))try{let r=JSON.parse(t),n=B(r);if(!n)throw Error("Outbox object parse failed.");if(Array.isArray(n.events))return n.events.map((i)=>{let o=B(i);if(!o)throw Error("Outbox events entries must be objects.");return o});if("source_ref"in n||"source_uri"in n||"file_id"in n)return[n]}catch(r){let n=t.split(/\r?\n/).filter((i)=>i.trim().length>0);if(n.length<=1)throw r;return n.map((i)=>{let o=B(JSON.parse(i));if(!o)throw Error("Outbox JSONL entries must be objects.");return o})}return t.split(/\r?\n/).filter((r)=>r.trim().length>0).map((r)=>{let n=B(JSON.parse(r));if(!n)throw Error("Outbox JSONL entries must be objects.");return n})}async function Dr(e,t,r){let n=new URL(e),i=n.hostname,o=decodeURIComponent(n.pathname.replace(/^\/+/,""));if(!i||!o)throw Error(`Invalid S3 outbox URI: ${e}`);if(r)K(e,r);let[{S3Client:u,GetObjectCommand:_},{fromIni:a}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]),s=t?.storage.type==="s3"&&t.storage.s3?.bucket===i?t.storage.s3:void 0,c=await new u({region:s?.region,credentials:s?.profile?a({profile:s.profile}):void 0,maxAttempts:s?.max_attempts}).send(new _({Bucket:i,Key:o}));if(!c.Body)return"";return await c.Body.transformToString()}async function Pr(e,t,r){if(e.startsWith("s3://"))return Dr(e,t,r);if(!vr(e))throw Error(`Outbox not found: ${e}`);return xr(e,"utf8")}function ft(e,t){let r={};if(e)try{r=B(JSON.parse(e))??{}}catch{r={}}return JSON.stringify({...r,...t})}function Ur(e,t,r){let n=ce("src",t.sourceUri);e.run(`INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       kind = excluded.kind,
       title = COALESCE(excluded.title, sources.title),
       updated_at = excluded.updated_at`,[n,t.sourceUri,t.kind,t.title,JSON.stringify({source_ref:t.sourceRef,source_uri:t.sourceUri,status:t.status,last_outbox_event:t.eventType}),JSON.stringify(t.acl??{}),r,t.updatedAt]);let i=e.query("SELECT id, metadata_json, acl_json FROM sources WHERE uri = ?").get(t.sourceUri);if(!i)throw Error(`Failed to upsert source for outbox event: ${t.sourceUri}`);let o={source_ref:t.sourceRef,source_uri:t.sourceUri,last_outbox_event:t.eventType,last_outbox_at:t.updatedAt};if(t.status)o.status=t.status;if(k(t.raw.path))o.path=t.raw.path;return e.run("UPDATE sources SET metadata_json = ?, acl_json = CASE WHEN ? IS NULL THEN acl_json ELSE ? END, updated_at = ? WHERE id = ?",[ft(i.metadata_json,o),t.acl===void 0?null:JSON.stringify(t.acl),t.acl===void 0?null:JSON.stringify(t.acl),t.updatedAt,i.id]),i.id}function jr(e,t,r,n){if(!r.revision)return null;let i=ce("rev",`${t}\x00${r.revision}`),o={source_ref:r.sourceRef,source_uri:r.sourceUri,status:r.status,last_outbox_event:r.eventType,reindex_required:!0};return e.run(`INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, revision) DO UPDATE SET
       hash = COALESCE(excluded.hash, source_revisions.hash),
       metadata_json = excluded.metadata_json`,[i,t,r.revision,r.hash,k(r.raw.extracted_text_ref)??null,JSON.stringify(o),n]),e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").get(t,r.revision)?.id??null}function Kr(e,t,r){if(r.revision)return e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").all(t,r.revision).map((n)=>n.id);if(r.hash)return e.query("SELECT id FROM source_revisions WHERE source_id = ? AND hash = ?").all(t,r.hash).map((n)=>n.id);return e.query("SELECT id FROM source_revisions WHERE source_id = ?").all(t).map((n)=>n.id)}function Fr(e,t){let r=e.query("SELECT id FROM chunks WHERE source_revision_id = ?").all(t),n=0,i=0;for(let u of r){let _=e.query("SELECT COUNT(*) AS n FROM chunk_embeddings WHERE chunk_id = ?").get(u.id);n+=_?.n??0;let a=e.query("SELECT COUNT(*) AS n FROM vector_index_entries WHERE chunk_id = ?").get(u.id);i+=a?.n??0,e.run("DELETE FROM vector_index_entries WHERE chunk_id = ?",[u.id]),e.run("DELETE FROM chunk_embeddings WHERE chunk_id = ?",[u.id]),e.run("DELETE FROM chunks_fts WHERE chunk_id = ?",[u.id])}e.run("DELETE FROM chunks WHERE source_revision_id = ?",[t]);let o=e.query("SELECT metadata_json FROM source_revisions WHERE id = ?").get(t);return e.run("UPDATE source_revisions SET metadata_json = ? WHERE id = ?",[ft(o?.metadata_json,{reindex_required:!0,invalidated_at:new Date().toISOString()}),t]),{chunksDeleted:r.length,embeddingsDeleted:n,vectorEntriesDeleted:i}}function Mr(e,t){return t==="deleted"||["delete","deleted","remove","removed"].includes(e)}function Xr(e){return["move","moved","rename","renamed","path_changed"].includes(e)}function Wr(e){return["permission","permissions","permission_changed","acl_changed"].includes(e)}async function gt(e){let t=(e.now??new Date).toISOString();if(e.safetyPolicy)M(e.dbPath,e.safetyPolicy);S(e.dbPath);let r=await Pr(e.input,e.config,e.safetyPolicy),n=Cr(r),i=x(e.dbPath),o=`run_${kr()}`;try{return i.transaction(()=>{i.run(`INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,[o,"open-files-outbox",e.input,"completed","local","open-files-outbox",JSON.stringify({path:e.input,events:n.length}),t,t]);let u=new Set,_=new Set,a=0,s=0,d=0,c=0,l=0,f=0,h=0;return w(i,{event_type:"source_read",action:e.input.startsWith("s3://")?"s3_outbox_read":"local_outbox_read",target_uri:e.input,decision:"allow",metadata:{events:n.length,read_only:!0},created_at:t}),n.forEach((y,v)=>{let T=Lr(y,t),b=Ur(i,T,t);u.add(b);let R=jr(i,b,T,t);if(R)_.add(R);let g=Kr(i,b,T);for(let A of g){_.add(A);let p=Fr(i,A);a+=p.chunksDeleted,s+=p.embeddingsDeleted,d+=p.vectorEntriesDeleted,c+=1}if(Mr(T.eventType,T.status))l+=1;if(Xr(T.eventType))f+=1;if(Wr(T.eventType)||T.acl!==void 0)h+=1;i.run(`INSERT INTO run_events (id, run_id, level, event, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,[ce("evt",`${o}\x00${v}\x00${T.sourceRef}\x00${T.eventType}`),o,"info",T.eventType,JSON.stringify({source_ref:T.sourceRef,source_uri:T.sourceUri,revision:T.revision,hash:T.hash,status:T.status,affected_revisions:g.length}),T.updatedAt])}),i.run(`INSERT INTO provider_usage (id, run_id, provider, model, input_tokens, output_tokens, cost_usd, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`,[ce("usage",o),o,"local","open-files-outbox",JSON.stringify({note:"No model provider used for outbox invalidation."}),t]),w(i,{event_type:"write",action:"knowledge_outbox_invalidation",target_uri:e.dbPath,decision:"allow",metadata:{run_id:o,events:n.length,sources:u.size,revisions:_.size,chunks_deleted:a,embeddings_deleted:s,vector_entries_deleted:d},created_at:t}),{path:e.input,db_path:e.dbPath,run_id:o,events_seen:n.length,sources_touched:u.size,revisions_touched:_.size,chunks_deleted:a,embeddings_deleted:s,vector_entries_deleted:d,stale_revisions:c,deleted_sources:l,moved_sources:f,permission_updates:h}})()}finally{i.close()}}import{createHash as $r}from"crypto";import{existsSync as Br,readFileSync as qr}from"fs";import{basename as zr}from"path";function Ae(e,t){return`${e}_${$r("sha256").update(t).digest("hex").slice(0,20)}`}function q(e){return e&&typeof e==="object"&&!Array.isArray(e)?e:void 0}function E(e){return typeof e==="string"&&e.length>0?e:void 0}function Gr(e){return typeof e==="number"&&Number.isFinite(e)?e:void 0}function Hr(e){let t=E(e.source_ref)??E(e.source_uri)??E(e.uri);if(t)return t;let r=E(e.file_id);if(r){let o=E(e.revision_id)??E(e.revision),u=`open-files://file/${encodeURIComponent(r)}`;return o?`${u}/revision/${encodeURIComponent(o)}`:u}let n=E(e.source_id),i=E(e.path);if(n&&i)return`open-files://source/${encodeURIComponent(n)}/path/${encodeURIComponent(i)}`;throw Error("Manifest item is missing source_ref, file_id, or source_id/path.")}function Yr(e,t){if(t.kind==="open-files"&&t.entity==="file"&&t.revision_id)return e.replace(/\/revision\/[^/]+$/,"");return e}function Jr(e){let t=E(e.extracted_text)??E(e.text)??E(e.content_text)??E(e.markdown);if(t!==void 0)return t;let r=e.content;return typeof r==="string"?r:null}function Vr(e){let t=E(e.extracted_text_ref)??E(e.extracted_text_uri)??E(e.text_ref);if(t)return t;let r=q(e.content);return E(r?.extracted_text_ref)??E(r?.extracted_text_uri)??null}function Qr(e){let t=E(e.path);return E(e.title)??E(e.name)??(t?zr(t):null)}function Zr(e){return E(e.hash)??E(e.checksum)??E(e.sha256)??null}function en(e,t,r){return E(e.revision_id)??E(e.revision)??E(e.version_id)??(t.kind==="open-files"?t.revision_id:void 0)??r??E(e.updated_at)??"current"}function tn(e,t){let r={};for(let[n,i]of Object.entries(e)){if(["text","content","content_text","extracted_text","markdown"].includes(n))continue;r[n]=i}return r.source_ref=t.sourceRef,r.source_uri=t.sourceUri,r.status=t.status,r}function rn(e,t){let r=Hr(e),n=D(r),i=Yr(r,n),o=Zr(e),u=E(e.status)??"active";return{raw:e,sourceRef:r,sourceUri:i,kind:n.kind,title:Qr(e),revision:en(e,n,o),hash:o,extractedTextUri:Vr(e),text:Jr(e),metadata:tn(e,{sourceRef:r,sourceUri:i,status:u}),acl:e.permissions??e.acl??{},status:u,updatedAt:E(e.updated_at)??t}}function nn(e){let t=e.trim();if(!t)return[];if(t.startsWith("[")){let r=JSON.parse(t);if(!Array.isArray(r))throw Error("Manifest array parse failed.");return r.map((n)=>{let i=q(n);if(!i)throw Error("Manifest array entries must be objects.");return i})}if(t.startsWith("{"))try{let r=JSON.parse(t),n=q(r);if(!n)throw Error("Manifest object parse failed.");if(Array.isArray(n.items))return n.items.map((i)=>{let o=q(i);if(!o)throw Error("Manifest items entries must be objects.");return o});if("source_ref"in n||"source_uri"in n||"file_id"in n)return[n]}catch(r){let n=t.split(/\r?\n/).filter((i)=>i.trim().length>0);if(n.length<=1)throw r;return n.map((i)=>{let o=q(JSON.parse(i));if(!o)throw Error("Manifest JSONL entries must be objects.");return o})}return t.split(/\r?\n/).filter((r)=>r.trim().length>0).map((r)=>{let n=q(JSON.parse(r));if(!n)throw Error("Manifest JSONL entries must be objects.");return n})}async function sn(e,t,r){let n=new URL(e),i=n.hostname,o=decodeURIComponent(n.pathname.replace(/^\/+/,""));if(!i||!o)throw Error(`Invalid S3 manifest URI: ${e}`);if(r)K(e,r);let[{S3Client:u,GetObjectCommand:_},{fromIni:a}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]),s=t?.storage.type==="s3"&&t.storage.s3?.bucket===i?t.storage.s3:void 0,c=await new u({region:s?.region,credentials:s?.profile?a({profile:s.profile}):void 0,maxAttempts:s?.max_attempts}).send(new _({Bucket:i,Key:o}));if(!c.Body)return"";return await c.Body.transformToString()}async function on(e,t,r){if(e.startsWith("s3://"))return sn(e,t,r);if(!Br(e))throw Error(`Manifest not found: ${e}`);return qr(e,"utf8")}function an(e,t,r){let n=e.replace(/\r\n/g,`
`);if(!n.trim())return[];let i=[],o=0;while(o<n.length){let u=Math.min(n.length,o+t),_=u;if(u<n.length){let s=n.lastIndexOf(`

`,u),d=n.lastIndexOf(". ",u),c=Math.max(s,d);if(c>o+Math.floor(t*0.5))_=c+(c===s?2:1)}let a=n.slice(o,_).trim();if(a)i.push({ordinal:i.length,text:a,startOffset:o,endOffset:_});if(_>=n.length)break;o=Math.max(0,_-r)}return i}function dn(e){let t=e.trim().split(/\s+/).filter(Boolean).length;return Math.max(1,Math.ceil(t*1.25))}function cn(e,t){let r=e.query("SELECT id FROM chunks WHERE source_revision_id = ?").all(t);for(let n of r)e.run("DELETE FROM chunks_fts WHERE chunk_id = ?",[n.id]);return e.run("DELETE FROM chunks WHERE source_revision_id = ?",[t]),r.length}function un(e,t,r){let n=Ae("src",t.sourceUri);e.run(`INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       kind = excluded.kind,
       title = excluded.title,
       metadata_json = excluded.metadata_json,
       acl_json = excluded.acl_json,
       updated_at = excluded.updated_at`,[n,t.sourceUri,t.kind,t.title,JSON.stringify(t.metadata),JSON.stringify(t.acl??{}),r,t.updatedAt]);let i=e.query("SELECT id FROM sources WHERE uri = ?").get(t.sourceUri);if(!i)throw Error(`Failed to upsert source: ${t.sourceUri}`);return i.id}function ln(e,t,r,n){let i=Ae("rev",`${t}\x00${r.revision}`);e.run(`INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, revision) DO UPDATE SET
       hash = excluded.hash,
       extracted_text_uri = excluded.extracted_text_uri,
       metadata_json = excluded.metadata_json`,[i,t,r.revision,r.hash,r.extractedTextUri,JSON.stringify(r.metadata),n]);let o=e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").get(t,r.revision);if(!o)throw Error(`Failed to upsert source revision: ${r.sourceRef}`);return o.id}function _n(e,t,r,n,i,o,u){if(!r.text||r.status.toLowerCase()==="deleted")return{chunksInserted:0,redactions:0};let _=ae(r.text,u);if(_.findings.length>0)de(e,{source_uri:r.sourceUri,findings:_.findings,metadata:{source_ref:r.sourceRef,revision:r.revision},created_at:n}),w(e,{event_type:"redaction",action:"source_text_redact",target_uri:r.sourceUri,decision:"redacted",metadata:{findings:_.findings.length,source_ref:r.sourceRef,revision:r.revision},created_at:n});let a=an(_.text,i,o);for(let s of a){let d=Ae("chk",`${t}\x00${s.ordinal}\x00${s.text}`),c=$({source_ref:r.sourceRef,source_uri:r.sourceUri,source_kind:r.kind,source_revision_id:t,revision:r.revision,hash:r.hash,chunk_id:d,start_offset:s.startOffset,end_offset:s.endOffset,status:r.status,resolver:"open-files-read-only"}),l=Je({source_ref:r.sourceRef,source_uri:r.sourceUri,source_kind:r.kind,source_revision_id:t,revision:r.revision,hash:r.hash,status:r.status,path:E(r.raw.path)??null,mime:E(r.raw.mime)??E(r.raw.content_type)??null,size:Gr(r.raw.size)??null},c);e.run(`INSERT INTO chunks (id, source_revision_id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,[d,t,"source",s.ordinal,s.text,dn(s.text),s.startOffset,s.endOffset,JSON.stringify(l),n]),e.run("INSERT INTO chunks_fts (chunk_id, text, title, source_uri) VALUES (?, ?, ?, ?)",[d,s.text,r.title??"",r.sourceUri])}return{chunksInserted:a.length,redactions:_.findings.length}}async function pt(e){let t=e.now??new Date;if(e.safetyPolicy)M(e.dbPath,e.safetyPolicy);S(e.dbPath);let r=await on(e.input,e.config,e.safetyPolicy),n=nn(r);return Ie({dbPath:e.dbPath,items:n,sourceLabel:e.input,safetyPolicy:e.safetyPolicy,now:t,maxChunkChars:e.maxChunkChars,chunkOverlapChars:e.chunkOverlapChars})}async function Ie(e){let t=(e.now??new Date).toISOString(),r=e.maxChunkChars??4000,n=e.chunkOverlapChars??200;if(r<500)throw Error("maxChunkChars must be at least 500.");if(n<0||n>=r)throw Error("chunkOverlapChars must be less than maxChunkChars.");if(e.safetyPolicy)M(e.dbPath,e.safetyPolicy);S(e.dbPath);let i=x(e.dbPath);try{return i.transaction(()=>{let u=new Set,_=new Set,a=0,s=0,d=0,c=0;w(i,{event_type:"source_read",action:e.readAction??(e.sourceLabel.startsWith("s3://")?"s3_manifest_read":"local_manifest_read"),target_uri:e.sourceLabel,decision:"allow",metadata:{items:e.items.length,read_only:!0},created_at:t});for(let l of e.items){let f=rn(l,t),h=un(i,f,t),y=ln(i,h,f,t);if(u.add(h),_.add(y),f.text||f.status.toLowerCase()==="deleted")s+=cn(i,y);let v=_n(i,y,f,t,r,n,e.safetyPolicy);a+=v.chunksInserted,d+=v.redactions}return w(i,{event_type:"write",action:"knowledge_manifest_ingest",target_uri:e.dbPath,decision:"allow",metadata:{items:e.items.length,sources:u.size,revisions:_.size,chunks_inserted:a,redactions:d},created_at:t}),{path:e.sourceLabel,db_path:e.dbPath,items_seen:e.items.length,sources_upserted:u.size,revisions_upserted:_.size,chunks_inserted:a,chunks_deleted:s,redactions:d,skipped:c}})()}finally{i.close()}}import{createHash as yn}from"crypto";import{existsSync as Tn,readFileSync as bn}from"fs";import{basename as _e}from"path";function ue(e){if(!e)return{};try{let t=JSON.parse(e);return t&&typeof t==="object"&&!Array.isArray(t)?t:{}}catch{return{}}}function X(e,t){for(let r of t){let n=e[r];if(typeof n==="string"&&n.length>0)return n}return null}function mt(e,t){for(let r of t){let n=e[r];if(typeof n==="number"&&Number.isFinite(n))return n}return null}function fn(e,t){let r=e.mode;if(typeof r==="string"&&r!=="read_only")throw Error(`Source resolver denied ${t}. Permission mode is ${r}, expected read_only.`);let n=e.denied_purposes;if(Array.isArray(n)&&n.includes(t))throw Error(`Source resolver denied ${t}. Purpose is explicitly denied.`);let i=e.allowed_purposes;if(Array.isArray(i)&&i.length>0&&!i.includes(t))throw Error(`Source resolver denied ${t}. Allowed purposes: ${i.join(", ")}`)}function gn(e,t,r){if(!t)return r;try{let n=D(e);if(n.kind==="open-files"&&n.entity==="file")return`${e}/revision/${encodeURIComponent(t.revision)}`}catch{return r}return r}function pn(e,t,r){return e.query(`SELECT id, uri, kind, title, metadata_json, acl_json, updated_at
     FROM sources
     WHERE uri = ? OR uri = ?
     ORDER BY CASE WHEN uri = ? THEN 0 ELSE 1 END
     LIMIT 1`).get(t,r,t)??null}function mn(e,t,r){if(r)return e.query(`SELECT id, revision, hash, extracted_text_uri, metadata_json, created_at
       FROM source_revisions
       WHERE source_id = ? AND revision = ?
       LIMIT 1`).get(t,r)??null;return e.query(`SELECT id, revision, hash, extracted_text_uri, metadata_json, created_at
     FROM source_revisions
     WHERE source_id = ?
     ORDER BY created_at DESC, revision DESC
     LIMIT 1`).get(t)??null}function hn(e,t){if(!t)return 0;return e.query("SELECT COUNT(*) AS n FROM chunks WHERE source_revision_id = ?").get(t)?.n??0}function En(e,t,r){if(!t||r<=0)return[];return e.query(`SELECT id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json
     FROM chunks
     WHERE source_revision_id = ?
     ORDER BY ordinal ASC
     LIMIT ?`).all(t,r)}async function le(e){let t=e.purpose??"knowledge_answer",r=Math.max(0,Math.min(e.limit??10,100)),n=(e.now??new Date).toISOString(),i=D(e.sourceRef),o=ot(e.sourceRef,i),u=at(e.sourceRef);if(e.safetyPolicy){if(!e.safetyPolicy.readOnlySourceAccess)throw Error("Safety policy denied source resolution.");M(e.dbPath,e.safetyPolicy)}S(e.dbPath);let _=x(e.dbPath);try{return _.transaction(()=>{let a=pn(_,o,e.sourceRef);if(!a)return w(_,{event_type:"source_read",action:"open_files_resolve_missing",target_uri:e.sourceRef,decision:"allow",metadata:{purpose:t,read_only:!0,source_uri:o},created_at:n}),{source_ref:e.sourceRef,source_uri:o,purpose:t,read_only:!0,resolved:!1,resolver:{name:"open-files-read-only",mode:"local_catalog",contract:"open-files-knowledge-source-v1"},source:null,revision:null,content:{mime:null,size:null,hash:null,text_available:!1,chunks_total:0,chunks_returned:0,char_count_returned:0,extracted_text_ref:null,bytes_available:!1,bytes_exposed:!1},chunks:[],citations:[]};let s=ue(a.metadata_json),d=ue(a.acl_json);try{fn(d,t)}catch(g){throw w(_,{event_type:"source_read",action:"open_files_resolve",target_uri:e.sourceRef,decision:"deny",metadata:{purpose:t,read_only:!0,source_uri:a.uri,error:g instanceof Error?g.message:String(g)},created_at:n}),g}let c=mn(_,a.id,u),l=ue(c?.metadata_json),f=hn(_,c?.id??null),h=En(_,c?.id??null,r),y=gn(a.uri,c,e.sourceRef),v=h.map((g)=>{let A=ue(g.metadata_json),p={resolver:"open-files-read-only",mode:"local_catalog",purpose:t,read_only:!0,source_ref:X(A,["source_ref"])??y,source_uri:a.uri,source_revision_id:c?.id??null,revision:c?.revision??null,hash:c?.hash??X(A,["hash"]),chunk_id:g.id,start_offset:g.start_offset,end_offset:g.end_offset,resolved_at:n},G=$({source_ref:p.source_ref,source_uri:p.source_uri,source_kind:a.kind,source_revision_id:p.source_revision_id,revision:p.revision,hash:p.hash,chunk_id:g.id,start_offset:g.start_offset,end_offset:g.end_offset,status:X(A,["status"]),resolver:p.resolver});return{id:g.id,kind:g.kind,ordinal:g.ordinal,text:g.text,token_count:g.token_count,start_offset:g.start_offset,end_offset:g.end_offset,metadata:A,evidence:p,provenance:G}}),T=v.map((g)=>({source_ref:g.evidence.source_ref,source_uri:a.uri,chunk_id:g.id,quote:g.text.slice(0,500),start_offset:g.start_offset,end_offset:g.end_offset,evidence:g.evidence,provenance:g.provenance}));w(_,{event_type:"source_read",action:"open_files_resolve",target_uri:e.sourceRef,decision:"allow",metadata:{purpose:t,read_only:!0,source_uri:a.uri,revision:c?.revision??null,chunks_returned:v.length,chunks_total:f},created_at:n});let b=X(s,["mime","content_type"])??X(l,["mime","content_type"]),R=mt(s,["size","size_bytes"])??mt(l,["size","size_bytes"]);return{source_ref:y,source_uri:a.uri,purpose:t,read_only:!0,resolved:!0,resolver:{name:"open-files-read-only",mode:"local_catalog",contract:"open-files-knowledge-source-v1"},source:{id:a.id,uri:a.uri,kind:a.kind,title:a.title,metadata:s,permissions:d,updated_at:a.updated_at},revision:c?{id:c.id,revision:c.revision,hash:c.hash,extracted_text_uri:c.extracted_text_uri,metadata:l,created_at:c.created_at,reindex_required:l.reindex_required===!0}:null,content:{mime:b,size:R,hash:c?.hash??X(s,["hash","checksum","sha256"]),text_available:f>0,chunks_total:f,chunks_returned:v.length,char_count_returned:v.reduce((g,A)=>g+A.text.length,0),extracted_text_ref:c?.extracted_text_uri??X(l,["extracted_text_ref","extracted_text_uri"]),bytes_available:!1,bytes_exposed:!1},chunks:v,citations:T}})()}finally{_.close()}}function z(e){return`sha256:${yn("sha256").update(e).digest("hex")}`}function kn(e){return e.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+\n/g,`
`).replace(/\n\s+/g,`
`).replace(/[ \t]{2,}/g," ").trim()}async function vn(e,t,r){let n=new URL(e),i=n.hostname,o=decodeURIComponent(n.pathname.replace(/^\/+/,""));if(!i||!o)throw Error(`Invalid S3 source URI: ${e}`);if(r)K(e,r);let[{S3Client:u,GetObjectCommand:_},{fromIni:a}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]),s=t?.storage.type==="s3"&&t.storage.s3?.bucket===i?t.storage.s3:void 0,c=await new u({region:s?.region,credentials:s?.profile?a({profile:s.profile}):void 0,maxAttempts:s?.max_attempts}).send(new _({Bucket:i,Key:o}));if(!c.Body)return"";return await c.Body.transformToString()}async function xn(e,t){if(t)oe(t);let r=await fetch(e,{headers:{accept:"text/markdown,text/plain,text/html,application/json;q=0.8,*/*;q=0.5","user-agent":"@hasna/knowledge source-ingest"}});if(!r.ok)throw Error(`Web source read failed ${r.status}: ${e}`);let n=r.headers.get("content-type"),i=await r.text();return{text:n?.includes("html")?kn(i):i,mime:n}}function fe(e){if(e.kind==="file")return _e(e.path);if(e.kind==="s3")return _e(e.key);if(e.kind==="web")return _e(new URL(e.url).pathname)||e.url;return e.path?_e(e.path):e.id}async function ht(e,t,r){if(e.kind==="file"){if(!Tn(e.path))throw Error(`Source file not found: ${e.path}`);let n=bn(e.path,"utf8");return{text:n,contentSource:"file",title:fe(e),mime:"text/plain",size:n.length,hash:z(n),revision:null,extractedTextRef:null,metadata:{path:e.path},permissions:{mode:"read_only"}}}if(e.kind==="s3"){let n=await vn(e.uri,t,r);return{text:n,contentSource:"s3",title:fe(e),mime:"text/plain",size:n.length,hash:z(n),revision:null,extractedTextRef:null,metadata:{bucket:e.bucket,key:e.key},permissions:{mode:"read_only"}}}if(e.kind==="web"){let n=await xn(e.url,r);return{text:n.text,contentSource:"web",title:fe(e),mime:n.mime,size:n.text.length,hash:z(n.text),revision:null,extractedTextRef:null,metadata:{url:e.url},permissions:{mode:"read_only"}}}throw Error(`Direct source reading is not available for ${e.uri}`)}async function wn(e,t,r){if(e.startsWith("open-files://"))throw Error("Open-files extracted text refs require an open-files resolver API. Ingest an open-files manifest with extracted_text or an extracted_text_ref using file://, s3://, or https://.");let n=D(e);return{text:(await ht(n,t,r)).text,contentSource:"extracted_text_ref"}}async function Sn(e){let t=await le({dbPath:e.dbPath,sourceRef:e.sourceRef,purpose:e.purpose??"knowledge_index",limit:100,safetyPolicy:e.safetyPolicy,now:e.now});if(!t.resolved)throw Error("Open-files source is not in the local knowledge catalog. Ingest an open-files manifest first or use the open-files resolver API.");if(t.revision?.extracted_text_uri&&!t.content.text_available){let n=await wn(t.revision.extracted_text_uri,e.config,e.safetyPolicy);return{text:n.text,contentSource:n.contentSource,title:t.source?.title??null,mime:t.content.mime,size:n.text.length,hash:t.revision.hash??z(n.text),revision:t.revision.revision,extractedTextRef:t.revision.extracted_text_uri,metadata:t.source?.metadata??{},permissions:t.source?.permissions??{mode:"read_only"}}}if(t.chunks.length===0)throw Error("Open-files source has no extracted text chunks yet. Ingest an open-files manifest with extracted_text or extracted_text_ref first.");let r=t.chunks.map((n)=>n.text).join(`

`);return{text:r,contentSource:"catalog_chunks",title:t.source?.title??null,mime:t.content.mime,size:r.length,hash:t.revision?.hash??z(r),revision:t.revision?.revision??null,extractedTextRef:t.revision?.extracted_text_uri??null,metadata:t.source?.metadata??{},permissions:t.source?.permissions??{mode:"read_only"}}}function Rn(e,t,r,n){let i=r.hash??z(r.text),o={...r.metadata,source_ref:e,content_source:r.contentSource,read_only:!0},u={source_ref:e,name:r.title??fe(t),mime:r.mime??"text/plain",size:r.size??r.text.length,hash:i,revision:r.revision??i,status:"active",updated_at:new Date().toISOString(),permissions:{mode:"read_only",allowed_purposes:[n],...r.permissions},metadata:o,extracted_text_ref:r.extractedTextRef,extracted_text:r.text};if(t.kind==="open-files"){if(t.entity==="file")u.file_id=t.id;if(t.entity==="source")u.source_id=t.id,u.path=t.path}if(t.kind==="file")u.path=t.path;if(t.kind==="s3")u.path=t.key;if(t.kind==="web")u.url=t.url;return u}async function Et(e){let t=e.purpose??"knowledge_index",r=D(e.sourceRef),n=r.kind==="open-files"?await Sn(e):await ht(r,e.config,e.safetyPolicy),i=Rn(e.sourceRef,r,n,t);return{...await Ie({dbPath:e.dbPath,items:[i],sourceLabel:e.sourceRef,readAction:"source_ref_ingest_read",safetyPolicy:e.safetyPolicy,now:e.now}),source_ref:e.sourceRef,content_source:n.contentSource,read_only:!0,hash:String(i.hash)}}import{createHash as On,randomUUID as Nn}from"crypto";var yt=[{kind:"schema",prefix:"schemas/",description:"Machine-readable agent schemas and source rules."},{kind:"index",prefix:"indexes/",description:"Small orientation indexes and future shard manifests."},{kind:"log",prefix:"logs/",description:"Append-only JSONL run and wiki-maintenance log partitions."},{kind:"run",prefix:"runs/",description:"Prompt/tool/cost ledgers and generated output records."},{kind:"wiki_page",prefix:"wiki/",description:"Generated cited Markdown pages, not raw source files."},{kind:"export",prefix:"exports/",description:"Portable exports and snapshots of derived knowledge state."}];function Tt(e){let t=typeof e==="string"?Buffer.from(e):Buffer.from(e);return{hash:`sha256:${On("sha256").update(t).digest("hex")}`,size_bytes:t.byteLength}}function bt(e){return yt.find((r)=>e.startsWith(r.prefix))?.kind??"artifact"}function kt(e,t,r="global"){let n=Le(e,t),i=e.storage.s3??null,o=i?.prefix?.replace(/^\/+|\/+$/g,"")??"",u=i?`s3://${i.bucket}/${o?`${o}/`:""}`:"";return{scope:r,mode:e.mode,storage_type:e.storage.type,workspace_home:t.home,local_layout:{app_path:Y,config_path:t.configPath,json_store_path:t.jsonStorePath,knowledge_db_path:t.knowledgeDbPath,directories:{artifacts:t.artifactsDir,cache:t.cacheDir,exports:t.exportsDir,indexes:t.indexesDir,logs:t.logsDir,runs:t.runsDir,schemas:t.schemasDir,wiki:t.wikiDir}},artifact_store:{type:e.storage.type,artifacts_root:e.storage.artifacts_root,uri_prefix:e.storage.type==="s3"?u:`file://${t.artifactsDir}/`,s3:i?{bucket:i.bucket,prefix:o,region:i.region??null,profile:i.profile??null,server_side_encryption:i.server_side_encryption??null,kms_key_configured:Boolean(i.kms_key_id)}:null},source_ownership:{owner:"open-files",preferred_ref:e.sources.preferred_ref,allowed_schemes:e.sources.allowed_schemes,raw_source_bytes_stored_in_open_knowledge:!1,stores:["source refs","source revisions and hashes","citation spans","redacted extracted chunks","embeddings","generated wiki artifacts","indexes","run ledgers"],does_not_store:["raw open-files bytes","S3 object credentials","connector secrets","hosted tenant ownership state"]},generated_artifacts:yt,scalability:{catalog:"knowledge.db tracks sources, revisions, chunks, citations, indexes, runs, and storage_objects.",indexes:"Indexes are cataloged DB rows plus sharded artifacts, not one giant index.md.",logs:"Logs use dated JSONL partitions under logs/yyyy/mm/dd.jsonl.",markdown:"Markdown pages are the readable wiki layer over DB/object-store state."},warnings:n.warnings}}function Le(e,t){let r=[],n=[];if(!t.home.endsWith(Y))n.push(`Workspace home does not end with ${Y}: ${t.home}`);if(e.storage.type==="s3"){if(!e.storage.s3?.bucket)r.push("storage.s3.bucket is required when storage.type is s3.");if(!e.storage.s3?.prefix)n.push("storage.s3.prefix is empty; generated knowledge artifacts will be written at the bucket root.");if(e.mode==="local")n.push("storage.type is s3 while mode is local; this is valid for BYO S3, but hosted wrappers should set mode to hosted.")}if(e.storage.type==="local"&&e.storage.s3)n.push("storage.s3 is configured but ignored while storage.type is local.");if(e.sources.preferred_ref!=="open-files")n.push("sources.preferred_ref should stay open-files for durable company knowledge.");if(!e.sources.allowed_schemes.includes("open-files"))r.push("sources.allowed_schemes must include open-files.");return{ok:r.length===0,errors:r,warnings:n}}function vt(e,t,r=new Date){let n=r.toISOString(),i=e.prepare(`
    INSERT INTO storage_objects (
      id, artifact_uri, kind, content_type, hash, size_bytes, metadata_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(artifact_uri) DO UPDATE SET
      kind = excluded.kind,
      content_type = excluded.content_type,
      hash = excluded.hash,
      size_bytes = excluded.size_bytes,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);e.transaction((u)=>{for(let _ of u)i.run(Nn(),_.uri,_.kind,_.content_type??null,_.hash??null,_.size_bytes??null,JSON.stringify({key:_.key,..._.metadata??{}}),n,n)})(t)}import{createHash as An}from"crypto";function In(e){let t=String(e.getUTCFullYear()),r=String(e.getUTCMonth()+1).padStart(2,"0"),n=String(e.getUTCDate()).padStart(2,"0");return{year:t,month:r,day:n}}function xt(e,t){return`${e}_${An("sha256").update(t).digest("hex").slice(0,20)}`}function Ln(){return`# Knowledge Agent Schema v1

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
`}function Cn(){return`# Knowledge Index

This is a compact orientation index for agents. It is not the full search index.

## Shards

- wiki/
- indexes/
- schemas/
- logs/

## Source Ownership

Raw source files are resolved through open-files. This app stores source refs,
citations, chunks, generated wiki artifacts, indexes, and run records.
`}function Dn(){return`# Wiki

Generated durable knowledge pages live here.

Pages should be concise, cited, and organized for both humans and agents.
`}async function St(e,t=new Date){let{year:r,month:n,day:i}=In(t),o="schemas/v1.md",u="indexes/root.md",_="wiki/README.md",a=`logs/${r}/${n}/${i}.jsonl`,s={ts:t.toISOString(),event:"wiki_layout_initialized",schema_key:"schemas/v1.md",root_index_key:"indexes/root.md",wiki_readme_key:"wiki/README.md"},d=[{key:"schemas/v1.md",body:Ln(),content_type:"text/markdown"},{key:"indexes/root.md",body:Cn(),content_type:"text/markdown"},{key:"wiki/README.md",body:Dn(),content_type:"text/markdown"},{key:a,body:`${JSON.stringify(s)}
`,content_type:"application/x-ndjson"}],c=await Promise.all(d.map(async(l)=>{let f=await e.put(l);return{key:f.key,uri:f.uri,kind:bt(l.key),content_type:l.content_type,metadata:{provenance:we({generated_from:"wiki_layout_init",artifact_key:l.key,citation_required:l.key.startsWith("wiki/")||l.key.startsWith("indexes/")})},...Tt(l.body)}}));return{schema_key:"schemas/v1.md",root_index_key:"indexes/root.md",wiki_readme_key:"wiki/README.md",log_key:a,artifacts:c,written:["schemas/v1.md","indexes/root.md","wiki/README.md",a]}}function wt(e){let t=e.metadata?.provenance;if(t&&typeof t==="object"&&!Array.isArray(t))return t;return we({generated_from:"wiki_layout_init",artifact_key:e.key})}function Rt(e,t,r=new Date){let n=r.toISOString(),i=t.find((u)=>u.key.endsWith("indexes/root.md")),o=t.find((u)=>u.key.endsWith("wiki/README.md"));if(i)e.run(`INSERT INTO knowledge_indexes (id, kind, name, artifact_uri, shard_key, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(kind, name, shard_key) DO UPDATE SET
         artifact_uri = excluded.artifact_uri,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,[xt("idx","root:indexes/root.md"),"root","root",i.uri,"root",JSON.stringify({artifact_key:i.key,content_hash:i.hash??null,provenance:wt(i)}),n,n]);if(o)e.run(`INSERT INTO wiki_pages (id, path, title, artifact_uri, content_hash, status, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         title = excluded.title,
         artifact_uri = excluded.artifact_uri,
         content_hash = excluded.content_hash,
         status = excluded.status,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,[xt("wiki","wiki/README.md"),"wiki/README.md","Wiki",o.uri,o.hash??null,"active",JSON.stringify({artifact_key:o.key,provenance:wt(o)}),n,n])}class Ot{options;ensuredWorkspace;cachedConfig;constructor(e={}){this.options=e}get scope(){return this.options.scope??"global"}get workspace(){return this.ensuredWorkspace??Pe(this.options.scope,this.options.cwd)}ensureWorkspace(){if(!this.ensuredWorkspace)this.ensuredWorkspace=De(this.workspace.home);return this.ensuredWorkspace}jsonStorePath(){return this.ensureWorkspace().jsonStorePath}config(){if(!this.cachedConfig){let e=this.ensureWorkspace();this.cachedConfig=Ue(e.configPath)}return this.cachedConfig}safetyPolicy(){return ut(this.config(),this.ensureWorkspace())}artifactStore(){return Be(this.config(),this.ensureWorkspace())}storageContract(){return kt(this.config(),this.ensureWorkspace(),this.scope)}validateStorage(){return Le(this.config(),this.ensureWorkspace())}paths(){let e=this.ensureWorkspace();return{ok:!0,scope:this.scope,home:e.home,config_path:e.configPath,json_store_path:e.jsonStorePath,knowledge_db_path:e.knowledgeDbPath,artifacts_dir:e.artifactsDir,indexes_dir:e.indexesDir,logs_dir:e.logsDir,runs_dir:e.runsDir,schemas_dir:e.schemasDir,wiki_dir:e.wikiDir,config:this.config(),message:e.home}}initDb(){return S(this.ensureWorkspace().knowledgeDbPath)}dbStats(){let e=this.ensureWorkspace();return S(e.knowledgeDbPath),Me(e.knowledgeDbPath)}async initWiki(){let e=this.ensureWorkspace();S(e.knowledgeDbPath);let t=await St(this.artifactStore()),r=x(e.knowledgeDbPath);try{vt(r,t.artifacts),Rt(r,t.artifacts)}finally{r.close()}return t}async ingestManifest(e){let t=this.ensureWorkspace();return pt({dbPath:t.knowledgeDbPath,input:e,config:this.config(),safetyPolicy:this.safetyPolicy()})}async ingestSource(e,t){let r=this.ensureWorkspace();return Et({dbPath:r.knowledgeDbPath,sourceRef:e,purpose:t,config:this.config(),safetyPolicy:this.safetyPolicy()})}async resolveSource(e,t={}){let r=this.ensureWorkspace();return le({dbPath:r.knowledgeDbPath,sourceRef:e,purpose:t.purpose,limit:t.limit,safetyPolicy:this.safetyPolicy()})}async consumeOutbox(e){let t=this.ensureWorkspace();return gt({dbPath:t.knowledgeDbPath,input:e,config:this.config(),safetyPolicy:this.safetyPolicy()})}providerStatus(e=process.env){return Ye(this.config(),e)}modelRegistry(){return xe(this.config())}embeddingStatus(){let e=this.ensureWorkspace();return nt(e.knowledgeDbPath)}async indexEmbeddings(e={}){let t=this.ensureWorkspace();return rt({...e,dbPath:t.knowledgeDbPath,config:this.config()})}async semanticSearch(e){let t=this.ensureWorkspace();return it({...e,dbPath:t.knowledgeDbPath,config:this.config()})}}function Nt(e={}){return new Ot(e)}var Q={name:"@hasna/knowledge",version:"0.2.14",description:"Agent-friendly local knowledge CLI with JSON output, pagination, and safe destructive actions",type:"module",bin:{"open-knowledge":"bin/open-knowledge.js","open-knowledge-mcp":"bin/open-knowledge-mcp.js"},files:["bin","src","docs","LICENSE","README.md"],scripts:{test:"bun test","test:cli":"bun test tests/cli.test.ts",build:"bun build --target=bun --outfile=bin/open-knowledge.js --minify --external @aws-sdk/client-s3 --external @aws-sdk/credential-providers --external ai --external @ai-sdk/openai --external @ai-sdk/anthropic --external @ai-sdk/deepseek src/cli.ts && bun build --target=bun --outfile=bin/open-knowledge-mcp.js --external @modelcontextprotocol/sdk --external @aws-sdk/client-s3 --external @aws-sdk/credential-providers --external ai --external @ai-sdk/openai --external @ai-sdk/anthropic --external @ai-sdk/deepseek src/mcp.js",prepublishOnly:"bun run build",postinstall:"bun run build"},keywords:["knowledge","cli","agents","json","notes","local","store"],license:"Apache-2.0",publishConfig:{registry:"https://registry.npmjs.org",access:"public"},repository:{type:"git",url:"git+https://github.com/hasna/knowledge.git"},bugs:{url:"https://github.com/hasna/knowledge/issues"},author:"Hasna Inc. <hasna@example.com>",engines:{bun:">=1.0",node:">=18"},dependencies:{"@aws-sdk/client-s3":"^3.1063.0","@aws-sdk/credential-providers":"^3.1063.0","@ai-sdk/anthropic":"^3.0.81","@ai-sdk/deepseek":"^2.0.35","@ai-sdk/openai":"^3.0.68","@modelcontextprotocol/sdk":"^1.29.0",ai:"^6.0.197",zod:"^4.3.6"},devDependencies:{"@types/bun":"^1.3.14"}};var At={debug:0,info:1,warn:2,error:3},Un=()=>{if(process.env.DEBUG)return"debug";if(process.env.LOG_LEVEL==="debug")return"debug";if(process.env.LOG_LEVEL==="warn")return"warn";if(process.env.LOG_LEVEL==="error")return"error";return"info"};function W(e,t,r){if(At[e]<At[Un()])return;let n={debug:"[DEBUG]",info:"[INFO]",warn:"[WARN]",error:"[ERROR]"}[e],i=r?`${n} ${t} ${JSON.stringify(r)}`:`${n} ${t}`;if(e==="error")console.error(i);else console.error(i)}var jn=["add","list","get","delete","update","archive","restore","upsert","untag","export","prune","dedupe","stats","paths","storage","db","wiki","source","ingest","reindex","embeddings","providers","safety","help"],It={ls:"list",rm:"delete",edit:"update",unarchive:"restore"};function Kn(e){let t=[],r={};for(let n=0;n<e.length;n+=1){let i=e[n];if(!i.startsWith("-")){t.push(i);continue}switch(i){case"--json":r.json=!0;break;case"--yes":case"-y":r.yes=!0;break;case"--help":case"-h":r.help=!0;break;case"--version":case"-v":r.version=!0;break;case"--desc":r.desc=!0;break;case"--page":case"-p":r.page=Number(e[n+1]),n+=1;break;case"--limit":case"-l":r.limit=Number(e[n+1]),n+=1;break;case"--search":case"-s":r.search=e[n+1],n+=1;break;case"--sort":r.sort=e[n+1],n+=1;break;case"--id":r.id=e[n+1],n+=1;break;case"--store":r.store=e[n+1],n+=1;break;case"--title":r.title=e[n+1],n+=1;break;case"--content":r.content=e[n+1],n+=1;break;case"--url":r.url=e[n+1],n+=1;break;case"--tag":case"-t":r.tag=e[n+1],n+=1;break;case"--format":r.format=e[n+1],n+=1;break;case"--completions":r.completions=e[n+1],n+=1;break;case"--purpose":r.purpose=e[n+1],n+=1;break;case"--model":r.model=e[n+1],n+=1;break;case"--dimensions":r.dimensions=Number(e[n+1]),n+=1;break;case"--fake":r.fake=!0;break;case"--no-color":r.noColor=!0;break;case"--scope":r.scope=e[n+1],n+=1;break;case"--older-than":r.olderThan=Number(e[n+1]),n+=1;break;case"--empty":r.empty=!0;break;case"--archived":r.archived=!0;break;case"--include-archived":r.includeArchived=!0;break;default:throw Error(`Unknown flag: ${i}. Run 'open-knowledge --help' for valid options.`)}}return{positional:t,flags:r}}function Fn(e){if(!e)return"";return It[e]??e}function Mn(e,t){let r=Array.from({length:e.length+1},()=>Array(t.length+1).fill(0));for(let n=0;n<=e.length;n+=1)r[n][0]=n;for(let n=0;n<=t.length;n+=1)r[0][n]=n;for(let n=1;n<=e.length;n+=1)for(let i=1;i<=t.length;i+=1){let o=e[n-1]===t[i-1]?0:1;r[n][i]=Math.min(r[n-1][i]+1,r[n][i-1]+1,r[n-1][i-1]+o)}return r[e.length][t.length]}function Xn(e){if(!e)return"";let t=[...jn,...Object.keys(It)],r="",n=Number.POSITIVE_INFINITY;for(let i of t){let o=Mn(e,i);if(o<n)n=o,r=i}return n<=3?r:""}function Wn(){console.log(`open-knowledge - local agent knowledge store

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
  storage status|validate      Inspect local/S3 artifact storage contract
  db init|stats                Initialize or inspect local knowledge.db
  wiki init                    Initialize scalable wiki/schema/index/log artifacts
  source resolve <source-ref>  Resolve read-only source content and citation evidence
  ingest manifest <file|s3://> Ingest an open-files manifest into knowledge.db
  ingest source <source-ref>   Ingest a read-only source ref into knowledge.db
  reindex outbox <file|s3://>  Consume open-files change events and invalidate chunks
  embeddings status|index|search Build/query local vector embeddings
  providers status|models|check Inspect AI SDK provider config and credentials
  safety status|check|approve|audit|redact
  help [command]               Show help

Global Options:
  --json                      Output JSON
  --store <path>              Override store path
  --purpose <name>            Read-only source purpose (default: knowledge_answer)
  --model <provider:model>     AI/embedding model ref
  --dimensions <n>             Embedding dimensions for local/fake providers
  --fake                       Use deterministic fake embeddings for local tests
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
  --empty                     Remove items with empty content`)}function $n(e){if(e==="add"){console.log("Usage: open-knowledge add <title> <content> [--url <url>] [-t <tag>] [--json]");return}if(e==="list"||e==="ls"){console.log("Usage: open-knowledge list|ls [--format table|json] [-p <page>] [-l <limit>] [-s <search>] [-t <tag>] [--sort created|title] [--desc] [--json]");return}if(e==="get"){console.log("Usage: open-knowledge get --id <id> [--json]");return}if(e==="update"||e==="edit"){console.log("Usage: open-knowledge update|edit --id <id> [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]");return}if(e==="archive"){console.log("Usage: open-knowledge archive --id <id> [--json]");return}if(e==="restore"||e==="unarchive"){console.log("Usage: open-knowledge restore|unarchive --id <id> [--json]");return}if(e==="upsert"){console.log("Usage: open-knowledge upsert [title] [content] [--id <id>] [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]");return}if(e==="untag"){console.log("Usage: open-knowledge untag --id <id> -t <tag> [--json]");return}if(e==="delete"||e==="rm"){console.log("Usage: open-knowledge delete|rm --id <id> -y [--json]");return}if(e==="export"){console.log("Usage: open-knowledge export [--format jsonl] [--json]");return}if(e==="prune"){console.log("Usage: open-knowledge prune --yes [--older-than <days>] [--empty] [--json]");return}if(e==="dedupe"){console.log("Usage: open-knowledge dedupe --yes [--json]");return}if(e==="stats"){console.log("Usage: open-knowledge stats [--json]");return}if(e==="paths"){console.log("Usage: open-knowledge paths [--scope local|global|project] [--json]");return}if(e==="storage"){console.log("Usage: open-knowledge storage status|validate [--scope local|global|project] [--json]");return}if(e==="db"){console.log("Usage: open-knowledge db init|stats [--scope local|global|project] [--json]");return}if(e==="wiki"){console.log("Usage: open-knowledge wiki init [--scope local|global|project] [--json]");return}if(e==="source"){console.log("Usage: open-knowledge source resolve <source-ref> [--purpose knowledge_answer|knowledge_index] [--limit <n>] [--scope local|global|project] [--json]");return}if(e==="ingest"){console.log("Usage: open-knowledge ingest manifest <file|s3://bucket/key> | source <source-ref> [--purpose knowledge_index] [--scope local|global|project] [--json]");return}if(e==="reindex"){console.log("Usage: open-knowledge reindex outbox <file|s3://bucket/key> [--scope local|global|project] [--json]");return}if(e==="embeddings"){console.log("Usage: open-knowledge embeddings status|index|search [query] [--model openai:text-embedding-3-small] [--limit <n>] [--dimensions <n>] [--fake] [--scope local|global|project] [--json]");return}if(e==="providers"){console.log("Usage: open-knowledge providers status|models|check [provider|model-alias] [--scope local|global|project] [--json]");return}if(e==="safety"){console.log("Usage: open-knowledge safety status|check|approve|audit|redact [args] [--scope local|global|project] [--json]");return}Wn()}function Bn(e){if(e.noColor||process.env.NO_COLOR)return!1;if(process.env.FORCE_COLOR)return!0;return process.stdout.isTTY===!0}function m(e,t,r){if(t){console.log(JSON.stringify(e,null,2));return}if(typeof e==="string"){console.log(e);return}console.log(e.message??JSON.stringify(e,null,2))}function Z(e){if(!e.id)throw Error("Missing required --id. Example: open-knowledge get --id <id>")}function qn(e,t){let r=t.sort??"created";if(r!=="created"&&r!=="title")throw Error("Invalid --sort value. Use 'created' or 'title'.");let n=[...e].sort((i,o)=>{if(r==="title")return i.title.localeCompare(o.title);return i.created_at.localeCompare(o.created_at)});if(t.desc)n.reverse();return{sorted:n,sort:r,direction:t.desc?"desc":"asc"}}async function zn(e){let{positional:t,flags:r}=Kn(e);if(W("debug","CLI invoked",{command:t[0],flags:{json:r.json,store:r.store}}),r.version){console.log(r.json?JSON.stringify({name:Q.name,version:Q.version},null,2):`${Q.name} ${Q.version}`);return}if(r.completions){let a=r.completions;if(a==="bash")console.log('_open_knowledge() { local cur; cur="${COMP_WORDS[COMP_CWORD]}"; COMPREPLY=($(compgen -W "add list get update archive restore upsert untag delete export prune dedupe stats paths storage db wiki source ingest reindex embeddings providers safety help ls rm edit unarchive --json --yes --help --version --desc --page --limit --search --sort --id --store --title --content --url --tag --format --completions --purpose --model --dimensions --fake --no-color --scope --archived --include-archived" -- "$cur")); }; complete -F _open_knowledge open-knowledge');else if(a==="zsh")console.log(`#compdef open-knowledge
_open_knowledge() { _arguments -C "1: :(add list get update archive restore upsert untag delete export prune dedupe stats paths storage db wiki source ingest reindex embeddings providers safety help ls rm edit unarchive)" "(--json)--json" "(--yes)-y" "(--help)--help" "(--version)--version" "(--desc)--desc" "(--archived)--archived" "(--include-archived)--include-archived" "(--fake)--fake" "(-p --page)"{-p,--page}"[page number]:number:" "(-l --limit)"{-l,--limit}"[items per page]:number:" "(-s --search)"{-s,--search}"[search text]:text:" "(--sort)--sort"{created,title}:" "(--id)--id[item id]:id:" "(--store)--store[store path]:path:" "(--title)--title[new title]:" "(--content)--content[new content]:" "(--url)--url[source url]:" "(-t --tag)"{-t,--tag}"[tag]:tag:" "(--format)--format[json|jsonl]:" "(--completions)--completions[output completions]:shell:(bash zsh fish):" "(--purpose)--purpose[purpose]:" "(--model)--model[model ref]:" "(--dimensions)--dimensions[embedding dimensions]:number:" "(--no-color)--no-color[disable color]" "(--scope)--scope"{local,global,project}:" }; _open_knowledge`);else if(a==="fish")console.log('complete -c open-knowledge -f; complete -c open-knowledge -a "add list get update archive restore upsert untag delete export prune dedupe stats paths storage db wiki source ingest reindex embeddings providers safety help ls rm edit unarchive"; complete -c open-knowledge -l json; complete -c open-knowledge -l yes -s y; complete -c open-knowledge -l help -s h; complete -c open-knowledge -l version -s v; complete -c open-knowledge -l desc; complete -c open-knowledge -l archived; complete -c open-knowledge -l include-archived; complete -c open-knowledge -l fake; complete -c open-knowledge -s p -l page; complete -c open-knowledge -s l -l limit; complete -c open-knowledge -s s -l search; complete -c open-knowledge -l sort; complete -c open-knowledge -l id; complete -c open-knowledge -l store; complete -c open-knowledge -l title; complete -c open-knowledge -l content; complete -c open-knowledge -l url; complete -c open-knowledge -s t -l tag; complete -c open-knowledge -l format; complete -c open-knowledge -l completions; complete -c open-knowledge -l purpose; complete -c open-knowledge -l model; complete -c open-knowledge -l dimensions; complete -c open-knowledge -l no-color; complete -c open-knowledge -l scope -a "local global project"');else throw Error("Invalid --completions value. Use 'bash', 'zsh', or 'fish'.");return}let n=Fn(t[0]);if(!n||r.help||n==="help"){$n(t[1]);return}let i=Nt({scope:r.scope}),o=r.store;if(!o)if(r.scope==="project"||r.scope==="local")o=i.jsonStorePath();else o=he();if(n==="paths"){m(i.paths(),r.json);return}if(n==="storage"){let a=t[1]??"status";if(a==="status"){let s=i.storageContract(),d=i.validateStorage();m({ok:d.ok,...s,validation:d,message:`${s.storage_type} artifact storage at ${s.artifact_store.uri_prefix}`},r.json);return}if(a==="validate"){let s=i.validateStorage();m({ok:s.ok,validation:s,message:s.ok?"Storage contract valid":`Storage contract invalid: ${s.errors.join("; ")}`},r.json);return}throw Error("Invalid storage action. Use 'status' or 'validate'.")}if(n==="db"){let a=t[1]??"init";if(a!=="init"&&a!=="stats")throw Error("Invalid db action. Use 'init' or 'stats'.");if(a==="init"){let d=i.initDb();m({ok:!0,...d,message:`Initialized ${d.path}`},r.json);return}let s=i.dbStats();m({ok:!0,path:i.workspace.knowledgeDbPath,...s,message:`knowledge.db schema v${s.schema_version}`},r.json);return}if(n==="wiki"){if((t[1]??"init")!=="init")throw Error("Invalid wiki action. Use 'init'.");let s=await i.initWiki();m({ok:!0,...s,message:`Initialized wiki layout in ${i.workspace.home}`},r.json);return}if(n==="safety"){let a=t[1]??"status",s=i.ensureWorkspace(),d=i.safetyPolicy();i.initDb();let c=x(s.knowledgeDbPath);try{if(a==="status"){m({ok:!0,mode:d.mode,workspace:s.home,allow_write_roots:d.allowWriteRoots,read_only_source_access:d.readOnlySourceAccess,network:d.network,redaction:d.redaction,approvals:d.approvals,message:`Safety policy: ${d.mode}`},r.json);return}if(a==="check"){let l=t[2]??"generated_write",f=t[3]??null,h;try{if(l==="web_search")oe(d),h={action:l,target_uri:f,approval_required:!1,approved:!0,decision:"allow"};else if(l==="s3_read"){if(!f)throw Error("safety check s3_read requires an s3:// target.");K(f,d),h={action:l,target_uri:f,approval_required:!1,approved:!0,decision:"allow"}}else h=_t(c,d,l,f);w(c,{event_type:"safety_check",action:l,target_uri:f,decision:h.decision==="allow"?"allow":"requires_approval",metadata:h}),m({ok:!0,...h,message:`Safety check ${h.decision}`},r.json);return}catch(y){throw w(c,{event_type:"safety_check",action:l,target_uri:f,decision:"deny",metadata:{error:y instanceof Error?y.message:String(y)}}),y}}if(a==="approve"){let l=t[2]??"generated_write",f=t[3]??null,h=lt(c,{action:l,target_uri:f,reason:"local-cli approval",metadata:{scope:r.scope??"global"}});w(c,{event_type:"approval",action:l,target_uri:f,decision:"allow",metadata:{approval_id:h.id}}),m({ok:!0,...h,action:l,target_uri:f,message:`Approved ${l}`},r.json);return}if(a==="audit"){let l=c.query("SELECT id, event_type, action, target_uri, decision, metadata_json, created_at FROM audit_events ORDER BY created_at DESC LIMIT 50").all().map((f)=>({id:f.id,event_type:f.event_type,action:f.action,target_uri:f.target_uri,decision:f.decision,metadata:JSON.parse(f.metadata_json),created_at:f.created_at}));m({ok:!0,events:l,message:`${l.length} audit event(s)`},r.json);return}if(a==="redact"){let l=t.slice(2).join(" ");if(!l)throw Error("Usage: open-knowledge safety redact <text>");let f=ae(l,d);if(f.findings.length>0)de(c,{source_uri:"safety://redact",findings:f.findings,metadata:{command:"safety redact"}});w(c,{event_type:"redaction",action:"safety_redact",target_uri:"safety://redact",decision:f.findings.length>0?"redacted":"allow",metadata:{findings:f.findings.length}}),m({ok:!0,text:f.text,findings:f.findings,message:`Redacted ${f.findings.length} finding(s)`},r.json);return}throw Error("Invalid safety action. Use 'status', 'check', 'approve', 'audit', or 'redact'.")}finally{c.close()}}if(n==="source"){if((t[1]??"")!=="resolve")throw Error("Invalid source action. Use 'resolve'.");let s=t[2];if(!s)throw Error("Usage: open-knowledge source resolve <source-ref>");let d=await i.resolveSource(s,{purpose:r.purpose,limit:r.limit});m({ok:!0,...d,message:d.resolved?`Resolved ${d.source_ref} (${d.content.chunks_returned}/${d.content.chunks_total} chunks)`:`Source not indexed: ${s}`},r.json);return}if(n==="ingest"){let a=t[1]??"";if(a==="manifest"){let s=t[2];if(!s)throw Error("Usage: open-knowledge ingest manifest <file|s3://bucket/key>");let d=await i.ingestManifest(s);m({ok:!0,...d,message:`Ingested ${d.items_seen} manifest item(s)`},r.json);return}if(a==="source"){let s=t[2];if(!s)throw Error("Usage: open-knowledge ingest source <source-ref>");let d=await i.ingestSource(s,r.purpose);m({ok:!0,...d,message:`Ingested source ${d.source_ref} (${d.chunks_inserted} chunks)`},r.json);return}throw Error("Invalid ingest action. Use 'manifest' or 'source'.")}if(n==="reindex"){if((t[1]??"")!=="outbox")throw Error("Invalid reindex action. Use 'outbox'.");let s=t[2];if(!s)throw Error("Usage: open-knowledge reindex outbox <file|s3://bucket/key>");let d=await i.consumeOutbox(s);m({ok:!0,...d,message:`Consumed ${d.events_seen} outbox event(s)`},r.json);return}if(n==="embeddings"){let a=t[1]??"status";if(a==="status"){let s=i.embeddingStatus();m({ok:!0,...s,message:`${s.total_vector_entries} vector index entries`},r.json);return}if(a==="index"){let s=await i.indexEmbeddings({limit:r.limit,modelRef:r.model,dimensions:r.dimensions,fake:r.fake});m({ok:!0,...s,message:`Embedded ${s.chunks_embedded} chunk(s)`},r.json);return}if(a==="search"){let s=t.slice(2).join(" ");if(!s)throw Error("Usage: open-knowledge embeddings search <query>");let d=await i.semanticSearch({query:s,limit:r.limit,modelRef:r.model,dimensions:r.dimensions,fake:r.fake});m({ok:!0,...d,message:`${d.results.length} semantic result(s)`},r.json);return}throw Error("Invalid embeddings action. Use 'status', 'index', or 'search'.")}if(n==="providers"){let a=t[1]??"status";if(a==="status"){let s=i.providerStatus(),d=s.providers.filter((c)=>c.configured).length;m({ok:!0,...s,message:`${d}/${s.providers.length} provider credential(s) configured`},r.json);return}if(a==="models"){let s=i.modelRegistry();m({ok:!0,models:s,message:`${s.length} model alias(es)`},r.json);return}if(a==="check"){let s=t[2]??"default",d=ve(s,i.config()),c=F(d),l=ie(c.provider,i.config());m({ok:!0,target:s,model_ref:d,provider:c.provider,model:c.model,credential:l,message:`${c.provider} credentials configured`},r.json);return}throw Error("Invalid providers action. Use 'status', 'models', or 'check'.")}if(Ee(o),n==="add"){let a=t[1],s=t[2];if(!a||!s)throw Error("Usage: open-knowledge add <title> <content>");C(o,()=>{let d=L(o),c={id:ye(),title:a,content:s,url:r.url??null,tags:r.tag?[r.tag]:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()};d.items.push(c),U(o,d),W("info","Item added",{id:c.id,title:c.title}),m({ok:!0,item:c,message:`Added ${c.id}`},r.json)});return}if(n==="list"){if(r.format!==void 0&&r.format!=="table"&&r.format!=="json")throw Error("Invalid --format value for list. Use 'table' or 'json'.");C(o,()=>{let a=L(o),s=Number.isFinite(r.page)&&r.page>0?r.page:1,d=Number.isFinite(r.limit)&&r.limit>0?r.limit:20,c=r.search?String(r.search).toLowerCase():"",l=r.tag?String(r.tag).toLowerCase():"",f=r.format==="table"||!r.json&&!r.format&&Bn(r),h=r.json||r.format==="json",y=a.items;if(r.archived)y=y.filter((p)=>p.archived===!0);else if(!r.includeArchived)y=y.filter((p)=>!p.archived);if(c)y=y.filter((p)=>p.title.toLowerCase().includes(c)||p.content.toLowerCase().includes(c));if(l)y=y.filter((p)=>p.tags&&p.tags.map((G)=>G.toLowerCase()).includes(l));let{sorted:v,sort:T,direction:b}=qn(y,r),R=(s-1)*d,g=v.slice(R,R+d),A=Math.max(1,Math.ceil(v.length/d));if(h){m({ok:!0,page:s,limit:d,total:v.length,total_pages:A,sort:T,direction:b,items:g},!0);return}if(g.length===0){m(`No items found (search=${c||"none"}, tag=${l||"none"})`,!1);return}if(f){let p=(j)=>j,G=`${p("ID")}	${p("TITLE")}	${p("CREATED")}	${p("URL")}	${p("TAGS")}`;console.log(G);for(let j of g)console.log(`${j.id}	${p(j.title)}	${j.created_at}	${j.url?p(j.url):""}	${j.tags?.length?p(`[${j.tags.join(", ")}]`):""}`);console.log(`Page ${s}/${A} | showing ${g.length} of ${v.length} | sort=${T} ${b} | search=${c||"none"} | tag=${l||"none"}`)}else{for(let p of g)console.log(`${p.id}	${p.title}	${p.created_at}${p.url?`	${p.url}`:""}${p.tags?.length?`	[${p.tags.join(", ")}]`:""}`);console.log(`Page ${s}/${A} | showing ${g.length} of ${v.length} | sort=${T} ${b} | search=${c||"none"} | tag=${l||"none"}`)}});return}if(n==="get"){Z(r),C(o,()=>{let s=L(o).items.find((d)=>d.id===r.id||d.short_id===r.id);if(!s)throw Error(`Item not found: ${r.id}`);m({ok:!0,item:s,message:`${s.id}: ${s.title}`},r.json)});return}if(n==="update"){Z(r),C(o,()=>{let a=L(o),s=a.items.findIndex((c)=>c.id===r.id||c.short_id===r.id);if(s===-1)throw Error(`Item not found: ${r.id}`);let d=a.items[s];if(r.title!==void 0)d.title=r.title;if(r.content!==void 0)d.content=r.content;if(r.url!==void 0)d.url=r.url;if(r.tag!==void 0){if(d.tags=d.tags||[],!d.tags.map((c)=>c.toLowerCase()).includes(r.tag.toLowerCase()))d.tags.push(r.tag)}d.updated_at=new Date().toISOString(),a.items[s]=d,U(o,a),m({ok:!0,item:d,message:`Updated ${d.id}`},r.json)});return}if(n==="archive"||n==="restore"){Z(r),C(o,()=>{let a=L(o),s=a.items.findIndex((c)=>c.id===r.id||c.short_id===r.id);if(s===-1)throw Error(`Item not found: ${r.id}`);let d=a.items[s];d.archived=n==="archive",d.updated_at=new Date().toISOString(),a.items[s]=d,U(o,a),m({ok:!0,item:d,message:`${n==="archive"?"Archived":"Restored"} ${d.id}`},r.json)});return}if(n==="untag"){if(Z(r),!r.tag)throw Error("Missing required --tag. Example: open-knowledge untag --id <id> -t <tag>");C(o,()=>{let a=L(o),s=a.items.findIndex((l)=>l.id===r.id||l.short_id===r.id);if(s===-1)throw Error(`Item not found: ${r.id}`);let d=a.items[s],c=d.tags?.length??0;d.tags=(d.tags??[]).filter((l)=>l.toLowerCase()!==r.tag.toLowerCase()),d.updated_at=new Date().toISOString(),a.items[s]=d,U(o,a),m({ok:!0,item:d,removed:c-d.tags.length,message:`Removed tag from ${d.id}`},r.json)});return}if(n==="upsert"){let a=r.title??t[1],s=r.content??t[2];C(o,()=>{let d=L(o),c=r.id?d.items.findIndex((h)=>h.id===r.id||h.short_id===r.id):-1,l=new Date().toISOString();if(c===-1){if(!a||!s)throw Error("New item requires title and content. Example: open-knowledge upsert <title> <content> [--id <id>]");let h=r.id??ye(),y={id:h,short_id:Fe(h),title:a,content:s,url:r.url??null,tags:r.tag?[r.tag]:[],metadata:{},archived:!1,created_at:l,updated_at:l};d.items.push(y),U(o,d),m({ok:!0,created:!0,item:y,message:`Upserted ${y.id}`},r.json);return}let f=d.items[c];if(a!==void 0)f.title=a;if(s!==void 0)f.content=s;if(r.url!==void 0)f.url=r.url;if(r.tag!==void 0){if(f.tags=f.tags||[],!f.tags.map((h)=>h.toLowerCase()).includes(r.tag.toLowerCase()))f.tags.push(r.tag)}f.updated_at=l,d.items[c]=f,U(o,d),m({ok:!0,created:!1,item:f,message:`Upserted ${f.id}`},r.json)});return}if(n==="delete"){if(Z(r),!r.yes)throw Error("Refusing delete without --yes. Re-run with: open-knowledge delete --id <id> --yes");C(o,()=>{let a=L(o),s=a.items.length;a.items=a.items.filter((c)=>c.id!==r.id&&c.short_id!==r.id);let d=s!==a.items.length;if(U(o,a),!d)throw Error(`Item not found: ${r.id}`);W("info","Item deleted",{id:r.id}),m({ok:!0,deleted_id:r.id,message:`Deleted ${r.id}`},r.json)});return}if(n==="export"){let a=r.format??"json";if(a!=="json"&&a!=="jsonl")throw Error("Invalid --format. Use 'json' or 'jsonl'.");C(o,()=>{let s=L(o);if(a==="jsonl")for(let d of s.items)console.log(JSON.stringify(d));else m({ok:!0,items:s.items},r.json)});return}if(n==="prune"){if(!r.yes)throw Error("Refusing prune without --yes. Re-run with: open-knowledge prune --yes [--older-than <days>] [--empty]");C(o,()=>{let a=L(o),s=a.items.length;if(r.olderThan!==void 0){let c=new Date;c.setDate(c.getDate()-r.olderThan),a.items=a.items.filter((l)=>new Date(l.created_at)>=c)}if(r.empty)a.items=a.items.filter((c)=>c.content.trim().length>0);let d=s-a.items.length;U(o,a),W("info","Prune completed",{pruned:d,remaining:a.items.length}),m({ok:!0,pruned:d,remaining:a.items.length,message:`Pruned ${d} item(s)`},r.json)});return}if(n==="dedupe"){if(!r.yes)throw Error("Refusing dedupe without --yes. Re-run with: open-knowledge dedupe --yes [--json]");C(o,()=>{let a=L(o),s=new Set,d=a.items.length;a.items=a.items.filter((l)=>{let f=`${l.title}\x00${l.content}`;if(s.has(f))return!1;return s.add(f),!0});let c=d-a.items.length;U(o,a),W("info","Dedupe completed",{removed:c,remaining:a.items.length}),m({ok:!0,removed:c,remaining:a.items.length,message:`Dedupe removed ${c} duplicate(s)`},r.json)});return}if(n==="stats"){C(o,()=>{let a=L(o),s=a.items.filter((b)=>!b.archived),d=s.length,c=a.items.length-d,l=s.filter((b)=>b.url).length,f=s.filter((b)=>b.tags&&b.tags.length>0).length,h=d>0?s.map((b)=>b.created_at).sort()[0]:null,y=d>0?s.map((b)=>b.created_at).sort()[d-1]:null,v={};for(let b of s)for(let R of b.tags||[])v[R]=(v[R]||0)+1;let T=Object.entries(v).sort((b,R)=>R[1]-b[1]).slice(0,5).map(([b,R])=>({tag:b,count:R}));m({ok:!0,total:d,archived:c,with_url:l,with_tags:f,oldest:h,newest:y,top_tags:T,message:`${d} items | ${l} with URL | ${f} with tags`},r.json)});return}let u=Xn(t[0]),_=u?` Did you mean '${u}'?`:"";throw W("warn","Unknown command",{input:t[0],suggestion:u}),Error(`Unknown command: ${t[0]}.${_} Run 'open-knowledge --help' for available commands.`)}if(import.meta.main)zn(process.argv.slice(2)).catch((e)=>{let t=e instanceof Error?e.message:String(e);W("error","CLI error",{message:t,stack:e instanceof Error?e.stack:void 0}),console.error(`Error: ${t}`),process.exitCode=1});export{Xn as suggestCommand,qn as sortItems,zn as run,Kn as parseArgs};
