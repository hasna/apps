#!/usr/bin/env bun
// @bun
var I=import.meta.require;import{readFileSync as se,writeFileSync as re,existsSync as ie,renameSync as on,unlinkSync as Je}from"fs";import{randomUUID as Ye}from"crypto";import{existsSync as Qt,mkdirSync as ve,readFileSync as Zt,writeFileSync as en}from"fs";import{homedir as qe}from"os";import{dirname as tn,join as O,resolve as nn}from"path";var Y=O(".hasna","apps","knowledge");function Te(){return O(qe(),".open-knowledge","db.json")}function xe(){return O(qe(),".hasna","apps","knowledge")}function rn(e=process.cwd()){return nn(e,Y)}function J(e){return{home:e,configPath:O(e,"config.json"),jsonStorePath:O(e,"db.json"),knowledgeDbPath:O(e,"knowledge.db"),artifactsDir:O(e,"artifacts"),cacheDir:O(e,"cache"),exportsDir:O(e,"exports"),indexesDir:O(e,"indexes"),logsDir:O(e,"logs"),runsDir:O(e,"runs"),schemasDir:O(e,"schemas"),wikiDir:O(e,"wiki")}}function sn(){return{version:1,mode:"local",storage:{type:"local",artifacts_root:"artifacts"},sources:{preferred_ref:"open-files",allowed_schemes:["open-files","s3","file","https","http"]},providers:{default_model:"openai:gpt-5.2",aliases:{fast:"openai:gpt-5-mini",reasoning:"anthropic:claude-opus-4-6",sonnet:"anthropic:claude-sonnet-4-6",deepseek:"deepseek:deepseek-chat","deepseek-reasoning":"deepseek:deepseek-reasoner"},openai:{api_key_env:"OPENAI_API_KEY",default_model:"gpt-5.2"},anthropic:{api_key_env:"ANTHROPIC_API_KEY",default_model:"claude-sonnet-4-6"},deepseek:{api_key_env:"DEEPSEEK_API_KEY",default_model:"deepseek-chat"}},embeddings:{default_model:"openai:text-embedding-3-small",dimensions:1536,batch_size:64,max_parallel_calls:4},safety:{network:{web_search_enabled:!1,s3_reads_enabled:!1,allowed_s3_buckets:[]},redaction:{enabled:!0},approvals:{generated_writes_require_approval:!0}}}}function Be(e){let t=J(e);ve(t.home,{recursive:!0});for(let n of[t.artifactsDir,t.cacheDir,t.exportsDir,t.indexesDir,t.logsDir,t.runsDir,t.schemasDir,t.wikiDir])ve(n,{recursive:!0});if(!Qt(t.configPath))en(t.configPath,`${JSON.stringify(sn(),null,2)}
`);return t}function ze(e,t=process.cwd()){if(e==="project"||e==="local")return J(rn(t));return J(xe())}function ne(e){ve(tn(e),{recursive:!0})}function Ge(e){let t=Zt(e,"utf8");return JSON.parse(t)}function Se(){return J(xe()).jsonStorePath}function we(e){if(!ie(e))if(ne(e),e===Se()&&ie(Te()))re(e,se(Te(),"utf8"));else re(e,JSON.stringify({items:[]},null,2))}function an(e){return`${e}.lock`}function cn(e,t){let i=Date.now();while(Date.now()-i<5000){try{if(!ie(e)){re(e,JSON.stringify({owner:t,ts:Date.now()}));return}let d=JSON.parse(se(e,"utf8"));if(Date.now()-d.ts>1e4)Je(e)}catch{}let s=Date.now();while(Date.now()-s<50);}throw Error(`Could not acquire lock on ${e} after 5000ms`)}function un(e,t){try{if(ie(e)){if(JSON.parse(se(e,"utf8")).owner===t)Je(e)}}catch{}}function L(e){we(e);let t=se(e,"utf8"),n=JSON.parse(t);if(!n||!Array.isArray(n.items))return{items:[]};return n}function j(e,t){let n=`${e}.tmp.${Ye()}`;re(n,JSON.stringify(t,null,2)),on(n,e)}function C(e,t){let n=Ye(),r=an(e);cn(r,n);try{return t()}finally{un(r,n)}}function Re(){return`k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`}function Ve(e){return e.replace(/^k_/,"").slice(0,12)}import{Database as dn}from"bun:sqlite";var ln=`
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
`,_n=`
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
`,fn=`
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
`,gn=`
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
`;function S(e){ne(e);let t=new dn(e);return t.exec("PRAGMA foreign_keys = ON;"),t.exec("PRAGMA busy_timeout = 5000;"),t}function w(e){let t=S(e);try{if(t.exec(ln),V(t)<2)t.exec(_n);if(V(t)<3)t.exec(fn);if(V(t)<4)t.exec(gn);return{path:e,schema_version:V(t)}}finally{t.close()}}function V(e){return e.query("SELECT MAX(version) AS version FROM schema_versions").get()?.version??0}function N(e,t){return e.query(`SELECT COUNT(*) AS n FROM ${t}`).get()?.n??0}function Qe(e){let t=S(e);try{return{schema_version:V(t),sources:N(t,"sources"),source_revisions:N(t,"source_revisions"),chunks:N(t,"chunks"),wiki_pages:N(t,"wiki_pages"),citations:N(t,"citations"),indexes:N(t,"knowledge_indexes"),runs:N(t,"runs"),run_events:N(t,"run_events"),redaction_findings:N(t,"redaction_findings"),audit_events:N(t,"audit_events"),approval_gates:N(t,"approval_gates"),storage_objects:N(t,"storage_objects"),embeddings:N(t,"chunk_embeddings"),vector_entries:N(t,"vector_index_entries")}}finally{t.close()}}import{existsSync as pn,mkdirSync as Ze,readFileSync as hn,writeFileSync as mn}from"fs";import{dirname as En,join as Oe,relative as kn,sep as yn}from"path";function Q(e){let t=e.replace(/\\/g,"/").trim();if(!t||t.startsWith("/"))throw Error(`Invalid artifact key: ${e}`);let n=t.split("/").filter(Boolean);if(n.length===0||n.some((r)=>r==="."||r===".."))throw Error(`Invalid artifact key: ${e}`);return n.join("/")}function Ne(e,t){let n=kn(e,t);if(n.startsWith("..")||n===".."||n.startsWith(`..${yn}`))throw Error(`Artifact path escapes root: ${t}`)}class et{root;type="local";canRead=!0;canWrite=!0;constructor(e){this.root=e;Ze(e,{recursive:!0})}async put(e){let t=Q(e.key),n=Oe(this.root,t);return Ne(this.root,n),Ze(En(n),{recursive:!0}),mn(n,e.body),{key:t,uri:`file://${n}`}}async getText(e){let t=Q(e),n=Oe(this.root,t);return Ne(this.root,n),hn(n,"utf8")}async exists(e){let t=Q(e),n=Oe(this.root,t);return Ne(this.root,n),pn(n)}}class tt{options;type="s3";canRead=!0;canWrite=!0;client;constructor(e){this.options=e;this.client=e.client}async getClient(){if(this.client)return this.client;let[{S3Client:e},{fromIni:t}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]);return this.client=new e({region:this.options.region,credentials:this.options.profile?t({profile:this.options.profile}):void 0,maxAttempts:this.options.max_attempts}),this.client}objectKey(e){let t=Q(e),n=this.options.prefix?Q(this.options.prefix):"";return n?`${n}/${t}`:t}async put(e){let[{PutObjectCommand:t},n]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e.key);return await n.send(new t({Bucket:this.options.bucket,Key:r,Body:e.body,ContentType:e.content_type,Metadata:e.metadata,ServerSideEncryption:this.options.server_side_encryption,SSEKMSKeyId:this.options.kms_key_id})),{key:r,uri:`s3://${this.options.bucket}/${r}`}}async getText(e){let[{GetObjectCommand:t},n]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e),i=await n.send(new t({Bucket:this.options.bucket,Key:r}));if(!i.Body)return"";return await i.Body.transformToString()}async exists(e){let[{HeadObjectCommand:t},n]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e);try{return await n.send(new t({Bucket:this.options.bucket,Key:r})),!0}catch(i){let s=i instanceof Error?i.name:"";if(s==="NotFound"||s==="NoSuchKey"||s==="NotFoundError")return!1;throw i}}}function nt(e,t){if(e.storage.type==="s3"){if(!e.storage.s3?.bucket)throw Error("S3 artifact storage requires storage.s3.bucket");return new tt({bucket:e.storage.s3.bucket,prefix:e.storage.s3.prefix,region:e.storage.s3.region,profile:e.storage.s3.profile,max_attempts:e.storage.s3.max_attempts,server_side_encryption:e.storage.s3.server_side_encryption,kms_key_id:e.storage.s3.kms_key_id})}return new et(t.artifactsDir)}import{createHash as lt}from"crypto";var rt={openai:{api_key_env:"OPENAI_API_KEY",default_model:"gpt-5.2"},anthropic:{api_key_env:"ANTHROPIC_API_KEY",default_model:"claude-sonnet-4-6"},deepseek:{api_key_env:"DEEPSEEK_API_KEY",default_model:"deepseek-chat"}},bn={openai:{text_generation:!0,structured_output:!0,tool_usage:!0,tool_streaming:!0,image_input:!0,native_web_search:!0,reasoning:!0,embeddings:!0},anthropic:{text_generation:!0,structured_output:!0,tool_usage:!0,tool_streaming:!0,image_input:!0,native_web_search:!1,reasoning:!0,embeddings:!1},deepseek:{text_generation:!0,structured_output:!0,tool_usage:!0,tool_streaming:!0,image_input:!1,native_web_search:!1,reasoning:!0,embeddings:!1}},vn={default:"openai:gpt-5.2",fast:"openai:gpt-5-mini",reasoning:"anthropic:claude-opus-4-6",sonnet:"anthropic:claude-sonnet-4-6",deepseek:"deepseek:deepseek-chat","deepseek-reasoning":"deepseek:deepseek-reasoner"};function it(e){return e.providers??{}}function Ae(e,t){let n=it(e)[t]??{};return{...rt[t],...n}}function st(e){let t=it(e);return{...vn,...t.default_model?{default:t.default_model}:{},...t.aliases??{}}}function W(e){let[t,...n]=e.split(":"),r=n.join(":");if(t!=="openai"&&t!=="anthropic"&&t!=="deepseek")throw Error(`Unsupported AI provider: ${t}`);if(!r)throw Error(`Invalid model ref: ${e}. Expected provider:model.`);return{provider:t,model:r}}function Ie(e,t){return st(t)[e]??e}function Le(e){let t=st(e);return Object.entries(t).map(([n,r])=>{let i=W(r);return{alias:n,model_ref:r,provider:i.provider,model:i.model,default:n==="default",capabilities:bn[i.provider]}})}function ot(e,t=process.env){return Object.keys(rt).map((n)=>{let r=Ae(e,n),i=Boolean(t[r.api_key_env]);return{provider:n,api_key_env:r.api_key_env,configured:i,source:i?"env":"missing",base_url:r.base_url??null,default_model:r.default_model}})}function at(e,t=process.env){return{default_model:Ie("default",e),providers:ot(e,t),models:Le(e)}}function oe(e,t,n=process.env){let r=ot(t,n).find((i)=>i.provider===e);if(!r)throw Error(`Unsupported AI provider: ${e}`);if(!r.configured)throw Error(`Missing ${r.api_key_env} for ${e}. Set the env var to use this provider.`);return r}function Ce(e){return["deleted","stale","invalidated","reindex_required"].includes((e??"").toLowerCase())}function F(e){let t=e.status??null;return{source_owner:"open-files",source_ref:e.source_ref??null,source_uri:e.source_uri??null,source_kind:e.source_kind??null,source_revision_id:e.source_revision_id??null,revision:e.revision??null,hash:e.hash??null,chunk_id:e.chunk_id??null,start_offset:e.start_offset??null,end_offset:e.end_offset??null,status:t,read_only:!0,citation_required:!0,resolver:e.resolver??null,stale:Ce(t)}}function De(e){return{source_owner:"open-files",generated_from:e.generated_from,artifact_key:e.artifact_key,source_refs:e.source_refs??[],read_only_sources:!0,citation_required:e.citation_required??!0,raw_source_bytes_stored_in_open_knowledge:!1}}function ct(e,t){return{...e,provenance:t}}var Tn="openai:text-embedding-3-small",_t=1536;function ae(e){return e?.embeddings??{}}function ut(e,t){return`${e}_${lt("sha256").update(t).digest("hex").slice(0,20)}`}function Ue(e){if(!e)return{};try{let t=JSON.parse(e);return t&&typeof t==="object"&&!Array.isArray(t)?t:{}}catch{return{}}}function U(e,t){for(let n of t){let r=e[n];if(typeof r==="string"&&r.length>0)return r}return null}function dt(e,t){for(let n of t){let r=e[n];if(typeof r==="number"&&Number.isFinite(r))return r}return null}function Pe(e){return Math.sqrt(e.reduce((t,n)=>t+n*n,0))}function xn(e,t,n=Pe(t)){let r=Pe(e);if(r===0||n===0)return 0;let i=Math.min(e.length,t.length),s=0;for(let d=0;d<i;d+=1)s+=e[d]*t[d];return s/(r*n)}function Sn(e,t){let n=lt("sha256").update(e).digest();return Array.from({length:t},(r,i)=>{let s=n[i%n.length]/255;return Number((s*2-1).toFixed(6))})}async function wn(e,t,n=process.env){oe("openai",t,n);let r=Ae(t,"openai"),{createOpenAI:i}=await import("@ai-sdk/openai"),s=i({apiKey:n[r.api_key_env],baseURL:r.base_url});if(s.embeddingModel)return s.embeddingModel(e);if(s.textEmbedding)return s.textEmbedding(e);if(s.textEmbeddingModel)return s.textEmbeddingModel(e);throw Error("OpenAI provider does not expose an embedding model factory.")}function je(e,t){if(!e||e==="default"||e==="embedding")return ae(t).default_model??Tn;return e}async function ft(e,t={}){let n=je(t.modelRef,t.config),r=W(n);if(r.provider!=="openai")throw Error(`Embedding provider ${r.provider} is not supported yet. Use openai:text-embedding-3-small.`);let i=t.dimensions??ae(t.config).dimensions??_t;if(t.fake)return{provider:r.provider,model:r.model,dimensions:i,vectors:e.map((o)=>Sn(o,i)),usage:{input_tokens:e.reduce((o,c)=>o+Math.max(1,Math.ceil(c.split(/\s+/).filter(Boolean).length*1.25)),0)}};let{embedMany:s}=await import("ai"),d=await wn(r.model,t.config,t.env),l=await s({model:d,values:e,maxParallelCalls:t.maxParallelCalls??ae(t.config).max_parallel_calls,providerOptions:{openai:{dimensions:i}}}),a=l.embeddings;return{provider:r.provider,model:r.model,dimensions:a[0]?.length??i,vectors:a,usage:{input_tokens:l.usage?.tokens??0}}}function Rn(e,t){if(t.sourceRevisionId)return e.query(`SELECT
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
     LIMIT ?`).all(t.provider,t.model,t.limit)}function On(e){let t=Ue(e.metadata_json),n=t.provenance;if(n&&typeof n==="object"&&!Array.isArray(n))return n;return F({source_ref:U(t,["source_ref"]),source_uri:e.source_uri??U(t,["source_uri"]),source_kind:e.source_kind??U(t,["source_kind"]),source_revision_id:e.source_revision_id,revision:e.revision??U(t,["revision"]),hash:e.hash??U(t,["hash"]),chunk_id:e.id,start_offset:e.start_offset??dt(t,["start_offset"]),end_offset:e.end_offset??dt(t,["end_offset"]),status:U(t,["status"]),resolver:"open-files-read-only"})}function Nn(e,t,n,r){let i=e.prepare(`
    INSERT INTO chunk_embeddings (id, chunk_id, provider, model, dimensions, vector_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chunk_id, provider, model) DO UPDATE SET
      dimensions = excluded.dimensions,
      vector_json = excluded.vector_json,
      created_at = excluded.created_at
  `),s=e.prepare(`
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
  `);return e.transaction(()=>{for(let l=0;l<t.length;l+=1){let a=t[l],o=n.vectors[l];if(!o)continue;let c=Ue(a.metadata_json),u=On(a),_=u.source_ref??U(c,["source_ref"]),f=u.source_uri??a.source_uri??U(c,["source_uri"]),m=u.revision??a.revision??U(c,["revision"]),y=u.hash??a.hash??U(c,["hash"]),k=u.status??U(c,["status"])??"active",g=JSON.stringify(o);i.run(ut("emb",`${a.id}\x00${n.provider}\x00${n.model}`),a.id,n.provider,n.model,n.dimensions,g,r),s.run(ut("vec",`${a.id}\x00${n.provider}\x00${n.model}`),a.id,a.source_revision_id,n.provider,n.model,n.dimensions,g,Pe(o),f,_,m,y,u.start_offset,u.end_offset,a.token_count,k,JSON.stringify({...c,provenance:u,embedded_at:r}),r,r)}})(),t.length}async function gt(e){let t=je(e.modelRef,e.config),n=W(t);if(n.provider!=="openai")throw Error(`Embedding provider ${n.provider} is not supported yet.`);let r=(e.now??new Date).toISOString(),i=Math.max(1,Math.min(e.limit??100,1000));w(e.dbPath);let s=S(e.dbPath),d;try{d=Rn(s,{provider:n.provider,model:n.model,limit:i,sourceRevisionId:e.sourceRevisionId})}finally{s.close()}if(d.length===0)return{provider:n.provider,model:n.model,dimensions:e.dimensions??ae(e.config).dimensions??_t,chunks_seen:0,chunks_embedded:0,embeddings_upserted:0,vector_entries_upserted:0,usage:{input_tokens:0}};let l=await ft(d.map((o)=>o.text),e),a=S(e.dbPath);try{let o=Nn(a,d,l,r);return{provider:l.provider,model:l.model,dimensions:l.dimensions,chunks_seen:d.length,chunks_embedded:d.length,embeddings_upserted:o,vector_entries_upserted:o,usage:l.usage}}finally{a.close()}}function pt(e){w(e);let t=S(e);try{let n=t.query("SELECT COUNT(*) AS n FROM chunk_embeddings").get()?.n??0,r=t.query("SELECT COUNT(*) AS n FROM vector_index_entries").get()?.n??0,i=t.query(`SELECT provider, model, dimensions, COUNT(*) AS entries, MAX(updated_at) AS updated_at
       FROM vector_index_entries
       GROUP BY provider, model, dimensions
       ORDER BY provider, model`).all();return{total_embeddings:n,total_vector_entries:r,indexes:i}}finally{t.close()}}async function ce(e){let t=je(e.modelRef,e.config),n=W(t),r=Math.max(1,Math.min(e.limit??10,100)),i=await ft([e.query],e),s=i.vectors[0]??[];w(e.dbPath);let d=S(e.dbPath);try{let a=d.query(`SELECT
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
       WHERE v.provider = ? AND v.model = ? AND v.status = 'active'`).all(n.provider,n.model).map((o)=>{let c=JSON.parse(o.vector_json),u=Ue(o.metadata_json),_=u.provenance&&typeof u.provenance==="object"&&!Array.isArray(u.provenance)?u.provenance:null;return{chunk_id:o.chunk_id,score:xn(s,c,o.vector_norm),text:o.text,source_uri:o.source_uri,source_ref:o.source_ref,revision:o.revision,hash:o.hash,provenance:_}}).sort((o,c)=>c.score-o.score).slice(0,r);return{provider:n.provider,model:n.model,dimensions:i.dimensions,query:e.query,results:a}}finally{d.close()}}import{createHash as Wn,randomUUID as Xn}from"crypto";import{existsSync as $n,readFileSync as Hn}from"fs";import{basename as qn}from"path";function ht(e,t){if(!e)throw Error(t);return e}function An(e){let n=e.slice(13).split("/").filter(Boolean),r=n[0];if(r!=="file"&&r!=="source")throw Error("Invalid open-files ref. Expected open-files://file/<id>, open-files://file/<id>/revision/<revision_id>, or open-files://source/<id>/path/<path>.");let i=ht(n[1],"Invalid open-files ref. Missing id.");if(r==="file"){if(n.length===2)return{kind:"open-files",uri:e,entity:r,id:i};if(n[2]==="revision"&&n[3]&&n.length===4)return{kind:"open-files",uri:e,entity:r,id:i,revision_id:decodeURIComponent(n[3])};throw Error("Invalid open-files file ref. Expected open-files://file/<id>/revision/<revision_id>.")}let s=n.indexOf("path"),d=s>=0?decodeURIComponent(n.slice(s+1).join("/")):void 0;return{kind:"open-files",uri:e,entity:r,id:i,path:d}}function In(e){let t=new URL(e),n=ht(t.hostname,"Invalid s3 ref. Missing bucket."),r=decodeURIComponent(t.pathname.replace(/^\/+/,""));if(!r)throw Error("Invalid s3 ref. Missing object key.");return{kind:"s3",uri:e,bucket:n,key:r}}function Ln(e){let t=new URL(e);return{kind:"file",uri:e,path:decodeURIComponent(t.pathname)}}function Cn(e){let t=new URL(e);return{kind:"web",uri:e,url:t.toString()}}function P(e){if(e.startsWith("open-files://"))return An(e);if(e.startsWith("s3://"))return In(e);if(e.startsWith("file://"))return Ln(e);if(e.startsWith("https://")||e.startsWith("http://"))return Cn(e);throw Error(`Unsupported source ref scheme: ${e}`)}function mt(e,t=P(e)){if(t.kind==="open-files"&&t.entity==="file"&&t.revision_id)return e.replace(/\/revision\/[^/]+$/,"");return e}function Et(e){let t=P(e);return t.kind==="open-files"&&t.entity==="file"?t.revision_id??null:null}import{createHash as Dn,randomUUID as Me}from"crypto";import{relative as Pn,resolve as yt,sep as Un}from"path";function kt(e){let t=process.env[e];return t==="1"||t==="true"||t==="yes"}function bt(e,t){let n=e,r=new Set(n.safety?.network?.allowed_s3_buckets??[]);if(e.storage.type==="s3"&&e.storage.s3?.bucket)r.add(e.storage.s3.bucket);if(process.env.HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS)for(let i of process.env.HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS.split(",").map((s)=>s.trim()).filter(Boolean))r.add(i);return{mode:e.mode,allowWriteRoots:[t.home,t.artifactsDir,t.cacheDir,t.exportsDir,t.indexesDir,t.logsDir,t.runsDir,t.schemasDir,t.wikiDir].map((i)=>yt(i)),readOnlySourceAccess:!0,network:{webSearchEnabled:n.safety?.network?.web_search_enabled??kt("HASNA_KNOWLEDGE_WEB_SEARCH"),s3ReadsEnabled:n.safety?.network?.s3_reads_enabled??kt("HASNA_KNOWLEDGE_ALLOW_S3_READS"),allowedS3Buckets:[...r].sort()},redaction:{enabled:n.safety?.redaction?.enabled??!0},approvals:{generatedWritesRequireApproval:n.safety?.approvals?.generated_writes_require_approval??!0}}}function jn(e,t){let n=Pn(e,t);return n===""||!n.startsWith("..")&&n!==".."&&!n.startsWith(`..${Un}`)}function X(e,t){let n=yt(e);if(!t.allowWriteRoots.some((r)=>jn(r,n)))throw Error(`Safety policy denied write outside .hasna/apps/knowledge: ${e}`)}function K(e,t){let r=new URL(e).hostname;if(!t.network.s3ReadsEnabled)throw Error("Safety policy denied S3 read. Set safety.network.s3_reads_enabled=true or HASNA_KNOWLEDGE_ALLOW_S3_READS=1.");if(!t.network.allowedS3Buckets.includes(r))throw Error(`Safety policy denied S3 bucket "${r}". Add it to safety.network.allowed_s3_buckets or HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS.`)}function ue(e){if(!e.network.webSearchEnabled)throw Error("Safety policy denied web search. Set safety.network.web_search_enabled=true or HASNA_KNOWLEDGE_WEB_SEARCH=1.")}var Mn=[{type:"private_key_block",severity:"high",regex:/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,replacement:"[REDACTED:private_key_block]"},{type:"secret_assignment",severity:"high",regex:/\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"]?[^'"\s]{8,}/gi,replacement:"[REDACTED:secret_assignment]"},{type:"openai_api_key",severity:"high",regex:/\bsk-[A-Za-z0-9_-]{20,}\b/g,replacement:"[REDACTED:openai_api_key]"},{type:"anthropic_api_key",severity:"high",regex:/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,replacement:"[REDACTED:anthropic_api_key]"},{type:"aws_access_key_id",severity:"high",regex:/\bA(?:KIA|SIA)[A-Z0-9]{16}\b/g,replacement:"[REDACTED:aws_access_key_id]"}];function de(e,t){if(t&&!t.redaction.enabled)return{text:e,findings:[]};let n=e,r=[];for(let i of Mn)n=n.replace(i.regex,(s,...d)=>{let l=typeof d.at(-2)==="number"?d.at(-2):n.indexOf(s);return r.push({type:i.type,severity:i.severity,start:Math.max(0,l),end:Math.max(0,l+s.length)}),i.replacement});return{text:n,findings:r}}function Fn(e){return`audit_${Dn("sha256").update(`${e.event_type}\x00${e.action}\x00${e.target_uri??""}\x00${e.created_at??""}\x00${JSON.stringify(e.metadata??{})}\x00${Me()}`).digest("hex").slice(0,24)}`}function R(e,t){let n=t.created_at??new Date().toISOString(),r=Fn({...t,created_at:n});return e.run(`INSERT INTO audit_events (id, event_type, action, target_uri, decision, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,[r,t.event_type,t.action,t.target_uri??null,t.decision,JSON.stringify(t.metadata??{}),n]),r}function le(e,t){let n=t.created_at??new Date().toISOString();for(let r of t.findings)e.run(`INSERT INTO redaction_findings (id, source_uri, run_id, severity, finding_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,[`redact_${Me()}`,t.source_uri??null,t.run_id??null,r.severity,r.type,JSON.stringify({...t.metadata??{},start:r.start,end:r.end}),n]);return t.findings.length}function vt(e,t){let n=t.created_at??new Date().toISOString(),r=`approval_${Me()}`;return e.run(`INSERT INTO approval_gates (id, action, target_uri, status, reason, approved_by, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,[r,t.action,t.target_uri??null,"approved",t.reason??null,t.approved_by??"local-cli",JSON.stringify(t.metadata??{}),n,n]),{id:r,status:"approved"}}function Kn(e,t,n){let r=e.query(`SELECT id FROM approval_gates
     WHERE action = ? AND status = 'approved' AND (target_uri IS NULL OR target_uri = ? OR ? IS NULL)
     ORDER BY updated_at DESC LIMIT 1`).get(t,n??null,n??null);return Boolean(r)}function Tt(e,t,n,r){let i=n==="generated_write"&&t.approvals.generatedWritesRequireApproval,s=!i||Kn(e,n,r);return{action:n,target_uri:r??null,approval_required:i,approved:s,decision:s?"allow":"requires_approval"}}function _e(e,t){return`${e}_${Wn("sha256").update(t).digest("hex").slice(0,20)}`}function q(e){return e&&typeof e==="object"&&!Array.isArray(e)?e:void 0}function T(e){return typeof e==="string"&&e.length>0?e:void 0}function Bn(e){let t=T(e.source_ref)??T(e.source_uri)??T(e.uri);if(t)return t;let n=T(e.file_id);if(n){let s=T(e.revision_id)??T(e.revision),d=`open-files://file/${encodeURIComponent(n)}`;return s?`${d}/revision/${encodeURIComponent(s)}`:d}let r=T(e.source_id),i=T(e.path);if(r&&i)return`open-files://source/${encodeURIComponent(r)}/path/${encodeURIComponent(i)}`;throw Error("Outbox event is missing source_ref, file_id, or source_id/path.")}function zn(e,t){if(t.kind==="open-files"&&t.entity==="file"&&t.revision_id)return e.replace(/\/revision\/[^/]+$/,"");return e}function Gn(e){return T(e.hash)??T(e.checksum)??T(e.sha256)??null}function Jn(e,t,n){return T(e.revision_id)??T(e.revision)??T(e.version_id)??(t.kind==="open-files"?t.revision_id:void 0)??n??null}function Yn(e){return(T(e.event)??T(e.type)??T(e.action)??T(e.change_type)??"changed").toLowerCase()}function Vn(e){let t=T(e.path);return T(e.title)??T(e.name)??(t?qn(t):null)}function Qn(e,t){let n=Bn(e),r=P(n),i=Gn(e);return{raw:e,eventType:Yn(e),sourceRef:n,sourceUri:zn(n,r),kind:r.kind,title:Vn(e),revision:Jn(e,r,i),hash:i,status:T(e.status)?.toLowerCase()??null,updatedAt:T(e.updated_at)??t,acl:e.permissions??e.acl??void 0}}function Zn(e){let t=e.trim();if(!t)return[];if(t.startsWith("[")){let n=JSON.parse(t);if(!Array.isArray(n))throw Error("Outbox array parse failed.");return n.map((r)=>{let i=q(r);if(!i)throw Error("Outbox array entries must be objects.");return i})}if(t.startsWith("{"))try{let n=JSON.parse(t),r=q(n);if(!r)throw Error("Outbox object parse failed.");if(Array.isArray(r.events))return r.events.map((i)=>{let s=q(i);if(!s)throw Error("Outbox events entries must be objects.");return s});if("source_ref"in r||"source_uri"in r||"file_id"in r)return[r]}catch(n){let r=t.split(/\r?\n/).filter((i)=>i.trim().length>0);if(r.length<=1)throw n;return r.map((i)=>{let s=q(JSON.parse(i));if(!s)throw Error("Outbox JSONL entries must be objects.");return s})}return t.split(/\r?\n/).filter((n)=>n.trim().length>0).map((n)=>{let r=q(JSON.parse(n));if(!r)throw Error("Outbox JSONL entries must be objects.");return r})}async function er(e,t,n){let r=new URL(e),i=r.hostname,s=decodeURIComponent(r.pathname.replace(/^\/+/,""));if(!i||!s)throw Error(`Invalid S3 outbox URI: ${e}`);if(n)K(e,n);let[{S3Client:d,GetObjectCommand:l},{fromIni:a}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]),o=t?.storage.type==="s3"&&t.storage.s3?.bucket===i?t.storage.s3:void 0,u=await new d({region:o?.region,credentials:o?.profile?a({profile:o.profile}):void 0,maxAttempts:o?.max_attempts}).send(new l({Bucket:i,Key:s}));if(!u.Body)return"";return await u.Body.transformToString()}async function tr(e,t,n){if(e.startsWith("s3://"))return er(e,t,n);if(!$n(e))throw Error(`Outbox not found: ${e}`);return Hn(e,"utf8")}function xt(e,t){let n={};if(e)try{n=q(JSON.parse(e))??{}}catch{n={}}return JSON.stringify({...n,...t})}function nr(e,t,n){let r=_e("src",t.sourceUri);e.run(`INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       kind = excluded.kind,
       title = COALESCE(excluded.title, sources.title),
       updated_at = excluded.updated_at`,[r,t.sourceUri,t.kind,t.title,JSON.stringify({source_ref:t.sourceRef,source_uri:t.sourceUri,status:t.status,last_outbox_event:t.eventType}),JSON.stringify(t.acl??{}),n,t.updatedAt]);let i=e.query("SELECT id, metadata_json, acl_json FROM sources WHERE uri = ?").get(t.sourceUri);if(!i)throw Error(`Failed to upsert source for outbox event: ${t.sourceUri}`);let s={source_ref:t.sourceRef,source_uri:t.sourceUri,last_outbox_event:t.eventType,last_outbox_at:t.updatedAt};if(t.status)s.status=t.status;if(T(t.raw.path))s.path=t.raw.path;return e.run("UPDATE sources SET metadata_json = ?, acl_json = CASE WHEN ? IS NULL THEN acl_json ELSE ? END, updated_at = ? WHERE id = ?",[xt(i.metadata_json,s),t.acl===void 0?null:JSON.stringify(t.acl),t.acl===void 0?null:JSON.stringify(t.acl),t.updatedAt,i.id]),i.id}function rr(e,t,n,r){if(!n.revision)return null;let i=_e("rev",`${t}\x00${n.revision}`),s={source_ref:n.sourceRef,source_uri:n.sourceUri,status:n.status,last_outbox_event:n.eventType,reindex_required:!0};return e.run(`INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, revision) DO UPDATE SET
       hash = COALESCE(excluded.hash, source_revisions.hash),
       metadata_json = excluded.metadata_json`,[i,t,n.revision,n.hash,T(n.raw.extracted_text_ref)??null,JSON.stringify(s),r]),e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").get(t,n.revision)?.id??null}function ir(e,t,n){if(n.revision)return e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").all(t,n.revision).map((r)=>r.id);if(n.hash)return e.query("SELECT id FROM source_revisions WHERE source_id = ? AND hash = ?").all(t,n.hash).map((r)=>r.id);return e.query("SELECT id FROM source_revisions WHERE source_id = ?").all(t).map((r)=>r.id)}function sr(e,t){let n=e.query("SELECT id FROM chunks WHERE source_revision_id = ?").all(t),r=0,i=0;for(let d of n){let l=e.query("SELECT COUNT(*) AS n FROM chunk_embeddings WHERE chunk_id = ?").get(d.id);r+=l?.n??0;let a=e.query("SELECT COUNT(*) AS n FROM vector_index_entries WHERE chunk_id = ?").get(d.id);i+=a?.n??0,e.run("DELETE FROM vector_index_entries WHERE chunk_id = ?",[d.id]),e.run("DELETE FROM chunk_embeddings WHERE chunk_id = ?",[d.id]),e.run("DELETE FROM chunks_fts WHERE chunk_id = ?",[d.id])}e.run("DELETE FROM chunks WHERE source_revision_id = ?",[t]);let s=e.query("SELECT metadata_json FROM source_revisions WHERE id = ?").get(t);return e.run("UPDATE source_revisions SET metadata_json = ? WHERE id = ?",[xt(s?.metadata_json,{reindex_required:!0,invalidated_at:new Date().toISOString()}),t]),{chunksDeleted:n.length,embeddingsDeleted:r,vectorEntriesDeleted:i}}function or(e,t){return t==="deleted"||["delete","deleted","remove","removed"].includes(e)}function ar(e){return["move","moved","rename","renamed","path_changed"].includes(e)}function cr(e){return["permission","permissions","permission_changed","acl_changed"].includes(e)}async function St(e){let t=(e.now??new Date).toISOString();if(e.safetyPolicy)X(e.dbPath,e.safetyPolicy);w(e.dbPath);let n=await tr(e.input,e.config,e.safetyPolicy),r=Zn(n),i=S(e.dbPath),s=`run_${Xn()}`;try{return i.transaction(()=>{i.run(`INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,[s,"open-files-outbox",e.input,"completed","local","open-files-outbox",JSON.stringify({path:e.input,events:r.length}),t,t]);let d=new Set,l=new Set,a=0,o=0,c=0,u=0,_=0,f=0,m=0;return R(i,{event_type:"source_read",action:e.input.startsWith("s3://")?"s3_outbox_read":"local_outbox_read",target_uri:e.input,decision:"allow",metadata:{events:r.length,read_only:!0},created_at:t}),r.forEach((y,k)=>{let g=Qn(y,t),b=nr(i,g,t);d.add(b);let x=rr(i,b,g,t);if(x)l.add(x);let p=ir(i,b,g);for(let A of p){l.add(A);let h=sr(i,A);a+=h.chunksDeleted,o+=h.embeddingsDeleted,c+=h.vectorEntriesDeleted,u+=1}if(or(g.eventType,g.status))_+=1;if(ar(g.eventType))f+=1;if(cr(g.eventType)||g.acl!==void 0)m+=1;i.run(`INSERT INTO run_events (id, run_id, level, event, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,[_e("evt",`${s}\x00${k}\x00${g.sourceRef}\x00${g.eventType}`),s,"info",g.eventType,JSON.stringify({source_ref:g.sourceRef,source_uri:g.sourceUri,revision:g.revision,hash:g.hash,status:g.status,affected_revisions:p.length}),g.updatedAt])}),i.run(`INSERT INTO provider_usage (id, run_id, provider, model, input_tokens, output_tokens, cost_usd, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`,[_e("usage",s),s,"local","open-files-outbox",JSON.stringify({note:"No model provider used for outbox invalidation."}),t]),R(i,{event_type:"write",action:"knowledge_outbox_invalidation",target_uri:e.dbPath,decision:"allow",metadata:{run_id:s,events:r.length,sources:d.size,revisions:l.size,chunks_deleted:a,embeddings_deleted:o,vector_entries_deleted:c},created_at:t}),{path:e.input,db_path:e.dbPath,run_id:s,events_seen:r.length,sources_touched:d.size,revisions_touched:l.size,chunks_deleted:a,embeddings_deleted:o,vector_entries_deleted:c,stale_revisions:u,deleted_sources:_,moved_sources:f,permission_updates:m}})()}finally{i.close()}}import{createHash as ur}from"crypto";import{existsSync as dr,readFileSync as lr}from"fs";import{basename as _r}from"path";function Fe(e,t){return`${e}_${ur("sha256").update(t).digest("hex").slice(0,20)}`}function B(e){return e&&typeof e==="object"&&!Array.isArray(e)?e:void 0}function v(e){return typeof e==="string"&&e.length>0?e:void 0}function fr(e){return typeof e==="number"&&Number.isFinite(e)?e:void 0}function gr(e){let t=v(e.source_ref)??v(e.source_uri)??v(e.uri);if(t)return t;let n=v(e.file_id);if(n){let s=v(e.revision_id)??v(e.revision),d=`open-files://file/${encodeURIComponent(n)}`;return s?`${d}/revision/${encodeURIComponent(s)}`:d}let r=v(e.source_id),i=v(e.path);if(r&&i)return`open-files://source/${encodeURIComponent(r)}/path/${encodeURIComponent(i)}`;throw Error("Manifest item is missing source_ref, file_id, or source_id/path.")}function pr(e,t){if(t.kind==="open-files"&&t.entity==="file"&&t.revision_id)return e.replace(/\/revision\/[^/]+$/,"");return e}function hr(e){let t=v(e.extracted_text)??v(e.text)??v(e.content_text)??v(e.markdown);if(t!==void 0)return t;let n=e.content;return typeof n==="string"?n:null}function mr(e){let t=v(e.extracted_text_ref)??v(e.extracted_text_uri)??v(e.text_ref);if(t)return t;let n=B(e.content);return v(n?.extracted_text_ref)??v(n?.extracted_text_uri)??null}function Er(e){let t=v(e.path);return v(e.title)??v(e.name)??(t?_r(t):null)}function kr(e){return v(e.hash)??v(e.checksum)??v(e.sha256)??null}function yr(e,t,n){return v(e.revision_id)??v(e.revision)??v(e.version_id)??(t.kind==="open-files"?t.revision_id:void 0)??n??v(e.updated_at)??"current"}function br(e,t){let n={};for(let[r,i]of Object.entries(e)){if(["text","content","content_text","extracted_text","markdown"].includes(r))continue;n[r]=i}return n.source_ref=t.sourceRef,n.source_uri=t.sourceUri,n.status=t.status,n}function vr(e,t){let n=gr(e),r=P(n),i=pr(n,r),s=kr(e),d=v(e.status)??"active";return{raw:e,sourceRef:n,sourceUri:i,kind:r.kind,title:Er(e),revision:yr(e,r,s),hash:s,extractedTextUri:mr(e),text:hr(e),metadata:br(e,{sourceRef:n,sourceUri:i,status:d}),acl:e.permissions??e.acl??{},status:d,updatedAt:v(e.updated_at)??t}}function Tr(e){let t=e.trim();if(!t)return[];if(t.startsWith("[")){let n=JSON.parse(t);if(!Array.isArray(n))throw Error("Manifest array parse failed.");return n.map((r)=>{let i=B(r);if(!i)throw Error("Manifest array entries must be objects.");return i})}if(t.startsWith("{"))try{let n=JSON.parse(t),r=B(n);if(!r)throw Error("Manifest object parse failed.");if(Array.isArray(r.items))return r.items.map((i)=>{let s=B(i);if(!s)throw Error("Manifest items entries must be objects.");return s});if("source_ref"in r||"source_uri"in r||"file_id"in r)return[r]}catch(n){let r=t.split(/\r?\n/).filter((i)=>i.trim().length>0);if(r.length<=1)throw n;return r.map((i)=>{let s=B(JSON.parse(i));if(!s)throw Error("Manifest JSONL entries must be objects.");return s})}return t.split(/\r?\n/).filter((n)=>n.trim().length>0).map((n)=>{let r=B(JSON.parse(n));if(!r)throw Error("Manifest JSONL entries must be objects.");return r})}async function xr(e,t,n){let r=new URL(e),i=r.hostname,s=decodeURIComponent(r.pathname.replace(/^\/+/,""));if(!i||!s)throw Error(`Invalid S3 manifest URI: ${e}`);if(n)K(e,n);let[{S3Client:d,GetObjectCommand:l},{fromIni:a}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]),o=t?.storage.type==="s3"&&t.storage.s3?.bucket===i?t.storage.s3:void 0,u=await new d({region:o?.region,credentials:o?.profile?a({profile:o.profile}):void 0,maxAttempts:o?.max_attempts}).send(new l({Bucket:i,Key:s}));if(!u.Body)return"";return await u.Body.transformToString()}async function Sr(e,t,n){if(e.startsWith("s3://"))return xr(e,t,n);if(!dr(e))throw Error(`Manifest not found: ${e}`);return lr(e,"utf8")}function wr(e,t,n){let r=e.replace(/\r\n/g,`
`);if(!r.trim())return[];let i=[],s=0;while(s<r.length){let d=Math.min(r.length,s+t),l=d;if(d<r.length){let o=r.lastIndexOf(`

`,d),c=r.lastIndexOf(". ",d),u=Math.max(o,c);if(u>s+Math.floor(t*0.5))l=u+(u===o?2:1)}let a=r.slice(s,l).trim();if(a)i.push({ordinal:i.length,text:a,startOffset:s,endOffset:l});if(l>=r.length)break;s=Math.max(0,l-n)}return i}function Rr(e){let t=e.trim().split(/\s+/).filter(Boolean).length;return Math.max(1,Math.ceil(t*1.25))}function Or(e,t){let n=e.query("SELECT id FROM chunks WHERE source_revision_id = ?").all(t);for(let r of n)e.run("DELETE FROM chunks_fts WHERE chunk_id = ?",[r.id]);return e.run("DELETE FROM chunks WHERE source_revision_id = ?",[t]),n.length}function Nr(e,t,n){let r=Fe("src",t.sourceUri);e.run(`INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       kind = excluded.kind,
       title = excluded.title,
       metadata_json = excluded.metadata_json,
       acl_json = excluded.acl_json,
       updated_at = excluded.updated_at`,[r,t.sourceUri,t.kind,t.title,JSON.stringify(t.metadata),JSON.stringify(t.acl??{}),n,t.updatedAt]);let i=e.query("SELECT id FROM sources WHERE uri = ?").get(t.sourceUri);if(!i)throw Error(`Failed to upsert source: ${t.sourceUri}`);return i.id}function Ar(e,t,n,r){let i=Fe("rev",`${t}\x00${n.revision}`);e.run(`INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, revision) DO UPDATE SET
       hash = excluded.hash,
       extracted_text_uri = excluded.extracted_text_uri,
       metadata_json = excluded.metadata_json`,[i,t,n.revision,n.hash,n.extractedTextUri,JSON.stringify(n.metadata),r]);let s=e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").get(t,n.revision);if(!s)throw Error(`Failed to upsert source revision: ${n.sourceRef}`);return s.id}function Ir(e,t,n,r,i,s,d){if(!n.text||n.status.toLowerCase()==="deleted")return{chunksInserted:0,redactions:0};let l=de(n.text,d);if(l.findings.length>0)le(e,{source_uri:n.sourceUri,findings:l.findings,metadata:{source_ref:n.sourceRef,revision:n.revision},created_at:r}),R(e,{event_type:"redaction",action:"source_text_redact",target_uri:n.sourceUri,decision:"redacted",metadata:{findings:l.findings.length,source_ref:n.sourceRef,revision:n.revision},created_at:r});let a=wr(l.text,i,s);for(let o of a){let c=Fe("chk",`${t}\x00${o.ordinal}\x00${o.text}`),u=F({source_ref:n.sourceRef,source_uri:n.sourceUri,source_kind:n.kind,source_revision_id:t,revision:n.revision,hash:n.hash,chunk_id:c,start_offset:o.startOffset,end_offset:o.endOffset,status:n.status,resolver:"open-files-read-only"}),_=ct({source_ref:n.sourceRef,source_uri:n.sourceUri,source_kind:n.kind,source_revision_id:t,revision:n.revision,hash:n.hash,status:n.status,path:v(n.raw.path)??null,mime:v(n.raw.mime)??v(n.raw.content_type)??null,size:fr(n.raw.size)??null},u);e.run(`INSERT INTO chunks (id, source_revision_id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,[c,t,"source",o.ordinal,o.text,Rr(o.text),o.startOffset,o.endOffset,JSON.stringify(_),r]),e.run("INSERT INTO chunks_fts (chunk_id, text, title, source_uri) VALUES (?, ?, ?, ?)",[c,o.text,n.title??"",n.sourceUri])}return{chunksInserted:a.length,redactions:l.findings.length}}async function wt(e){let t=e.now??new Date;if(e.safetyPolicy)X(e.dbPath,e.safetyPolicy);w(e.dbPath);let n=await Sr(e.input,e.config,e.safetyPolicy),r=Tr(n);return Ke({dbPath:e.dbPath,items:r,sourceLabel:e.input,safetyPolicy:e.safetyPolicy,now:t,maxChunkChars:e.maxChunkChars,chunkOverlapChars:e.chunkOverlapChars})}async function Ke(e){let t=(e.now??new Date).toISOString(),n=e.maxChunkChars??4000,r=e.chunkOverlapChars??200;if(n<500)throw Error("maxChunkChars must be at least 500.");if(r<0||r>=n)throw Error("chunkOverlapChars must be less than maxChunkChars.");if(e.safetyPolicy)X(e.dbPath,e.safetyPolicy);w(e.dbPath);let i=S(e.dbPath);try{return i.transaction(()=>{let d=new Set,l=new Set,a=0,o=0,c=0,u=0;R(i,{event_type:"source_read",action:e.readAction??(e.sourceLabel.startsWith("s3://")?"s3_manifest_read":"local_manifest_read"),target_uri:e.sourceLabel,decision:"allow",metadata:{items:e.items.length,read_only:!0},created_at:t});for(let _ of e.items){let f=vr(_,t),m=Nr(i,f,t),y=Ar(i,m,f,t);if(d.add(m),l.add(y),f.text||f.status.toLowerCase()==="deleted")o+=Or(i,y);let k=Ir(i,y,f,t,n,r,e.safetyPolicy);a+=k.chunksInserted,c+=k.redactions}return R(i,{event_type:"write",action:"knowledge_manifest_ingest",target_uri:e.dbPath,decision:"allow",metadata:{items:e.items.length,sources:d.size,revisions:l.size,chunks_inserted:a,redactions:c},created_at:t}),{path:e.sourceLabel,db_path:e.dbPath,items_seen:e.items.length,sources_upserted:d.size,revisions_upserted:l.size,chunks_inserted:a,chunks_deleted:o,redactions:c,skipped:u}})()}finally{i.close()}}import{createHash as Mr}from"crypto";import{existsSync as Fr,readFileSync as Kr}from"fs";import{basename as pe}from"path";function fe(e){if(!e)return{};try{let t=JSON.parse(e);return t&&typeof t==="object"&&!Array.isArray(t)?t:{}}catch{return{}}}function $(e,t){for(let n of t){let r=e[n];if(typeof r==="string"&&r.length>0)return r}return null}function Rt(e,t){for(let n of t){let r=e[n];if(typeof r==="number"&&Number.isFinite(r))return r}return null}function Lr(e,t){let n=e.mode;if(typeof n==="string"&&n!=="read_only")throw Error(`Source resolver denied ${t}. Permission mode is ${n}, expected read_only.`);let r=e.denied_purposes;if(Array.isArray(r)&&r.includes(t))throw Error(`Source resolver denied ${t}. Purpose is explicitly denied.`);let i=e.allowed_purposes;if(Array.isArray(i)&&i.length>0&&!i.includes(t))throw Error(`Source resolver denied ${t}. Allowed purposes: ${i.join(", ")}`)}function Cr(e,t,n){if(!t)return n;try{let r=P(e);if(r.kind==="open-files"&&r.entity==="file")return`${e}/revision/${encodeURIComponent(t.revision)}`}catch{return n}return n}function Dr(e,t,n){return e.query(`SELECT id, uri, kind, title, metadata_json, acl_json, updated_at
     FROM sources
     WHERE uri = ? OR uri = ?
     ORDER BY CASE WHEN uri = ? THEN 0 ELSE 1 END
     LIMIT 1`).get(t,n,t)??null}function Pr(e,t,n){if(n)return e.query(`SELECT id, revision, hash, extracted_text_uri, metadata_json, created_at
       FROM source_revisions
       WHERE source_id = ? AND revision = ?
       LIMIT 1`).get(t,n)??null;return e.query(`SELECT id, revision, hash, extracted_text_uri, metadata_json, created_at
     FROM source_revisions
     WHERE source_id = ?
     ORDER BY created_at DESC, revision DESC
     LIMIT 1`).get(t)??null}function Ur(e,t){if(!t)return 0;return e.query("SELECT COUNT(*) AS n FROM chunks WHERE source_revision_id = ?").get(t)?.n??0}function jr(e,t,n){if(!t||n<=0)return[];return e.query(`SELECT id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json
     FROM chunks
     WHERE source_revision_id = ?
     ORDER BY ordinal ASC
     LIMIT ?`).all(t,n)}async function ge(e){let t=e.purpose??"knowledge_answer",n=Math.max(0,Math.min(e.limit??10,100)),r=(e.now??new Date).toISOString(),i=P(e.sourceRef),s=mt(e.sourceRef,i),d=Et(e.sourceRef);if(e.safetyPolicy){if(!e.safetyPolicy.readOnlySourceAccess)throw Error("Safety policy denied source resolution.");X(e.dbPath,e.safetyPolicy)}w(e.dbPath);let l=S(e.dbPath);try{return l.transaction(()=>{let a=Dr(l,s,e.sourceRef);if(!a)return R(l,{event_type:"source_read",action:"open_files_resolve_missing",target_uri:e.sourceRef,decision:"allow",metadata:{purpose:t,read_only:!0,source_uri:s},created_at:r}),{source_ref:e.sourceRef,source_uri:s,purpose:t,read_only:!0,resolved:!1,resolver:{name:"open-files-read-only",mode:"local_catalog",contract:"open-files-knowledge-source-v1"},source:null,revision:null,content:{mime:null,size:null,hash:null,text_available:!1,chunks_total:0,chunks_returned:0,char_count_returned:0,extracted_text_ref:null,bytes_available:!1,bytes_exposed:!1},chunks:[],citations:[]};let o=fe(a.metadata_json),c=fe(a.acl_json);try{Lr(c,t)}catch(p){throw R(l,{event_type:"source_read",action:"open_files_resolve",target_uri:e.sourceRef,decision:"deny",metadata:{purpose:t,read_only:!0,source_uri:a.uri,error:p instanceof Error?p.message:String(p)},created_at:r}),p}let u=Pr(l,a.id,d),_=fe(u?.metadata_json),f=Ur(l,u?.id??null),m=jr(l,u?.id??null,n),y=Cr(a.uri,u,e.sourceRef),k=m.map((p)=>{let A=fe(p.metadata_json),h={resolver:"open-files-read-only",mode:"local_catalog",purpose:t,read_only:!0,source_ref:$(A,["source_ref"])??y,source_uri:a.uri,source_revision_id:u?.id??null,revision:u?.revision??null,hash:u?.hash??$(A,["hash"]),chunk_id:p.id,start_offset:p.start_offset,end_offset:p.end_offset,resolved_at:r},G=F({source_ref:h.source_ref,source_uri:h.source_uri,source_kind:a.kind,source_revision_id:h.source_revision_id,revision:h.revision,hash:h.hash,chunk_id:p.id,start_offset:p.start_offset,end_offset:p.end_offset,status:$(A,["status"]),resolver:h.resolver});return{id:p.id,kind:p.kind,ordinal:p.ordinal,text:p.text,token_count:p.token_count,start_offset:p.start_offset,end_offset:p.end_offset,metadata:A,evidence:h,provenance:G}}),g=k.map((p)=>({source_ref:p.evidence.source_ref,source_uri:a.uri,chunk_id:p.id,quote:p.text.slice(0,500),start_offset:p.start_offset,end_offset:p.end_offset,evidence:p.evidence,provenance:p.provenance}));R(l,{event_type:"source_read",action:"open_files_resolve",target_uri:e.sourceRef,decision:"allow",metadata:{purpose:t,read_only:!0,source_uri:a.uri,revision:u?.revision??null,chunks_returned:k.length,chunks_total:f},created_at:r});let b=$(o,["mime","content_type"])??$(_,["mime","content_type"]),x=Rt(o,["size","size_bytes"])??Rt(_,["size","size_bytes"]);return{source_ref:y,source_uri:a.uri,purpose:t,read_only:!0,resolved:!0,resolver:{name:"open-files-read-only",mode:"local_catalog",contract:"open-files-knowledge-source-v1"},source:{id:a.id,uri:a.uri,kind:a.kind,title:a.title,metadata:o,permissions:c,updated_at:a.updated_at},revision:u?{id:u.id,revision:u.revision,hash:u.hash,extracted_text_uri:u.extracted_text_uri,metadata:_,created_at:u.created_at,reindex_required:_.reindex_required===!0}:null,content:{mime:b,size:x,hash:u?.hash??$(o,["hash","checksum","sha256"]),text_available:f>0,chunks_total:f,chunks_returned:k.length,char_count_returned:k.reduce((p,A)=>p+A.text.length,0),extracted_text_ref:u?.extracted_text_uri??$(_,["extracted_text_ref","extracted_text_uri"]),bytes_available:!1,bytes_exposed:!1},chunks:k,citations:g}})()}finally{l.close()}}function z(e){return`sha256:${Mr("sha256").update(e).digest("hex")}`}function Wr(e){return e.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+\n/g,`
`).replace(/\n\s+/g,`
`).replace(/[ \t]{2,}/g," ").trim()}async function Xr(e,t,n){let r=new URL(e),i=r.hostname,s=decodeURIComponent(r.pathname.replace(/^\/+/,""));if(!i||!s)throw Error(`Invalid S3 source URI: ${e}`);if(n)K(e,n);let[{S3Client:d,GetObjectCommand:l},{fromIni:a}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]),o=t?.storage.type==="s3"&&t.storage.s3?.bucket===i?t.storage.s3:void 0,u=await new d({region:o?.region,credentials:o?.profile?a({profile:o.profile}):void 0,maxAttempts:o?.max_attempts}).send(new l({Bucket:i,Key:s}));if(!u.Body)return"";return await u.Body.transformToString()}async function $r(e,t){if(t)ue(t);let n=await fetch(e,{headers:{accept:"text/markdown,text/plain,text/html,application/json;q=0.8,*/*;q=0.5","user-agent":"@hasna/knowledge source-ingest"}});if(!n.ok)throw Error(`Web source read failed ${n.status}: ${e}`);let r=n.headers.get("content-type"),i=await n.text();return{text:r?.includes("html")?Wr(i):i,mime:r}}function he(e){if(e.kind==="file")return pe(e.path);if(e.kind==="s3")return pe(e.key);if(e.kind==="web")return pe(new URL(e.url).pathname)||e.url;return e.path?pe(e.path):e.id}async function Ot(e,t,n){if(e.kind==="file"){if(!Fr(e.path))throw Error(`Source file not found: ${e.path}`);let r=Kr(e.path,"utf8");return{text:r,contentSource:"file",title:he(e),mime:"text/plain",size:r.length,hash:z(r),revision:null,extractedTextRef:null,metadata:{path:e.path},permissions:{mode:"read_only"}}}if(e.kind==="s3"){let r=await Xr(e.uri,t,n);return{text:r,contentSource:"s3",title:he(e),mime:"text/plain",size:r.length,hash:z(r),revision:null,extractedTextRef:null,metadata:{bucket:e.bucket,key:e.key},permissions:{mode:"read_only"}}}if(e.kind==="web"){let r=await $r(e.url,n);return{text:r.text,contentSource:"web",title:he(e),mime:r.mime,size:r.text.length,hash:z(r.text),revision:null,extractedTextRef:null,metadata:{url:e.url},permissions:{mode:"read_only"}}}throw Error(`Direct source reading is not available for ${e.uri}`)}async function Hr(e,t,n){if(e.startsWith("open-files://"))throw Error("Open-files extracted text refs require an open-files resolver API. Ingest an open-files manifest with extracted_text or an extracted_text_ref using file://, s3://, or https://.");let r=P(e);return{text:(await Ot(r,t,n)).text,contentSource:"extracted_text_ref"}}async function qr(e){let t=await ge({dbPath:e.dbPath,sourceRef:e.sourceRef,purpose:e.purpose??"knowledge_index",limit:100,safetyPolicy:e.safetyPolicy,now:e.now});if(!t.resolved)throw Error("Open-files source is not in the local knowledge catalog. Ingest an open-files manifest first or use the open-files resolver API.");if(t.revision?.extracted_text_uri&&!t.content.text_available){let r=await Hr(t.revision.extracted_text_uri,e.config,e.safetyPolicy);return{text:r.text,contentSource:r.contentSource,title:t.source?.title??null,mime:t.content.mime,size:r.text.length,hash:t.revision.hash??z(r.text),revision:t.revision.revision,extractedTextRef:t.revision.extracted_text_uri,metadata:t.source?.metadata??{},permissions:t.source?.permissions??{mode:"read_only"}}}if(t.chunks.length===0)throw Error("Open-files source has no extracted text chunks yet. Ingest an open-files manifest with extracted_text or extracted_text_ref first.");let n=t.chunks.map((r)=>r.text).join(`

`);return{text:n,contentSource:"catalog_chunks",title:t.source?.title??null,mime:t.content.mime,size:n.length,hash:t.revision?.hash??z(n),revision:t.revision?.revision??null,extractedTextRef:t.revision?.extracted_text_uri??null,metadata:t.source?.metadata??{},permissions:t.source?.permissions??{mode:"read_only"}}}function Br(e,t,n,r){let i=n.hash??z(n.text),s={...n.metadata,source_ref:e,content_source:n.contentSource,read_only:!0},d={source_ref:e,name:n.title??he(t),mime:n.mime??"text/plain",size:n.size??n.text.length,hash:i,revision:n.revision??i,status:"active",updated_at:new Date().toISOString(),permissions:{mode:"read_only",allowed_purposes:[r],...n.permissions},metadata:s,extracted_text_ref:n.extractedTextRef,extracted_text:n.text};if(t.kind==="open-files"){if(t.entity==="file")d.file_id=t.id;if(t.entity==="source")d.source_id=t.id,d.path=t.path}if(t.kind==="file")d.path=t.path;if(t.kind==="s3")d.path=t.key;if(t.kind==="web")d.url=t.url;return d}async function Nt(e){let t=e.purpose??"knowledge_index",n=P(e.sourceRef),r=n.kind==="open-files"?await qr(e):await Ot(n,e.config,e.safetyPolicy),i=Br(e.sourceRef,n,r,t);return{...await Ke({dbPath:e.dbPath,items:[i],sourceLabel:e.sourceRef,readAction:"source_ref_ingest_read",safetyPolicy:e.safetyPolicy,now:e.now}),source_ref:e.sourceRef,content_source:r.contentSource,read_only:!0,hash:String(i.hash)}}import{createHash as oi}from"crypto";function Ee(e){if(!e)return{};try{let t=JSON.parse(e);return t&&typeof t==="object"&&!Array.isArray(t)?t:{}}catch{return{}}}function D(e,t){for(let n of t){let r=e[n];if(typeof r==="string"&&r.length>0)return r}return null}function At(e,t){for(let n of t){let r=e[n];if(typeof r==="number"&&Number.isFinite(r))return r}return null}function It(e){return Array.from(new Set(e))}function zr(e){let t=e.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}_]+/gu)??[];return It(t.filter((n)=>n.length>0)).slice(0,16)}function Gr(e){if(e.length===0)return null;return e.map((t)=>`${t}*`).join(" OR ")}function Jr(e){return e.replace(/[\\%_]/g,(t)=>`\\${t}`)}function Lt(e,t){return e.flatMap((n)=>Array.from({length:t},()=>`%${Jr(n)}%`))}function Yr(e,t){let n=Number.isFinite(e)?1/(1+Math.abs(e)):0,r=1/(1+t);return ke(Math.max(n,r))}function Ct(e,t){if(t.length===0)return 0;let n=t.filter((r)=>e.includes(r)).length;if(n===0)return 0;return ke(Math.min(0.85,0.35+n/t.length*0.5))}function Vr(e){return ke(Math.max(0,Math.min(1,(e+1)/2)))}function ke(e){return Number(e.toFixed(6))}function Z(e,t){let n=e.keyword??0,r=e.semantic??0,i=e.catalog??0,s=t?.chunk_id?0.05:0;return ke(Math.min(1,n*0.55+r*0.4+i*0.35+s))}function We(e){let t=e.provenance;return t&&typeof t==="object"&&!Array.isArray(t)?t:null}function Qr(e){let t=Ee(e.chunk_metadata_json),n=We(t);if(n)return n;if(!e.source_revision_id&&!e.source_uri)return null;return F({source_ref:D(t,["source_ref"]),source_uri:e.source_uri??D(t,["source_uri"]),source_kind:e.source_kind??D(t,["source_kind"]),source_revision_id:e.source_revision_id,revision:e.revision??D(t,["revision"]),hash:e.hash??D(t,["hash"]),chunk_id:e.chunk_id,start_offset:e.start_offset??At(t,["start_offset"]),end_offset:e.end_offset??At(t,["end_offset"]),status:D(t,["status"]),resolver:"open-files-read-only"})}function Zr(e,t,n){if(!t)return[];return e.query(`SELECT
       chunks_fts.chunk_id,
       c.kind AS chunk_kind,
       c.wiki_page_id,
       c.text,
       c.token_count,
       c.start_offset,
       c.end_offset,
       c.metadata_json AS chunk_metadata_json,
       c.source_revision_id,
       sr.revision,
       sr.hash,
       s.uri AS source_uri,
       s.kind AS source_kind,
       s.title AS source_title,
       wp.path AS wiki_path,
       wp.title AS wiki_title,
       wp.artifact_uri AS wiki_artifact_uri,
       wp.content_hash AS wiki_content_hash,
       wp.status AS wiki_status,
       wp.metadata_json AS wiki_metadata_json,
       bm25(chunks_fts) AS rank
     FROM chunks_fts
     JOIN chunks c ON c.id = chunks_fts.chunk_id
     LEFT JOIN source_revisions sr ON sr.id = c.source_revision_id
     LEFT JOIN sources s ON s.id = sr.source_id
     LEFT JOIN wiki_pages wp ON wp.id = c.wiki_page_id
     WHERE chunks_fts MATCH ?
     ORDER BY rank ASC
     LIMIT ?`).all(t,n)}function Dt(e,t){if(t.length===0)return"1 = 0";return t.map(()=>`(${e.map((r)=>`lower(COALESCE(${r}, '')) LIKE ? ESCAPE '\\'`).join(" OR ")})`).join(" OR ")}function ei(e,t,n){let r=["path","title","artifact_uri","metadata_json"];return e.query(`SELECT id, path, title, artifact_uri, content_hash, status, metadata_json
     FROM wiki_pages
     WHERE status = 'active' AND (${Dt(r,t)})
     ORDER BY updated_at DESC
     LIMIT ?`).all(...Lt(t,r.length),n)}function ti(e,t,n){let r=["kind","name","shard_key","artifact_uri","metadata_json"];return e.query(`SELECT id, kind, name, artifact_uri, shard_key, metadata_json
     FROM knowledge_indexes
     WHERE ${Dt(r,t)}
     ORDER BY updated_at DESC
     LIMIT ?`).all(...Lt(t,r.length),n)}function ni(e,t){let n=Ee(e.chunk_metadata_json),r=Qr(e),i=D(n,["source_ref"]),s=e.source_uri??D(n,["source_uri"]),d=Boolean(e.wiki_page_id),l={kind:d?"wiki_chunk":"source_chunk",id:e.chunk_id,title:d?e.wiki_title:e.source_title,text:e.text,score:0,scores:{keyword:t},source:s||i?{uri:s,ref:i,kind:e.source_kind??D(n,["source_kind"]),revision:e.revision??D(n,["revision"]),hash:e.hash??D(n,["hash"])}:null,citation:{chunk_id:e.chunk_id,start_offset:e.start_offset,end_offset:e.end_offset},artifact:d?{uri:e.wiki_artifact_uri,path:e.wiki_path,hash:e.wiki_content_hash,shard_key:e.wiki_path}:null,provenance:r,reasons:["keyword_match"]};return l.score=Z(l.scores,l.citation),l}function ri(e,t){let n=Ee(e.metadata_json),r=Ct(`${e.path} ${e.title} ${e.artifact_uri??""} ${e.metadata_json}`.toLowerCase(),t),i={kind:"wiki_page",id:e.id,title:e.title,text:null,score:0,scores:{catalog:r},source:null,citation:null,artifact:{uri:e.artifact_uri,path:e.path,hash:e.content_hash,shard_key:e.path},provenance:We(n),reasons:["wiki_catalog_match"]};return i.score=Z(i.scores,i.citation),i}function ii(e,t){let n=Ee(e.metadata_json),r=Ct(`${e.kind} ${e.name} ${e.shard_key??""} ${e.artifact_uri??""} ${e.metadata_json}`.toLowerCase(),t),i={kind:"knowledge_index",id:e.id,title:e.name,text:null,score:0,scores:{catalog:r},source:null,citation:null,artifact:{uri:e.artifact_uri,path:D(n,["artifact_key"]),hash:D(n,["content_hash"]),shard_key:e.shard_key},provenance:We(n),reasons:["index_catalog_match"]};return i.score=Z(i.scores,i.citation),i}function me(e,t){let n=`${t.kind}:${t.id}`,r=e.get(n);if(!r){e.set(n,t);return}r.scores={keyword:Math.max(r.scores.keyword??0,t.scores.keyword??0)||void 0,semantic:Math.max(r.scores.semantic??0,t.scores.semantic??0)||void 0,catalog:Math.max(r.scores.catalog??0,t.scores.catalog??0)||void 0},r.reasons=It([...r.reasons,...t.reasons]),r.text=r.text??t.text,r.title=r.title??t.title,r.source=r.source??t.source,r.citation=r.citation??t.citation,r.artifact=r.artifact??t.artifact,r.provenance=r.provenance??t.provenance,r.score=Z(r.scores,r.citation)}function si(e){let t={source_chunk:0,wiki_chunk:1,wiki_page:2,knowledge_index:3};return e.sort((n,r)=>{if(r.score!==n.score)return r.score-n.score;return t[n.kind]-t[r.kind]||n.id.localeCompare(r.id)})}async function ye(e){let t=e.query.trim();if(!t)throw Error("Search query is required.");let n=Math.max(1,Math.min(e.limit??10,100)),r=zr(t),i=Gr(r),s=e.semantic===!0||e.fake===!0||Boolean(e.modelRef),d=[],l=null,a=null,o=null,c=0,u=0,_=0,f=new Map;w(e.dbPath);let m=S(e.dbPath);try{let k=Zr(m,i,Math.max(n*3,20));c=k.length,k.forEach((x,p)=>me(f,ni(x,Yr(x.rank,p))));let g=ei(m,r,Math.max(n,10)),b=ti(m,r,Math.max(n,10));u=g.length+b.length,g.forEach((x)=>me(f,ri(x,r))),b.forEach((x)=>me(f,ii(x,r)))}finally{m.close()}if(s)try{let k=await ce({dbPath:e.dbPath,query:t,limit:Math.max(n*3,20),config:e.config,env:e.env,modelRef:e.modelRef,dimensions:e.dimensions,fake:e.fake,batchSize:e.batchSize,maxParallelCalls:e.maxParallelCalls});l=k.provider,a=k.model,o=k.dimensions,_=k.results.length;for(let g of k.results){let b={kind:"source_chunk",id:g.chunk_id,title:null,text:g.text,score:0,scores:{semantic:Vr(g.score)},source:{uri:g.source_uri,ref:g.source_ref,kind:g.provenance?.source_kind??null,revision:g.revision,hash:g.hash},citation:{chunk_id:g.chunk_id,start_offset:g.provenance?.start_offset??null,end_offset:g.provenance?.end_offset??null},artifact:null,provenance:g.provenance,reasons:["semantic_match"]};b.score=Z(b.scores,b.citation),me(f,b)}}catch(k){d.push(`semantic_search_failed: ${k instanceof Error?k.message:String(k)}`)}let y=si(Array.from(f.values())).slice(0,n);return{query:t,limit:n,mode:{keyword:!0,catalog:!0,semantic:s},semantic_provider:l,semantic_model:a,semantic_dimensions:o,counts:{keyword_results:c,catalog_results:u,semantic_results:_,merged_results:y.length},warnings:d,results:y}}function Pt(e,t){return`${e}_${oi("sha256").update(t).digest("hex").slice(0,20)}`}function Ut(e){return e.normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase()}function ai(e){return Array.from(new Set(Ut(e).match(/[\p{L}\p{N}_]+/gu)??[])).slice(0,16)}function ci(e){return[e.title,e.text].filter(Boolean).join(" ").toLowerCase()}function ui(e,t){if(t.length===0)return 0;let n=ci(e),r=t.filter((i)=>n.includes(i)).length;return Number((r/t.length).toFixed(6))}function di(e){if(!e)return!0;if("read_only"in e)return e.read_only===!0;if("read_only_sources"in e)return e.read_only_sources===!0;return!0}function jt(e){if(!e)return!1;if("stale"in e&&e.stale)return!0;if("status"in e)return Ce(e.status);return!1}function li(e){if(jt(e.provenance))return 0;if(e.source?.hash||e.source?.revision)return 1;if(e.artifact?.hash)return 0.85;if(e.provenance&&"source_refs"in e.provenance&&e.provenance.source_refs.length>0)return 0.75;return 0.55}function _i(e){if(e.citation?.chunk_id&&(e.source?.uri||e.artifact?.uri))return 1;if(e.provenance&&"citation_required"in e.provenance&&e.provenance.citation_required)return 0.75;if(e.artifact?.uri)return 0.65;return 0.35}function fi(e){if(e.kind==="wiki_chunk")return 0.85;if(e.kind==="source_chunk")return 0.8;if(e.kind==="wiki_page")return 0.65;return 0.55}function gi(e,t){let n={base_score:e.score,exact_score:ui(e,t),citation_score:_i(e),freshness_score:li(e),authority_score:fi(e)},r=Math.min(1,n.base_score*0.65+n.exact_score*0.1+n.citation_score*0.1+n.freshness_score*0.1+n.authority_score*0.05),i=new Set(e.reasons);if(n.exact_score>0.5)i.add("exact_term");if(n.citation_score>=0.75)i.add("cited_source");if(n.freshness_score>=0.85)i.add("fresh_source");return{...e,score:Number(r.toFixed(6)),reasons:Array.from(i),rerank:{...n,final_score:Number(r.toFixed(6))}}}function Mt(e,t){let n=e.text??e.title;if(!n)return null;let r=n.replace(/\s+/g," ").trim();return r.length<=t?r:`${r.slice(0,Math.max(0,t-1)).trim()}...`}function pi(e){return{id:Pt("cite",`${e.kind}\x00${e.id}\x00${e.source?.uri??""}\x00${e.artifact?.uri??""}`),result_id:e.id,kind:e.kind,source_uri:e.source?.uri??null,source_ref:e.source?.ref??null,artifact_uri:e.artifact?.uri??null,artifact_path:e.artifact?.path??null,revision:e.source?.revision??null,hash:e.source?.hash??e.artifact?.hash??null,chunk_id:e.citation?.chunk_id??null,start_offset:e.citation?.start_offset??null,end_offset:e.citation?.end_offset??null,quote:Mt(e,500),provenance:e.provenance}}function hi(e,t,n){let r=Mt(e,n);if(!r)return null;return{id:Pt("excerpt",`${e.kind}\x00${e.id}`),result_id:e.id,citation_id:t.id,kind:e.kind,text:r,score:e.score}}function be(e){return e.map(()=>"?").join(", ")}function mi(e,t){let n=t.map((l)=>l.citation?.chunk_id).filter((l)=>Boolean(l)),r=t.filter((l)=>l.kind==="wiki_page").map((l)=>l.id),i=[],s=[];if(n.length===0&&r.length===0)return{citations:i,backlinks:s};let d=S(e);try{if(n.length>0)i.push(...d.query(`SELECT id, wiki_page_id, chunk_id, source_uri, quote, start_offset, end_offset
         FROM citations
         WHERE chunk_id IN (${be(n)})
         ORDER BY created_at DESC
         LIMIT 50`).all(...n));if(r.length>0)i.push(...d.query(`SELECT id, wiki_page_id, chunk_id, source_uri, quote, start_offset, end_offset
         FROM citations
         WHERE wiki_page_id IN (${be(r)})
         ORDER BY created_at DESC
         LIMIT 50`).all(...r)),s.push(...d.query(`SELECT from_page_id, to_page_id, label
         FROM wiki_backlinks
         WHERE from_page_id IN (${be(r)}) OR to_page_id IN (${be(r)})
         LIMIT 50`).all(...r,...r))}finally{d.close()}return{citations:i,backlinks:s}}async function Ft(e){let t=Math.max(200,Math.min(e.contextChars??1200,4000)),n=await ye(e),r=ai(n.query),i=[...n.warnings],s=new Set,d=new Set,a=n.results.filter((u)=>{if(!di(u.provenance))return i.push(`permission_filtered: ${u.kind}:${u.id}`),s.add("Dropped a result because provenance was not read-only."),!1;if(jt(u.provenance))return i.push(`stale_filtered: ${u.kind}:${u.id}`),d.add("Dropped a stale result whose source status requires reindexing."),!1;return!0}).map((u)=>gi(u,r)).sort((u,_)=>_.score-u.score||u.id.localeCompare(_.id)).slice(0,n.limit),o=a.map(pi),c=a.map((u,_)=>hi(u,o[_],t)).filter((u)=>Boolean(u));for(let u of a){if(u.provenance&&"read_only"in u.provenance&&u.provenance.read_only)s.add("All source-backed excerpts are read-only and citation-required.");if(u.rerank.freshness_score>=0.85)d.add("Fresh source revision/hash or artifact hash is present for top context.")}return{query:n.query,normalized_query:Ut(n.query),created_at:new Date().toISOString(),mode:n.mode,warnings:i,search_counts:n.counts,results:a,citations:o,excerpts:c,graph:mi(e.dbPath,a),notes:{permissions:Array.from(s),freshness:Array.from(d)}}}import{createHash as Ei,randomUUID as ki}from"crypto";var Kt=[{kind:"schema",prefix:"schemas/",description:"Machine-readable agent schemas and source rules."},{kind:"index",prefix:"indexes/",description:"Small orientation indexes and future shard manifests."},{kind:"log",prefix:"logs/",description:"Append-only JSONL run and wiki-maintenance log partitions."},{kind:"run",prefix:"runs/",description:"Prompt/tool/cost ledgers and generated output records."},{kind:"wiki_page",prefix:"wiki/",description:"Generated cited Markdown pages, not raw source files."},{kind:"export",prefix:"exports/",description:"Portable exports and snapshots of derived knowledge state."}];function Wt(e){let t=typeof e==="string"?Buffer.from(e):Buffer.from(e);return{hash:`sha256:${Ei("sha256").update(t).digest("hex")}`,size_bytes:t.byteLength}}function Xt(e){return Kt.find((n)=>e.startsWith(n.prefix))?.kind??"artifact"}function $t(e,t,n="global"){let r=Xe(e,t),i=e.storage.s3??null,s=i?.prefix?.replace(/^\/+|\/+$/g,"")??"",d=i?`s3://${i.bucket}/${s?`${s}/`:""}`:"";return{scope:n,mode:e.mode,storage_type:e.storage.type,workspace_home:t.home,local_layout:{app_path:Y,config_path:t.configPath,json_store_path:t.jsonStorePath,knowledge_db_path:t.knowledgeDbPath,directories:{artifacts:t.artifactsDir,cache:t.cacheDir,exports:t.exportsDir,indexes:t.indexesDir,logs:t.logsDir,runs:t.runsDir,schemas:t.schemasDir,wiki:t.wikiDir}},artifact_store:{type:e.storage.type,artifacts_root:e.storage.artifacts_root,uri_prefix:e.storage.type==="s3"?d:`file://${t.artifactsDir}/`,s3:i?{bucket:i.bucket,prefix:s,region:i.region??null,profile:i.profile??null,server_side_encryption:i.server_side_encryption??null,kms_key_configured:Boolean(i.kms_key_id)}:null},source_ownership:{owner:"open-files",preferred_ref:e.sources.preferred_ref,allowed_schemes:e.sources.allowed_schemes,raw_source_bytes_stored_in_open_knowledge:!1,stores:["source refs","source revisions and hashes","citation spans","redacted extracted chunks","embeddings","generated wiki artifacts","indexes","run ledgers"],does_not_store:["raw open-files bytes","S3 object credentials","connector secrets","hosted tenant ownership state"]},generated_artifacts:Kt,scalability:{catalog:"knowledge.db tracks sources, revisions, chunks, citations, indexes, runs, and storage_objects.",indexes:"Indexes are cataloged DB rows plus sharded artifacts, not one giant index.md.",logs:"Logs use dated JSONL partitions under logs/yyyy/mm/dd.jsonl.",markdown:"Markdown pages are the readable wiki layer over DB/object-store state."},warnings:r.warnings}}function Xe(e,t){let n=[],r=[];if(!t.home.endsWith(Y))r.push(`Workspace home does not end with ${Y}: ${t.home}`);if(e.storage.type==="s3"){if(!e.storage.s3?.bucket)n.push("storage.s3.bucket is required when storage.type is s3.");if(!e.storage.s3?.prefix)r.push("storage.s3.prefix is empty; generated knowledge artifacts will be written at the bucket root.");if(e.mode==="local")r.push("storage.type is s3 while mode is local; this is valid for BYO S3, but hosted wrappers should set mode to hosted.")}if(e.storage.type==="local"&&e.storage.s3)r.push("storage.s3 is configured but ignored while storage.type is local.");if(e.sources.preferred_ref!=="open-files")r.push("sources.preferred_ref should stay open-files for durable company knowledge.");if(!e.sources.allowed_schemes.includes("open-files"))n.push("sources.allowed_schemes must include open-files.");return{ok:n.length===0,errors:n,warnings:r}}function Ht(e,t,n=new Date){let r=n.toISOString(),i=e.prepare(`
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
  `);e.transaction((d)=>{for(let l of d)i.run(ki(),l.uri,l.kind,l.content_type??null,l.hash??null,l.size_bytes??null,JSON.stringify({key:l.key,...l.metadata??{}}),r,r)})(t)}import{createHash as yi}from"crypto";function bi(e){let t=String(e.getUTCFullYear()),n=String(e.getUTCMonth()+1).padStart(2,"0"),r=String(e.getUTCDate()).padStart(2,"0");return{year:t,month:n,day:r}}function $e(e,t){return`${e}_${yi("sha256").update(t).digest("hex").slice(0,20)}`}function vi(e){let t=e.trim().split(/\s+/).filter(Boolean).length;return Math.max(1,Math.ceil(t*1.25))}function Ti(){return`# Knowledge Agent Schema v1

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
`}function xi(){return`# Knowledge Index

This is a compact orientation index for agents. It is not the full search index.

## Shards

- wiki/
- indexes/
- schemas/
- logs/

## Source Ownership

Raw source files are resolved through open-files. This app stores source refs,
citations, chunks, generated wiki artifacts, indexes, and run records.
`}function qt(){return`# Wiki

Generated durable knowledge pages live here.

Pages should be concise, cited, and organized for both humans and agents.
`}async function Bt(e,t=new Date){let{year:n,month:r,day:i}=bi(t),s="schemas/v1.md",d="indexes/root.md",l="wiki/README.md",a=`logs/${n}/${r}/${i}.jsonl`,o={ts:t.toISOString(),event:"wiki_layout_initialized",schema_key:"schemas/v1.md",root_index_key:"indexes/root.md",wiki_readme_key:"wiki/README.md"},c=[{key:"schemas/v1.md",body:Ti(),content_type:"text/markdown"},{key:"indexes/root.md",body:xi(),content_type:"text/markdown"},{key:"wiki/README.md",body:qt(),content_type:"text/markdown"},{key:a,body:`${JSON.stringify(o)}
`,content_type:"application/x-ndjson"}],u=await Promise.all(c.map(async(_)=>{let f=await e.put(_);return{key:f.key,uri:f.uri,kind:Xt(_.key),content_type:_.content_type,metadata:{provenance:De({generated_from:"wiki_layout_init",artifact_key:_.key,citation_required:_.key.startsWith("wiki/")||_.key.startsWith("indexes/")})},...Wt(_.body)}}));return{schema_key:"schemas/v1.md",root_index_key:"indexes/root.md",wiki_readme_key:"wiki/README.md",log_key:a,artifacts:u,written:["schemas/v1.md","indexes/root.md","wiki/README.md",a]}}function He(e){let t=e.metadata?.provenance;if(t&&typeof t==="object"&&!Array.isArray(t))return t;return De({generated_from:"wiki_layout_init",artifact_key:e.key})}function Si(e,t,n,r,i,s){let d=He(r),l=$e("chk",`${t}\x00${r.hash??r.uri}`),a=e.query("SELECT id FROM chunks WHERE wiki_page_id = ?").all(t);for(let o of a)e.run("DELETE FROM chunks_fts WHERE chunk_id = ?",[o.id]);e.run("DELETE FROM chunks WHERE wiki_page_id = ?",[t]),e.run(`INSERT INTO chunks (id, wiki_page_id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,[l,t,"wiki",0,i,vi(i),0,i.length,JSON.stringify({artifact_key:r.key,artifact_uri:r.uri,content_hash:r.hash??null,provenance:d}),s]),e.run("INSERT INTO chunks_fts (chunk_id, text, title, source_uri) VALUES (?, ?, ?, ?)",[l,i,n,r.uri])}function zt(e,t,n=new Date){let r=n.toISOString(),i=t.find((d)=>d.key.endsWith("indexes/root.md")),s=t.find((d)=>d.key.endsWith("wiki/README.md"));if(i)e.run(`INSERT INTO knowledge_indexes (id, kind, name, artifact_uri, shard_key, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(kind, name, shard_key) DO UPDATE SET
         artifact_uri = excluded.artifact_uri,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,[$e("idx","root:indexes/root.md"),"root","root",i.uri,"root",JSON.stringify({artifact_key:i.key,content_hash:i.hash??null,provenance:He(i)}),r,r]);if(s){let d=$e("wiki","wiki/README.md");e.run(`INSERT INTO wiki_pages (id, path, title, artifact_uri, content_hash, status, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         title = excluded.title,
         artifact_uri = excluded.artifact_uri,
         content_hash = excluded.content_hash,
         status = excluded.status,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,[d,"wiki/README.md","Wiki",s.uri,s.hash??null,"active",JSON.stringify({artifact_key:s.key,provenance:He(s)}),r,r]),Si(e,d,"Wiki",s,qt(),r)}}class Gt{options;ensuredWorkspace;cachedConfig;constructor(e={}){this.options=e}get scope(){return this.options.scope??"global"}get workspace(){return this.ensuredWorkspace??ze(this.options.scope,this.options.cwd)}ensureWorkspace(){if(!this.ensuredWorkspace)this.ensuredWorkspace=Be(this.workspace.home);return this.ensuredWorkspace}jsonStorePath(){return this.ensureWorkspace().jsonStorePath}config(){if(!this.cachedConfig){let e=this.ensureWorkspace();this.cachedConfig=Ge(e.configPath)}return this.cachedConfig}safetyPolicy(){return bt(this.config(),this.ensureWorkspace())}artifactStore(){return nt(this.config(),this.ensureWorkspace())}storageContract(){return $t(this.config(),this.ensureWorkspace(),this.scope)}validateStorage(){return Xe(this.config(),this.ensureWorkspace())}paths(){let e=this.ensureWorkspace();return{ok:!0,scope:this.scope,home:e.home,config_path:e.configPath,json_store_path:e.jsonStorePath,knowledge_db_path:e.knowledgeDbPath,artifacts_dir:e.artifactsDir,indexes_dir:e.indexesDir,logs_dir:e.logsDir,runs_dir:e.runsDir,schemas_dir:e.schemasDir,wiki_dir:e.wikiDir,config:this.config(),message:e.home}}initDb(){return w(this.ensureWorkspace().knowledgeDbPath)}dbStats(){let e=this.ensureWorkspace();return w(e.knowledgeDbPath),Qe(e.knowledgeDbPath)}async initWiki(){let e=this.ensureWorkspace();w(e.knowledgeDbPath);let t=await Bt(this.artifactStore()),n=S(e.knowledgeDbPath);try{Ht(n,t.artifacts),zt(n,t.artifacts)}finally{n.close()}return t}async ingestManifest(e){let t=this.ensureWorkspace();return wt({dbPath:t.knowledgeDbPath,input:e,config:this.config(),safetyPolicy:this.safetyPolicy()})}async ingestSource(e,t){let n=this.ensureWorkspace();return Nt({dbPath:n.knowledgeDbPath,sourceRef:e,purpose:t,config:this.config(),safetyPolicy:this.safetyPolicy()})}async resolveSource(e,t={}){let n=this.ensureWorkspace();return ge({dbPath:n.knowledgeDbPath,sourceRef:e,purpose:t.purpose,limit:t.limit,safetyPolicy:this.safetyPolicy()})}async consumeOutbox(e){let t=this.ensureWorkspace();return St({dbPath:t.knowledgeDbPath,input:e,config:this.config(),safetyPolicy:this.safetyPolicy()})}providerStatus(e=process.env){return at(this.config(),e)}modelRegistry(){return Le(this.config())}embeddingStatus(){let e=this.ensureWorkspace();return pt(e.knowledgeDbPath)}async indexEmbeddings(e={}){let t=this.ensureWorkspace();return gt({...e,dbPath:t.knowledgeDbPath,config:this.config()})}async semanticSearch(e){let t=this.ensureWorkspace();return ce({...e,dbPath:t.knowledgeDbPath,config:this.config()})}async search(e){let t=this.ensureWorkspace();return ye({...e,dbPath:t.knowledgeDbPath,config:this.config()})}async retrieveContext(e){let t=this.ensureWorkspace();return Ft({...e,dbPath:t.knowledgeDbPath,config:this.config()})}}function Jt(e={}){return new Gt(e)}var ee={name:"@hasna/knowledge",version:"0.2.16",description:"Agent-friendly local knowledge CLI with JSON output, pagination, and safe destructive actions",type:"module",bin:{"open-knowledge":"bin/open-knowledge.js","open-knowledge-mcp":"bin/open-knowledge-mcp.js"},files:["bin","src","docs","LICENSE","README.md"],scripts:{test:"bun test","test:cli":"bun test tests/cli.test.ts",build:"bun build --target=bun --outfile=bin/open-knowledge.js --minify --external @aws-sdk/client-s3 --external @aws-sdk/credential-providers --external ai --external @ai-sdk/openai --external @ai-sdk/anthropic --external @ai-sdk/deepseek src/cli.ts && bun build --target=bun --outfile=bin/open-knowledge-mcp.js --external @modelcontextprotocol/sdk --external @aws-sdk/client-s3 --external @aws-sdk/credential-providers --external ai --external @ai-sdk/openai --external @ai-sdk/anthropic --external @ai-sdk/deepseek src/mcp.js",prepublishOnly:"bun run build",postinstall:"bun run build"},keywords:["knowledge","cli","agents","json","notes","local","store"],license:"Apache-2.0",publishConfig:{registry:"https://registry.npmjs.org",access:"public"},repository:{type:"git",url:"git+https://github.com/hasna/knowledge.git"},bugs:{url:"https://github.com/hasna/knowledge/issues"},author:"Hasna Inc. <hasna@example.com>",engines:{bun:">=1.0",node:">=18"},dependencies:{"@aws-sdk/client-s3":"^3.1063.0","@aws-sdk/credential-providers":"^3.1063.0","@ai-sdk/anthropic":"^3.0.81","@ai-sdk/deepseek":"^2.0.35","@ai-sdk/openai":"^3.0.68","@modelcontextprotocol/sdk":"^1.29.0",ai:"^6.0.197",zod:"^4.3.6"},devDependencies:{"@types/bun":"^1.3.14"}};var Yt={debug:0,info:1,warn:2,error:3},Ri=()=>{if(process.env.DEBUG)return"debug";if(process.env.LOG_LEVEL==="debug")return"debug";if(process.env.LOG_LEVEL==="warn")return"warn";if(process.env.LOG_LEVEL==="error")return"error";return"info"};function H(e,t,n){if(Yt[e]<Yt[Ri()])return;let r={debug:"[DEBUG]",info:"[INFO]",warn:"[WARN]",error:"[ERROR]"}[e],i=n?`${r} ${t} ${JSON.stringify(n)}`:`${r} ${t}`;if(e==="error")console.error(i);else console.error(i)}var Oi=["add","list","get","delete","update","archive","restore","upsert","untag","export","prune","dedupe","stats","paths","storage","db","wiki","source","ingest","reindex","search","embeddings","providers","safety","help"],Vt={ls:"list",rm:"delete",edit:"update",unarchive:"restore"};function Ni(e){let t=[],n={};for(let r=0;r<e.length;r+=1){let i=e[r];if(!i.startsWith("-")){t.push(i);continue}switch(i){case"--json":n.json=!0;break;case"--yes":case"-y":n.yes=!0;break;case"--help":case"-h":n.help=!0;break;case"--version":case"-v":n.version=!0;break;case"--desc":n.desc=!0;break;case"--page":case"-p":n.page=Number(e[r+1]),r+=1;break;case"--limit":case"-l":n.limit=Number(e[r+1]),r+=1;break;case"--search":case"-s":n.search=e[r+1],r+=1;break;case"--sort":n.sort=e[r+1],r+=1;break;case"--id":n.id=e[r+1],r+=1;break;case"--store":n.store=e[r+1],r+=1;break;case"--title":n.title=e[r+1],r+=1;break;case"--content":n.content=e[r+1],r+=1;break;case"--url":n.url=e[r+1],r+=1;break;case"--tag":case"-t":n.tag=e[r+1],r+=1;break;case"--format":n.format=e[r+1],r+=1;break;case"--completions":n.completions=e[r+1],r+=1;break;case"--purpose":n.purpose=e[r+1],r+=1;break;case"--model":n.model=e[r+1],r+=1;break;case"--dimensions":n.dimensions=Number(e[r+1]),r+=1;break;case"--semantic":n.semantic=!0;break;case"--context":n.context=!0;break;case"--fake":n.fake=!0;break;case"--no-color":n.noColor=!0;break;case"--scope":n.scope=e[r+1],r+=1;break;case"--older-than":n.olderThan=Number(e[r+1]),r+=1;break;case"--empty":n.empty=!0;break;case"--archived":n.archived=!0;break;case"--include-archived":n.includeArchived=!0;break;default:throw Error(`Unknown flag: ${i}. Run 'open-knowledge --help' for valid options.`)}}return{positional:t,flags:n}}function Ai(e){if(!e)return"";return Vt[e]??e}function Ii(e,t){let n=Array.from({length:e.length+1},()=>Array(t.length+1).fill(0));for(let r=0;r<=e.length;r+=1)n[r][0]=r;for(let r=0;r<=t.length;r+=1)n[0][r]=r;for(let r=1;r<=e.length;r+=1)for(let i=1;i<=t.length;i+=1){let s=e[r-1]===t[i-1]?0:1;n[r][i]=Math.min(n[r-1][i]+1,n[r][i-1]+1,n[r-1][i-1]+s)}return n[e.length][t.length]}function Li(e){if(!e)return"";let t=[...Oi,...Object.keys(Vt)],n="",r=Number.POSITIVE_INFINITY;for(let i of t){let s=Ii(e,i);if(s<r)r=s,n=i}return r<=3?n:""}function Ci(){console.log(`open-knowledge - local agent knowledge store

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
  search <query>               Hybrid search sources, wiki pages, indexes, or context
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
  --semantic                   Include vector semantic results in search
  --context                    Return a reranked citation context pack for search
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
  --empty                     Remove items with empty content`)}function Di(e){if(e==="add"){console.log("Usage: open-knowledge add <title> <content> [--url <url>] [-t <tag>] [--json]");return}if(e==="list"||e==="ls"){console.log("Usage: open-knowledge list|ls [--format table|json] [-p <page>] [-l <limit>] [-s <search>] [-t <tag>] [--sort created|title] [--desc] [--json]");return}if(e==="get"){console.log("Usage: open-knowledge get --id <id> [--json]");return}if(e==="update"||e==="edit"){console.log("Usage: open-knowledge update|edit --id <id> [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]");return}if(e==="archive"){console.log("Usage: open-knowledge archive --id <id> [--json]");return}if(e==="restore"||e==="unarchive"){console.log("Usage: open-knowledge restore|unarchive --id <id> [--json]");return}if(e==="upsert"){console.log("Usage: open-knowledge upsert [title] [content] [--id <id>] [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]");return}if(e==="untag"){console.log("Usage: open-knowledge untag --id <id> -t <tag> [--json]");return}if(e==="delete"||e==="rm"){console.log("Usage: open-knowledge delete|rm --id <id> -y [--json]");return}if(e==="export"){console.log("Usage: open-knowledge export [--format jsonl] [--json]");return}if(e==="prune"){console.log("Usage: open-knowledge prune --yes [--older-than <days>] [--empty] [--json]");return}if(e==="dedupe"){console.log("Usage: open-knowledge dedupe --yes [--json]");return}if(e==="stats"){console.log("Usage: open-knowledge stats [--json]");return}if(e==="paths"){console.log("Usage: open-knowledge paths [--scope local|global|project] [--json]");return}if(e==="storage"){console.log("Usage: open-knowledge storage status|validate [--scope local|global|project] [--json]");return}if(e==="db"){console.log("Usage: open-knowledge db init|stats [--scope local|global|project] [--json]");return}if(e==="wiki"){console.log("Usage: open-knowledge wiki init [--scope local|global|project] [--json]");return}if(e==="source"){console.log("Usage: open-knowledge source resolve <source-ref> [--purpose knowledge_answer|knowledge_index] [--limit <n>] [--scope local|global|project] [--json]");return}if(e==="ingest"){console.log("Usage: open-knowledge ingest manifest <file|s3://bucket/key> | source <source-ref> [--purpose knowledge_index] [--scope local|global|project] [--json]");return}if(e==="reindex"){console.log("Usage: open-knowledge reindex outbox <file|s3://bucket/key> [--scope local|global|project] [--json]");return}if(e==="search"){console.log("Usage: open-knowledge search <query> [--context] [--semantic] [--model openai:text-embedding-3-small] [--limit <n>] [--dimensions <n>] [--fake] [--scope local|global|project] [--json]");return}if(e==="embeddings"){console.log("Usage: open-knowledge embeddings status|index|search [query] [--model openai:text-embedding-3-small] [--limit <n>] [--dimensions <n>] [--fake] [--scope local|global|project] [--json]");return}if(e==="providers"){console.log("Usage: open-knowledge providers status|models|check [provider|model-alias] [--scope local|global|project] [--json]");return}if(e==="safety"){console.log("Usage: open-knowledge safety status|check|approve|audit|redact [args] [--scope local|global|project] [--json]");return}Ci()}function Pi(e){if(e.noColor||process.env.NO_COLOR)return!1;if(process.env.FORCE_COLOR)return!0;return process.stdout.isTTY===!0}function E(e,t,n){if(t){console.log(JSON.stringify(e,null,2));return}if(typeof e==="string"){console.log(e);return}console.log(e.message??JSON.stringify(e,null,2))}function te(e){if(!e.id)throw Error("Missing required --id. Example: open-knowledge get --id <id>")}function Ui(e,t){let n=t.sort??"created";if(n!=="created"&&n!=="title")throw Error("Invalid --sort value. Use 'created' or 'title'.");let r=[...e].sort((i,s)=>{if(n==="title")return i.title.localeCompare(s.title);return i.created_at.localeCompare(s.created_at)});if(t.desc)r.reverse();return{sorted:r,sort:n,direction:t.desc?"desc":"asc"}}async function ji(e){let{positional:t,flags:n}=Ni(e);if(H("debug","CLI invoked",{command:t[0],flags:{json:n.json,store:n.store}}),n.version){console.log(n.json?JSON.stringify({name:ee.name,version:ee.version},null,2):`${ee.name} ${ee.version}`);return}if(n.completions){let a=n.completions;if(a==="bash")console.log('_open_knowledge() { local cur; cur="${COMP_WORDS[COMP_CWORD]}"; COMPREPLY=($(compgen -W "add list get update archive restore upsert untag delete export prune dedupe stats paths storage db wiki source ingest reindex search embeddings providers safety help ls rm edit unarchive --json --yes --help --version --desc --page --limit --search --sort --id --store --title --content --url --tag --format --completions --purpose --model --dimensions --semantic --context --fake --no-color --scope --archived --include-archived" -- "$cur")); }; complete -F _open_knowledge open-knowledge');else if(a==="zsh")console.log(`#compdef open-knowledge
_open_knowledge() { _arguments -C "1: :(add list get update archive restore upsert untag delete export prune dedupe stats paths storage db wiki source ingest reindex search embeddings providers safety help ls rm edit unarchive)" "(--json)--json" "(--yes)-y" "(--help)--help" "(--version)--version" "(--desc)--desc" "(--archived)--archived" "(--include-archived)--include-archived" "(--semantic)--semantic" "(--context)--context" "(--fake)--fake" "(-p --page)"{-p,--page}"[page number]:number:" "(-l --limit)"{-l,--limit}"[items per page]:number:" "(-s --search)"{-s,--search}"[search text]:text:" "(--sort)--sort"{created,title}:" "(--id)--id[item id]:id:" "(--store)--store[store path]:path:" "(--title)--title[new title]:" "(--content)--content[new content]:" "(--url)--url[source url]:" "(-t --tag)"{-t,--tag}"[tag]:tag:" "(--format)--format[json|jsonl]:" "(--completions)--completions[output completions]:shell:(bash zsh fish):" "(--purpose)--purpose[purpose]:" "(--model)--model[model ref]:" "(--dimensions)--dimensions[embedding dimensions]:number:" "(--no-color)--no-color[disable color]" "(--scope)--scope"{local,global,project}:" }; _open_knowledge`);else if(a==="fish")console.log('complete -c open-knowledge -f; complete -c open-knowledge -a "add list get update archive restore upsert untag delete export prune dedupe stats paths storage db wiki source ingest reindex search embeddings providers safety help ls rm edit unarchive"; complete -c open-knowledge -l json; complete -c open-knowledge -l yes -s y; complete -c open-knowledge -l help -s h; complete -c open-knowledge -l version -s v; complete -c open-knowledge -l desc; complete -c open-knowledge -l archived; complete -c open-knowledge -l include-archived; complete -c open-knowledge -l semantic; complete -c open-knowledge -l context; complete -c open-knowledge -l fake; complete -c open-knowledge -s p -l page; complete -c open-knowledge -s l -l limit; complete -c open-knowledge -s s -l search; complete -c open-knowledge -l sort; complete -c open-knowledge -l id; complete -c open-knowledge -l store; complete -c open-knowledge -l title; complete -c open-knowledge -l content; complete -c open-knowledge -l url; complete -c open-knowledge -s t -l tag; complete -c open-knowledge -l format; complete -c open-knowledge -l completions; complete -c open-knowledge -l purpose; complete -c open-knowledge -l model; complete -c open-knowledge -l dimensions; complete -c open-knowledge -l no-color; complete -c open-knowledge -l scope -a "local global project"');else throw Error("Invalid --completions value. Use 'bash', 'zsh', or 'fish'.");return}let r=Ai(t[0]);if(!r||n.help||r==="help"){Di(t[1]);return}let i=Jt({scope:n.scope}),s=n.store;if(!s)if(n.scope==="project"||n.scope==="local")s=i.jsonStorePath();else s=Se();if(r==="paths"){E(i.paths(),n.json);return}if(r==="storage"){let a=t[1]??"status";if(a==="status"){let o=i.storageContract(),c=i.validateStorage();E({ok:c.ok,...o,validation:c,message:`${o.storage_type} artifact storage at ${o.artifact_store.uri_prefix}`},n.json);return}if(a==="validate"){let o=i.validateStorage();E({ok:o.ok,validation:o,message:o.ok?"Storage contract valid":`Storage contract invalid: ${o.errors.join("; ")}`},n.json);return}throw Error("Invalid storage action. Use 'status' or 'validate'.")}if(r==="db"){let a=t[1]??"init";if(a!=="init"&&a!=="stats")throw Error("Invalid db action. Use 'init' or 'stats'.");if(a==="init"){let c=i.initDb();E({ok:!0,...c,message:`Initialized ${c.path}`},n.json);return}let o=i.dbStats();E({ok:!0,path:i.workspace.knowledgeDbPath,...o,message:`knowledge.db schema v${o.schema_version}`},n.json);return}if(r==="wiki"){if((t[1]??"init")!=="init")throw Error("Invalid wiki action. Use 'init'.");let o=await i.initWiki();E({ok:!0,...o,message:`Initialized wiki layout in ${i.workspace.home}`},n.json);return}if(r==="safety"){let a=t[1]??"status",o=i.ensureWorkspace(),c=i.safetyPolicy();i.initDb();let u=S(o.knowledgeDbPath);try{if(a==="status"){E({ok:!0,mode:c.mode,workspace:o.home,allow_write_roots:c.allowWriteRoots,read_only_source_access:c.readOnlySourceAccess,network:c.network,redaction:c.redaction,approvals:c.approvals,message:`Safety policy: ${c.mode}`},n.json);return}if(a==="check"){let _=t[2]??"generated_write",f=t[3]??null,m;try{if(_==="web_search")ue(c),m={action:_,target_uri:f,approval_required:!1,approved:!0,decision:"allow"};else if(_==="s3_read"){if(!f)throw Error("safety check s3_read requires an s3:// target.");K(f,c),m={action:_,target_uri:f,approval_required:!1,approved:!0,decision:"allow"}}else m=Tt(u,c,_,f);R(u,{event_type:"safety_check",action:_,target_uri:f,decision:m.decision==="allow"?"allow":"requires_approval",metadata:m}),E({ok:!0,...m,message:`Safety check ${m.decision}`},n.json);return}catch(y){throw R(u,{event_type:"safety_check",action:_,target_uri:f,decision:"deny",metadata:{error:y instanceof Error?y.message:String(y)}}),y}}if(a==="approve"){let _=t[2]??"generated_write",f=t[3]??null,m=vt(u,{action:_,target_uri:f,reason:"local-cli approval",metadata:{scope:n.scope??"global"}});R(u,{event_type:"approval",action:_,target_uri:f,decision:"allow",metadata:{approval_id:m.id}}),E({ok:!0,...m,action:_,target_uri:f,message:`Approved ${_}`},n.json);return}if(a==="audit"){let _=u.query("SELECT id, event_type, action, target_uri, decision, metadata_json, created_at FROM audit_events ORDER BY created_at DESC LIMIT 50").all().map((f)=>({id:f.id,event_type:f.event_type,action:f.action,target_uri:f.target_uri,decision:f.decision,metadata:JSON.parse(f.metadata_json),created_at:f.created_at}));E({ok:!0,events:_,message:`${_.length} audit event(s)`},n.json);return}if(a==="redact"){let _=t.slice(2).join(" ");if(!_)throw Error("Usage: open-knowledge safety redact <text>");let f=de(_,c);if(f.findings.length>0)le(u,{source_uri:"safety://redact",findings:f.findings,metadata:{command:"safety redact"}});R(u,{event_type:"redaction",action:"safety_redact",target_uri:"safety://redact",decision:f.findings.length>0?"redacted":"allow",metadata:{findings:f.findings.length}}),E({ok:!0,text:f.text,findings:f.findings,message:`Redacted ${f.findings.length} finding(s)`},n.json);return}throw Error("Invalid safety action. Use 'status', 'check', 'approve', 'audit', or 'redact'.")}finally{u.close()}}if(r==="source"){if((t[1]??"")!=="resolve")throw Error("Invalid source action. Use 'resolve'.");let o=t[2];if(!o)throw Error("Usage: open-knowledge source resolve <source-ref>");let c=await i.resolveSource(o,{purpose:n.purpose,limit:n.limit});E({ok:!0,...c,message:c.resolved?`Resolved ${c.source_ref} (${c.content.chunks_returned}/${c.content.chunks_total} chunks)`:`Source not indexed: ${o}`},n.json);return}if(r==="ingest"){let a=t[1]??"";if(a==="manifest"){let o=t[2];if(!o)throw Error("Usage: open-knowledge ingest manifest <file|s3://bucket/key>");let c=await i.ingestManifest(o);E({ok:!0,...c,message:`Ingested ${c.items_seen} manifest item(s)`},n.json);return}if(a==="source"){let o=t[2];if(!o)throw Error("Usage: open-knowledge ingest source <source-ref>");let c=await i.ingestSource(o,n.purpose);E({ok:!0,...c,message:`Ingested source ${c.source_ref} (${c.chunks_inserted} chunks)`},n.json);return}throw Error("Invalid ingest action. Use 'manifest' or 'source'.")}if(r==="reindex"){if((t[1]??"")!=="outbox")throw Error("Invalid reindex action. Use 'outbox'.");let o=t[2];if(!o)throw Error("Usage: open-knowledge reindex outbox <file|s3://bucket/key>");let c=await i.consumeOutbox(o);E({ok:!0,...c,message:`Consumed ${c.events_seen} outbox event(s)`},n.json);return}if(r==="embeddings"){let a=t[1]??"status";if(a==="status"){let o=i.embeddingStatus();E({ok:!0,...o,message:`${o.total_vector_entries} vector index entries`},n.json);return}if(a==="index"){let o=await i.indexEmbeddings({limit:n.limit,modelRef:n.model,dimensions:n.dimensions,fake:n.fake});E({ok:!0,...o,message:`Embedded ${o.chunks_embedded} chunk(s)`},n.json);return}if(a==="search"){let o=t.slice(2).join(" ");if(!o)throw Error("Usage: open-knowledge embeddings search <query>");let c=await i.semanticSearch({query:o,limit:n.limit,modelRef:n.model,dimensions:n.dimensions,fake:n.fake});E({ok:!0,...c,message:`${c.results.length} semantic result(s)`},n.json);return}throw Error("Invalid embeddings action. Use 'status', 'index', or 'search'.")}if(r==="search"){let a=t.slice(1).join(" ");if(!a)throw Error("Usage: open-knowledge search <query>");if(n.context){let c=await i.retrieveContext({query:a,limit:n.limit,semantic:n.semantic,modelRef:n.model,dimensions:n.dimensions,fake:n.fake});E({ok:!0,...c,message:`${c.excerpts.length} context excerpt(s)`},n.json);return}let o=await i.search({query:a,limit:n.limit,semantic:n.semantic,modelRef:n.model,dimensions:n.dimensions,fake:n.fake});E({ok:!0,...o,message:`${o.results.length} search result(s)`},n.json);return}if(r==="providers"){let a=t[1]??"status";if(a==="status"){let o=i.providerStatus(),c=o.providers.filter((u)=>u.configured).length;E({ok:!0,...o,message:`${c}/${o.providers.length} provider credential(s) configured`},n.json);return}if(a==="models"){let o=i.modelRegistry();E({ok:!0,models:o,message:`${o.length} model alias(es)`},n.json);return}if(a==="check"){let o=t[2]??"default",c=Ie(o,i.config()),u=W(c),_=oe(u.provider,i.config());E({ok:!0,target:o,model_ref:c,provider:u.provider,model:u.model,credential:_,message:`${u.provider} credentials configured`},n.json);return}throw Error("Invalid providers action. Use 'status', 'models', or 'check'.")}if(we(s),r==="add"){let a=t[1],o=t[2];if(!a||!o)throw Error("Usage: open-knowledge add <title> <content>");C(s,()=>{let c=L(s),u={id:Re(),title:a,content:o,url:n.url??null,tags:n.tag?[n.tag]:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()};c.items.push(u),j(s,c),H("info","Item added",{id:u.id,title:u.title}),E({ok:!0,item:u,message:`Added ${u.id}`},n.json)});return}if(r==="list"){if(n.format!==void 0&&n.format!=="table"&&n.format!=="json")throw Error("Invalid --format value for list. Use 'table' or 'json'.");C(s,()=>{let a=L(s),o=Number.isFinite(n.page)&&n.page>0?n.page:1,c=Number.isFinite(n.limit)&&n.limit>0?n.limit:20,u=n.search?String(n.search).toLowerCase():"",_=n.tag?String(n.tag).toLowerCase():"",f=n.format==="table"||!n.json&&!n.format&&Pi(n),m=n.json||n.format==="json",y=a.items;if(n.archived)y=y.filter((h)=>h.archived===!0);else if(!n.includeArchived)y=y.filter((h)=>!h.archived);if(u)y=y.filter((h)=>h.title.toLowerCase().includes(u)||h.content.toLowerCase().includes(u));if(_)y=y.filter((h)=>h.tags&&h.tags.map((G)=>G.toLowerCase()).includes(_));let{sorted:k,sort:g,direction:b}=Ui(y,n),x=(o-1)*c,p=k.slice(x,x+c),A=Math.max(1,Math.ceil(k.length/c));if(m){E({ok:!0,page:o,limit:c,total:k.length,total_pages:A,sort:g,direction:b,items:p},!0);return}if(p.length===0){E(`No items found (search=${u||"none"}, tag=${_||"none"})`,!1);return}if(f){let h=(M)=>M,G=`${h("ID")}	${h("TITLE")}	${h("CREATED")}	${h("URL")}	${h("TAGS")}`;console.log(G);for(let M of p)console.log(`${M.id}	${h(M.title)}	${M.created_at}	${M.url?h(M.url):""}	${M.tags?.length?h(`[${M.tags.join(", ")}]`):""}`);console.log(`Page ${o}/${A} | showing ${p.length} of ${k.length} | sort=${g} ${b} | search=${u||"none"} | tag=${_||"none"}`)}else{for(let h of p)console.log(`${h.id}	${h.title}	${h.created_at}${h.url?`	${h.url}`:""}${h.tags?.length?`	[${h.tags.join(", ")}]`:""}`);console.log(`Page ${o}/${A} | showing ${p.length} of ${k.length} | sort=${g} ${b} | search=${u||"none"} | tag=${_||"none"}`)}});return}if(r==="get"){te(n),C(s,()=>{let o=L(s).items.find((c)=>c.id===n.id||c.short_id===n.id);if(!o)throw Error(`Item not found: ${n.id}`);E({ok:!0,item:o,message:`${o.id}: ${o.title}`},n.json)});return}if(r==="update"){te(n),C(s,()=>{let a=L(s),o=a.items.findIndex((u)=>u.id===n.id||u.short_id===n.id);if(o===-1)throw Error(`Item not found: ${n.id}`);let c=a.items[o];if(n.title!==void 0)c.title=n.title;if(n.content!==void 0)c.content=n.content;if(n.url!==void 0)c.url=n.url;if(n.tag!==void 0){if(c.tags=c.tags||[],!c.tags.map((u)=>u.toLowerCase()).includes(n.tag.toLowerCase()))c.tags.push(n.tag)}c.updated_at=new Date().toISOString(),a.items[o]=c,j(s,a),E({ok:!0,item:c,message:`Updated ${c.id}`},n.json)});return}if(r==="archive"||r==="restore"){te(n),C(s,()=>{let a=L(s),o=a.items.findIndex((u)=>u.id===n.id||u.short_id===n.id);if(o===-1)throw Error(`Item not found: ${n.id}`);let c=a.items[o];c.archived=r==="archive",c.updated_at=new Date().toISOString(),a.items[o]=c,j(s,a),E({ok:!0,item:c,message:`${r==="archive"?"Archived":"Restored"} ${c.id}`},n.json)});return}if(r==="untag"){if(te(n),!n.tag)throw Error("Missing required --tag. Example: open-knowledge untag --id <id> -t <tag>");C(s,()=>{let a=L(s),o=a.items.findIndex((_)=>_.id===n.id||_.short_id===n.id);if(o===-1)throw Error(`Item not found: ${n.id}`);let c=a.items[o],u=c.tags?.length??0;c.tags=(c.tags??[]).filter((_)=>_.toLowerCase()!==n.tag.toLowerCase()),c.updated_at=new Date().toISOString(),a.items[o]=c,j(s,a),E({ok:!0,item:c,removed:u-c.tags.length,message:`Removed tag from ${c.id}`},n.json)});return}if(r==="upsert"){let a=n.title??t[1],o=n.content??t[2];C(s,()=>{let c=L(s),u=n.id?c.items.findIndex((m)=>m.id===n.id||m.short_id===n.id):-1,_=new Date().toISOString();if(u===-1){if(!a||!o)throw Error("New item requires title and content. Example: open-knowledge upsert <title> <content> [--id <id>]");let m=n.id??Re(),y={id:m,short_id:Ve(m),title:a,content:o,url:n.url??null,tags:n.tag?[n.tag]:[],metadata:{},archived:!1,created_at:_,updated_at:_};c.items.push(y),j(s,c),E({ok:!0,created:!0,item:y,message:`Upserted ${y.id}`},n.json);return}let f=c.items[u];if(a!==void 0)f.title=a;if(o!==void 0)f.content=o;if(n.url!==void 0)f.url=n.url;if(n.tag!==void 0){if(f.tags=f.tags||[],!f.tags.map((m)=>m.toLowerCase()).includes(n.tag.toLowerCase()))f.tags.push(n.tag)}f.updated_at=_,c.items[u]=f,j(s,c),E({ok:!0,created:!1,item:f,message:`Upserted ${f.id}`},n.json)});return}if(r==="delete"){if(te(n),!n.yes)throw Error("Refusing delete without --yes. Re-run with: open-knowledge delete --id <id> --yes");C(s,()=>{let a=L(s),o=a.items.length;a.items=a.items.filter((u)=>u.id!==n.id&&u.short_id!==n.id);let c=o!==a.items.length;if(j(s,a),!c)throw Error(`Item not found: ${n.id}`);H("info","Item deleted",{id:n.id}),E({ok:!0,deleted_id:n.id,message:`Deleted ${n.id}`},n.json)});return}if(r==="export"){let a=n.format??"json";if(a!=="json"&&a!=="jsonl")throw Error("Invalid --format. Use 'json' or 'jsonl'.");C(s,()=>{let o=L(s);if(a==="jsonl")for(let c of o.items)console.log(JSON.stringify(c));else E({ok:!0,items:o.items},n.json)});return}if(r==="prune"){if(!n.yes)throw Error("Refusing prune without --yes. Re-run with: open-knowledge prune --yes [--older-than <days>] [--empty]");C(s,()=>{let a=L(s),o=a.items.length;if(n.olderThan!==void 0){let u=new Date;u.setDate(u.getDate()-n.olderThan),a.items=a.items.filter((_)=>new Date(_.created_at)>=u)}if(n.empty)a.items=a.items.filter((u)=>u.content.trim().length>0);let c=o-a.items.length;j(s,a),H("info","Prune completed",{pruned:c,remaining:a.items.length}),E({ok:!0,pruned:c,remaining:a.items.length,message:`Pruned ${c} item(s)`},n.json)});return}if(r==="dedupe"){if(!n.yes)throw Error("Refusing dedupe without --yes. Re-run with: open-knowledge dedupe --yes [--json]");C(s,()=>{let a=L(s),o=new Set,c=a.items.length;a.items=a.items.filter((_)=>{let f=`${_.title}\x00${_.content}`;if(o.has(f))return!1;return o.add(f),!0});let u=c-a.items.length;j(s,a),H("info","Dedupe completed",{removed:u,remaining:a.items.length}),E({ok:!0,removed:u,remaining:a.items.length,message:`Dedupe removed ${u} duplicate(s)`},n.json)});return}if(r==="stats"){C(s,()=>{let a=L(s),o=a.items.filter((b)=>!b.archived),c=o.length,u=a.items.length-c,_=o.filter((b)=>b.url).length,f=o.filter((b)=>b.tags&&b.tags.length>0).length,m=c>0?o.map((b)=>b.created_at).sort()[0]:null,y=c>0?o.map((b)=>b.created_at).sort()[c-1]:null,k={};for(let b of o)for(let x of b.tags||[])k[x]=(k[x]||0)+1;let g=Object.entries(k).sort((b,x)=>x[1]-b[1]).slice(0,5).map(([b,x])=>({tag:b,count:x}));E({ok:!0,total:c,archived:u,with_url:_,with_tags:f,oldest:m,newest:y,top_tags:g,message:`${c} items | ${_} with URL | ${f} with tags`},n.json)});return}let d=Li(t[0]),l=d?` Did you mean '${d}'?`:"";throw H("warn","Unknown command",{input:t[0],suggestion:d}),Error(`Unknown command: ${t[0]}.${l} Run 'open-knowledge --help' for available commands.`)}if(import.meta.main)ji(process.argv.slice(2)).catch((e)=>{let t=e instanceof Error?e.message:String(e);H("error","CLI error",{message:t,stack:e instanceof Error?e.stack:void 0}),console.error(`Error: ${t}`),process.exitCode=1});export{Li as suggestCommand,Ui as sortItems,ji as run,Ni as parseArgs};
