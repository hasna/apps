#!/usr/bin/env bun
// @bun
var I=import.meta.require;import{readFileSync as Y,writeFileSync as B,existsSync as $,renameSync as Ae,unlinkSync as se}from"fs";import{randomUUID as oe}from"crypto";import{existsSync as ye,mkdirSync as J,readFileSync as Re,writeFileSync as Oe}from"fs";import{homedir as re}from"os";import{dirname as ke,join as R,resolve as le}from"path";var we=R(".hasna","apps","knowledge");function H(){return R(re(),".open-knowledge","db.json")}function Q(){return R(re(),".hasna","apps","knowledge")}function Ue(e=process.cwd()){return le(e,we)}function D(e){return{home:e,configPath:R(e,"config.json"),jsonStorePath:R(e,"db.json"),knowledgeDbPath:R(e,"knowledge.db"),artifactsDir:R(e,"artifacts"),cacheDir:R(e,"cache"),exportsDir:R(e,"exports"),indexesDir:R(e,"indexes"),logsDir:R(e,"logs"),runsDir:R(e,"runs"),schemasDir:R(e,"schemas"),wikiDir:R(e,"wiki")}}function Se(){return{version:1,mode:"local",storage:{type:"local",artifacts_root:"artifacts"},sources:{preferred_ref:"open-files",allowed_schemes:["open-files","s3","file","https","http"]}}}function b(e){let t=D(e);J(t.home,{recursive:!0});for(let n of[t.artifactsDir,t.cacheDir,t.exportsDir,t.indexesDir,t.logsDir,t.runsDir,t.schemasDir,t.wikiDir])J(n,{recursive:!0});if(!ye(t.configPath))Oe(t.configPath,`${JSON.stringify(Se(),null,2)}
`);return t}function ie(e,t=process.cwd()){if(e==="project"||e==="local")return D(Ue(t));return D(Q())}function K(e){J(ke(e),{recursive:!0})}function v(e){let t=Re(e,"utf8");return JSON.parse(t)}function V(){return D(Q()).jsonStorePath}function q(e){if(!$(e))if(K(e),e===V()&&$(H()))B(e,Y(H(),"utf8"));else B(e,JSON.stringify({items:[]},null,2))}function Ie(e){return`${e}.lock`}function xe(e,t){let c=Date.now();while(Date.now()-c<5000){try{if(!$(e)){B(e,JSON.stringify({owner:t,ts:Date.now()}));return}let d=JSON.parse(Y(e,"utf8"));if(Date.now()-d.ts>1e4)se(e)}catch{}let s=Date.now();while(Date.now()-s<50);}throw Error(`Could not acquire lock on ${e} after 5000ms`)}function Xe(e,t){try{if($(e)){if(JSON.parse(Y(e,"utf8")).owner===t)se(e)}}catch{}}function k(e){q(e);let t=Y(e,"utf8"),n=JSON.parse(t);if(!n||!Array.isArray(n.items))return{items:[]};return n}function w(e,t){let n=`${e}.tmp.${oe()}`;B(n,JSON.stringify(t,null,2)),Ae(n,e)}function l(e,t){let n=oe(),r=Ie(e);xe(r,n);try{return t()}finally{Xe(r,n)}}function P(){return`k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`}function ce(e){return e.replace(/^k_/,"").slice(0,12)}import{Database as be}from"bun:sqlite";var ge=`
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
`,Ce=`
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
`;function G(e){K(e);let t=new be(e);return t.exec("PRAGMA foreign_keys = ON;"),t}function m(e){let t=G(e);try{if(t.exec(ge),Z(t)<2)t.exec(Ce);return{path:e,schema_version:Z(t)}}finally{t.close()}}function Z(e){return e.query("SELECT MAX(version) AS version FROM schema_versions").get()?.version??0}function A(e,t){return e.query(`SELECT COUNT(*) AS n FROM ${t}`).get()?.n??0}function ue(e){let t=G(e);try{return{schema_version:Z(t),sources:A(t,"sources"),source_revisions:A(t,"source_revisions"),chunks:A(t,"chunks"),wiki_pages:A(t,"wiki_pages"),citations:A(t,"citations"),indexes:A(t,"knowledge_indexes"),runs:A(t,"runs"),run_events:A(t,"run_events")}}finally{t.close()}}import{existsSync as De,mkdirSync as Te,readFileSync as me,writeFileSync as Fe}from"fs";import{dirname as Me,join as ee,relative as je,sep as Ke}from"path";function F(e){let t=e.replace(/\\/g,"/").trim();if(!t||t.startsWith("/"))throw Error(`Invalid artifact key: ${e}`);let n=t.split("/").filter(Boolean);if(n.length===0||n.some((r)=>r==="."||r===".."))throw Error(`Invalid artifact key: ${e}`);return n.join("/")}function ne(e,t){let n=je(e,t);if(n.startsWith("..")||n===".."||n.startsWith(`..${Ke}`))throw Error(`Artifact path escapes root: ${t}`)}class Ee{root;type="local";canRead=!0;canWrite=!0;constructor(e){this.root=e;Te(e,{recursive:!0})}async put(e){let t=F(e.key),n=ee(this.root,t);return ne(this.root,n),Te(Me(n),{recursive:!0}),Fe(n,e.body),{key:t,uri:`file://${n}`}}async getText(e){let t=F(e),n=ee(this.root,t);return ne(this.root,n),me(n,"utf8")}async exists(e){let t=F(e),n=ee(this.root,t);return ne(this.root,n),De(n)}}class de{options;type="s3";canRead=!0;canWrite=!0;client;constructor(e){this.options=e;this.client=e.client}async getClient(){if(this.client)return this.client;let[{S3Client:e},{fromIni:t}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]);return this.client=new e({region:this.options.region,credentials:this.options.profile?t({profile:this.options.profile}):void 0,maxAttempts:this.options.max_attempts}),this.client}objectKey(e){let t=F(e),n=this.options.prefix?F(this.options.prefix):"";return n?`${n}/${t}`:t}async put(e){let[{PutObjectCommand:t},n]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e.key);return await n.send(new t({Bucket:this.options.bucket,Key:r,Body:e.body,ContentType:e.content_type,Metadata:e.metadata,ServerSideEncryption:this.options.server_side_encryption,SSEKMSKeyId:this.options.kms_key_id})),{key:r,uri:`s3://${this.options.bucket}/${r}`}}async getText(e){let[{GetObjectCommand:t},n]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e),c=await n.send(new t({Bucket:this.options.bucket,Key:r}));if(!c.Body)return"";return await c.Body.transformToString()}async exists(e){let[{HeadObjectCommand:t},n]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e);try{return await n.send(new t({Bucket:this.options.bucket,Key:r})),!0}catch(c){let s=c instanceof Error?c.name:"";if(s==="NotFound"||s==="NoSuchKey"||s==="NotFoundError")return!1;throw c}}}function ae(e,t){if(e.storage.type==="s3"){if(!e.storage.s3?.bucket)throw Error("S3 artifact storage requires storage.s3.bucket");return new de({bucket:e.storage.s3.bucket,prefix:e.storage.s3.prefix,region:e.storage.s3.region,profile:e.storage.s3.profile,max_attempts:e.storage.s3.max_attempts,server_side_encryption:e.storage.s3.server_side_encryption,kms_key_id:e.storage.s3.kms_key_id})}return new Ee(t.artifactsDir)}function ve(e){let t=String(e.getUTCFullYear()),n=String(e.getUTCMonth()+1).padStart(2,"0"),r=String(e.getUTCDate()).padStart(2,"0");return{year:t,month:n,day:r}}function Be(){return`# Knowledge Agent Schema v1

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
`}function $e(){return`# Knowledge Index

This is a compact orientation index for agents. It is not the full search index.

## Shards

- wiki/
- indexes/
- schemas/
- logs/

## Source Ownership

Raw source files are resolved through open-files. This app stores source refs,
citations, chunks, generated wiki artifacts, indexes, and run records.
`}function Ye(){return`# Wiki

Generated durable knowledge pages live here.

Pages should be concise, cited, and organized for both humans and agents.
`}async function pe(e,t=new Date){let{year:n,month:r,day:c}=ve(t),s="schemas/v1.md",d="indexes/root.md",_="wiki/README.md",i=`logs/${n}/${r}/${c}.jsonl`,u={ts:t.toISOString(),event:"wiki_layout_initialized",schema_key:"schemas/v1.md",root_index_key:"indexes/root.md",wiki_readme_key:"wiki/README.md"},o=[e.put({key:"schemas/v1.md",body:Be(),content_type:"text/markdown"}),e.put({key:"indexes/root.md",body:$e(),content_type:"text/markdown"}),e.put({key:"wiki/README.md",body:Ye(),content_type:"text/markdown"}),e.put({key:i,body:`${JSON.stringify(u)}
`,content_type:"application/x-ndjson"})];return await Promise.all(o),{schema_key:"schemas/v1.md",root_index_key:"indexes/root.md",wiki_readme_key:"wiki/README.md",log_key:i,written:["schemas/v1.md","indexes/root.md","wiki/README.md",i]}}import{createHash as He}from"crypto";import{existsSync as Qe,readFileSync as Ve}from"fs";import{basename as qe}from"path";function fe(e,t){if(!e)throw Error(t);return e}function Ge(e){let n=e.slice(13).split("/").filter(Boolean),r=n[0];if(r!=="file"&&r!=="source")throw Error("Invalid open-files ref. Expected open-files://file/<id>, open-files://file/<id>/revision/<revision_id>, or open-files://source/<id>/path/<path>.");let c=fe(n[1],"Invalid open-files ref. Missing id.");if(r==="file"){if(n.length===2)return{kind:"open-files",uri:e,entity:r,id:c};if(n[2]==="revision"&&n[3]&&n.length===4)return{kind:"open-files",uri:e,entity:r,id:c,revision_id:decodeURIComponent(n[3])};throw Error("Invalid open-files file ref. Expected open-files://file/<id>/revision/<revision_id>.")}let s=n.indexOf("path"),d=s>=0?decodeURIComponent(n.slice(s+1).join("/")):void 0;return{kind:"open-files",uri:e,entity:r,id:c,path:d}}function ze(e){let t=new URL(e),n=fe(t.hostname,"Invalid s3 ref. Missing bucket."),r=decodeURIComponent(t.pathname.replace(/^\/+/,""));if(!r)throw Error("Invalid s3 ref. Missing object key.");return{kind:"s3",uri:e,bucket:n,key:r}}function We(e){let t=new URL(e);return{kind:"file",uri:e,path:decodeURIComponent(t.pathname)}}function Je(e){let t=new URL(e);return{kind:"web",uri:e,url:t.toString()}}function _e(e){if(e.startsWith("open-files://"))return Ge(e);if(e.startsWith("s3://"))return ze(e);if(e.startsWith("file://"))return We(e);if(e.startsWith("https://")||e.startsWith("http://"))return Je(e);throw Error(`Unsupported source ref scheme: ${e}`)}function te(e,t){return`${e}_${He("sha256").update(t).digest("hex").slice(0,20)}`}function g(e){return e&&typeof e==="object"&&!Array.isArray(e)?e:void 0}function E(e){return typeof e==="string"&&e.length>0?e:void 0}function Pe(e){return typeof e==="number"&&Number.isFinite(e)?e:void 0}function Ze(e){let t=E(e.source_ref)??E(e.source_uri)??E(e.uri);if(t)return t;let n=E(e.file_id);if(n){let s=E(e.revision_id)??E(e.revision),d=`open-files://file/${encodeURIComponent(n)}`;return s?`${d}/revision/${encodeURIComponent(s)}`:d}let r=E(e.source_id),c=E(e.path);if(r&&c)return`open-files://source/${encodeURIComponent(r)}/path/${encodeURIComponent(c)}`;throw Error("Manifest item is missing source_ref, file_id, or source_id/path.")}function en(e,t){if(t.kind==="open-files"&&t.entity==="file"&&t.revision_id)return e.replace(/\/revision\/[^/]+$/,"");return e}function nn(e){let t=E(e.extracted_text)??E(e.text)??E(e.content_text)??E(e.markdown);if(t!==void 0)return t;let n=e.content;return typeof n==="string"?n:null}function tn(e){let t=E(e.extracted_text_ref)??E(e.extracted_text_uri)??E(e.text_ref);if(t)return t;let n=g(e.content);return E(n?.extracted_text_ref)??E(n?.extracted_text_uri)??null}function rn(e){let t=E(e.path);return E(e.title)??E(e.name)??(t?qe(t):null)}function sn(e){return E(e.hash)??E(e.checksum)??E(e.sha256)??null}function on(e,t,n){return E(e.revision_id)??E(e.revision)??E(e.version_id)??(t.kind==="open-files"?t.revision_id:void 0)??n??E(e.updated_at)??"current"}function cn(e,t){let n={};for(let[r,c]of Object.entries(e)){if(["text","content","content_text","extracted_text","markdown"].includes(r))continue;n[r]=c}return n.source_ref=t.sourceRef,n.source_uri=t.sourceUri,n.status=t.status,n}function un(e,t){let n=Ze(e),r=_e(n),c=en(n,r),s=sn(e),d=E(e.status)??"active";return{raw:e,sourceRef:n,sourceUri:c,kind:r.kind,title:rn(e),revision:on(e,r,s),hash:s,extractedTextUri:tn(e),text:nn(e),metadata:cn(e,{sourceRef:n,sourceUri:c,status:d}),acl:e.permissions??e.acl??{},status:d,updatedAt:E(e.updated_at)??t}}function Tn(e){let t=e.trim();if(!t)return[];if(t.startsWith("[")){let n=JSON.parse(t);if(!Array.isArray(n))throw Error("Manifest array parse failed.");return n.map((r)=>{let c=g(r);if(!c)throw Error("Manifest array entries must be objects.");return c})}if(t.startsWith("{"))try{let n=JSON.parse(t),r=g(n);if(!r)throw Error("Manifest object parse failed.");if(Array.isArray(r.items))return r.items.map((c)=>{let s=g(c);if(!s)throw Error("Manifest items entries must be objects.");return s});if("source_ref"in r||"source_uri"in r||"file_id"in r)return[r]}catch(n){let r=t.split(/\r?\n/).filter((c)=>c.trim().length>0);if(r.length<=1)throw n;return r.map((c)=>{let s=g(JSON.parse(c));if(!s)throw Error("Manifest JSONL entries must be objects.");return s})}return t.split(/\r?\n/).filter((n)=>n.trim().length>0).map((n)=>{let r=g(JSON.parse(n));if(!r)throw Error("Manifest JSONL entries must be objects.");return r})}async function En(e,t){let n=new URL(e),r=n.hostname,c=decodeURIComponent(n.pathname.replace(/^\/+/,""));if(!r||!c)throw Error(`Invalid S3 manifest URI: ${e}`);let[{S3Client:s,GetObjectCommand:d},{fromIni:_}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]),i=t?.storage.type==="s3"&&t.storage.s3?.bucket===r?t.storage.s3:void 0,o=await new s({region:i?.region,credentials:i?.profile?_({profile:i.profile}):void 0,maxAttempts:i?.max_attempts}).send(new d({Bucket:r,Key:c}));if(!o.Body)return"";return await o.Body.transformToString()}async function dn(e,t){if(e.startsWith("s3://"))return En(e,t);if(!Qe(e))throw Error(`Manifest not found: ${e}`);return Ve(e,"utf8")}function an(e,t,n){let r=e.replace(/\r\n/g,`
`);if(!r.trim())return[];let c=[],s=0;while(s<r.length){let d=Math.min(r.length,s+t),_=d;if(d<r.length){let u=r.lastIndexOf(`

`,d),o=r.lastIndexOf(". ",d),T=Math.max(u,o);if(T>s+Math.floor(t*0.5))_=T+(T===u?2:1)}let i=r.slice(s,_).trim();if(i)c.push({ordinal:c.length,text:i,startOffset:s,endOffset:_});if(_>=r.length)break;s=Math.max(0,_-n)}return c}function pn(e){let t=e.trim().split(/\s+/).filter(Boolean).length;return Math.max(1,Math.ceil(t*1.25))}function fn(e,t){let n=e.query("SELECT id FROM chunks WHERE source_revision_id = ?").all(t);for(let r of n)e.run("DELETE FROM chunks_fts WHERE chunk_id = ?",[r.id]);return e.run("DELETE FROM chunks WHERE source_revision_id = ?",[t]),n.length}function _n(e,t,n){let r=te("src",t.sourceUri);e.run(`INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       kind = excluded.kind,
       title = excluded.title,
       metadata_json = excluded.metadata_json,
       acl_json = excluded.acl_json,
       updated_at = excluded.updated_at`,[r,t.sourceUri,t.kind,t.title,JSON.stringify(t.metadata),JSON.stringify(t.acl??{}),n,t.updatedAt]);let c=e.query("SELECT id FROM sources WHERE uri = ?").get(t.sourceUri);if(!c)throw Error(`Failed to upsert source: ${t.sourceUri}`);return c.id}function Nn(e,t,n,r){let c=te("rev",`${t}\x00${n.revision}`);e.run(`INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, revision) DO UPDATE SET
       hash = excluded.hash,
       extracted_text_uri = excluded.extracted_text_uri,
       metadata_json = excluded.metadata_json`,[c,t,n.revision,n.hash,n.extractedTextUri,JSON.stringify(n.metadata),r]);let s=e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").get(t,n.revision);if(!s)throw Error(`Failed to upsert source revision: ${n.sourceRef}`);return s.id}function Ln(e,t,n,r,c,s){if(!n.text||n.status.toLowerCase()==="deleted")return 0;let d=an(n.text,c,s);for(let _ of d){let i=te("chk",`${t}\x00${_.ordinal}\x00${_.text}`),u={source_ref:n.sourceRef,source_uri:n.sourceUri,hash:n.hash,status:n.status,path:E(n.raw.path)??null,mime:E(n.raw.mime)??E(n.raw.content_type)??null,size:Pe(n.raw.size)??null};e.run(`INSERT INTO chunks (id, source_revision_id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,[i,t,"source",_.ordinal,_.text,pn(_.text),_.startOffset,_.endOffset,JSON.stringify(u),r]),e.run("INSERT INTO chunks_fts (chunk_id, text, title, source_uri) VALUES (?, ?, ?, ?)",[i,_.text,n.title??"",n.sourceUri])}return d.length}async function Ne(e){let t=(e.now??new Date).toISOString(),n=e.maxChunkChars??4000,r=e.chunkOverlapChars??200;if(n<500)throw Error("maxChunkChars must be at least 500.");if(r<0||r>=n)throw Error("chunkOverlapChars must be less than maxChunkChars.");m(e.dbPath);let c=await dn(e.input,e.config),s=Tn(c),d=G(e.dbPath);try{return d.transaction(()=>{let i=new Set,u=new Set,o=0,T=0,a=0;for(let f of s){let y=un(f,t),h=_n(d,y,t),O=Nn(d,h,y,t);if(i.add(h),u.add(O),y.text||y.status.toLowerCase()==="deleted")T+=fn(d,O);o+=Ln(d,O,y,t,n,r)}return{path:e.input,db_path:e.dbPath,items_seen:s.length,sources_upserted:i.size,revisions_upserted:u.size,chunks_inserted:o,chunks_deleted:T,skipped:a}})()}finally{d.close()}}var M={name:"@hasna/knowledge",version:"0.2.5",description:"Agent-friendly local knowledge CLI with JSON output, pagination, and safe destructive actions",type:"module",bin:{"open-knowledge":"bin/open-knowledge.js","open-knowledge-mcp":"bin/open-knowledge-mcp.js"},files:["bin","src","docs","LICENSE","README.md"],scripts:{test:"bun test","test:cli":"bun test tests/cli.test.ts",build:"bun build --target=bun --outfile=bin/open-knowledge.js --minify --external @aws-sdk/client-s3 --external @aws-sdk/credential-providers src/cli.ts && bun build --target=bun --outfile=bin/open-knowledge-mcp.js --external @modelcontextprotocol/sdk src/mcp.js",prepublishOnly:"bun run build",postinstall:"bun run build"},keywords:["knowledge","cli","agents","json","notes","local","store"],license:"Apache-2.0",publishConfig:{registry:"https://registry.npmjs.org",access:"public"},repository:{type:"git",url:"git+https://github.com/hasna/knowledge.git"},bugs:{url:"https://github.com/hasna/knowledge/issues"},author:"Hasna Inc. <hasna@example.com>",engines:{bun:">=1.0",node:">=18"},dependencies:{"@aws-sdk/client-s3":"^3.1063.0","@aws-sdk/credential-providers":"^3.1063.0","@modelcontextprotocol/sdk":"^1.29.0",zod:"^4.3.6"},devDependencies:{"@types/bun":"^1.3.14"}};var Le={debug:0,info:1,warn:2,error:3},yn=()=>{if(process.env.DEBUG)return"debug";if(process.env.LOG_LEVEL==="debug")return"debug";if(process.env.LOG_LEVEL==="warn")return"warn";if(process.env.LOG_LEVEL==="error")return"error";return"info"};function x(e,t,n){if(Le[e]<Le[yn()])return;let r={debug:"[DEBUG]",info:"[INFO]",warn:"[WARN]",error:"[ERROR]"}[e],c=n?`${r} ${t} ${JSON.stringify(n)}`:`${r} ${t}`;if(e==="error")console.error(c);else console.error(c)}var Rn=["add","list","get","delete","update","archive","restore","upsert","untag","export","prune","dedupe","stats","paths","db","wiki","ingest","help"],he={ls:"list",rm:"delete",edit:"update",unarchive:"restore"};function On(e){let t=[],n={};for(let r=0;r<e.length;r+=1){let c=e[r];if(!c.startsWith("-")){t.push(c);continue}switch(c){case"--json":n.json=!0;break;case"--yes":case"-y":n.yes=!0;break;case"--help":case"-h":n.help=!0;break;case"--version":case"-v":n.version=!0;break;case"--desc":n.desc=!0;break;case"--page":case"-p":n.page=Number(e[r+1]),r+=1;break;case"--limit":case"-l":n.limit=Number(e[r+1]),r+=1;break;case"--search":case"-s":n.search=e[r+1],r+=1;break;case"--sort":n.sort=e[r+1],r+=1;break;case"--id":n.id=e[r+1],r+=1;break;case"--store":n.store=e[r+1],r+=1;break;case"--title":n.title=e[r+1],r+=1;break;case"--content":n.content=e[r+1],r+=1;break;case"--url":n.url=e[r+1],r+=1;break;case"--tag":case"-t":n.tag=e[r+1],r+=1;break;case"--format":n.format=e[r+1],r+=1;break;case"--completions":n.completions=e[r+1],r+=1;break;case"--no-color":n.noColor=!0;break;case"--scope":n.scope=e[r+1],r+=1;break;case"--older-than":n.olderThan=Number(e[r+1]),r+=1;break;case"--empty":n.empty=!0;break;case"--archived":n.archived=!0;break;case"--include-archived":n.includeArchived=!0;break;default:throw Error(`Unknown flag: ${c}. Run 'open-knowledge --help' for valid options.`)}}return{positional:t,flags:n}}function kn(e){if(!e)return"";return he[e]??e}function ln(e,t){let n=Array.from({length:e.length+1},()=>Array(t.length+1).fill(0));for(let r=0;r<=e.length;r+=1)n[r][0]=r;for(let r=0;r<=t.length;r+=1)n[0][r]=r;for(let r=1;r<=e.length;r+=1)for(let c=1;c<=t.length;c+=1){let s=e[r-1]===t[c-1]?0:1;n[r][c]=Math.min(n[r-1][c]+1,n[r][c-1]+1,n[r-1][c-1]+s)}return n[e.length][t.length]}function wn(e){if(!e)return"";let t=[...Rn,...Object.keys(he)],n="",r=Number.POSITIVE_INFINITY;for(let c of t){let s=ln(e,c);if(s<r)r=s,n=c}return r<=3?n:""}function Un(){console.log(`open-knowledge - local agent knowledge store

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
  ingest manifest <file|s3://> Ingest an open-files manifest into knowledge.db
  help [command]               Show help

Global Options:
  --json                      Output JSON
  --store <path>              Override store path
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
  --empty                     Remove items with empty content`)}function Sn(e){if(e==="add"){console.log("Usage: open-knowledge add <title> <content> [--url <url>] [-t <tag>] [--json]");return}if(e==="list"||e==="ls"){console.log("Usage: open-knowledge list|ls [--format table|json] [-p <page>] [-l <limit>] [-s <search>] [-t <tag>] [--sort created|title] [--desc] [--json]");return}if(e==="get"){console.log("Usage: open-knowledge get --id <id> [--json]");return}if(e==="update"||e==="edit"){console.log("Usage: open-knowledge update|edit --id <id> [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]");return}if(e==="archive"){console.log("Usage: open-knowledge archive --id <id> [--json]");return}if(e==="restore"||e==="unarchive"){console.log("Usage: open-knowledge restore|unarchive --id <id> [--json]");return}if(e==="upsert"){console.log("Usage: open-knowledge upsert [title] [content] [--id <id>] [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]");return}if(e==="untag"){console.log("Usage: open-knowledge untag --id <id> -t <tag> [--json]");return}if(e==="delete"||e==="rm"){console.log("Usage: open-knowledge delete|rm --id <id> -y [--json]");return}if(e==="export"){console.log("Usage: open-knowledge export [--format jsonl] [--json]");return}if(e==="prune"){console.log("Usage: open-knowledge prune --yes [--older-than <days>] [--empty] [--json]");return}if(e==="dedupe"){console.log("Usage: open-knowledge dedupe --yes [--json]");return}if(e==="stats"){console.log("Usage: open-knowledge stats [--json]");return}if(e==="paths"){console.log("Usage: open-knowledge paths [--scope local|global|project] [--json]");return}if(e==="db"){console.log("Usage: open-knowledge db init|stats [--scope local|global|project] [--json]");return}if(e==="wiki"){console.log("Usage: open-knowledge wiki init [--scope local|global|project] [--json]");return}if(e==="ingest"){console.log("Usage: open-knowledge ingest manifest <file|s3://bucket/key> [--scope local|global|project] [--json]");return}Un()}function An(e){if(e.noColor||process.env.NO_COLOR)return!1;if(process.env.FORCE_COLOR)return!0;return process.stdout.isTTY===!0}function L(e,t,n){if(t){console.log(JSON.stringify(e,null,2));return}if(typeof e==="string"){console.log(e);return}console.log(e.message??JSON.stringify(e,null,2))}function j(e){if(!e.id)throw Error("Missing required --id. Example: open-knowledge get --id <id>")}function In(e,t){let n=t.sort??"created";if(n!=="created"&&n!=="title")throw Error("Invalid --sort value. Use 'created' or 'title'.");let r=[...e].sort((c,s)=>{if(n==="title")return c.title.localeCompare(s.title);return c.created_at.localeCompare(s.created_at)});if(t.desc)r.reverse();return{sorted:r,sort:n,direction:t.desc?"desc":"asc"}}async function xn(e){let{positional:t,flags:n}=On(e);if(x("debug","CLI invoked",{command:t[0],flags:{json:n.json,store:n.store}}),n.version){console.log(n.json?JSON.stringify({name:M.name,version:M.version},null,2):`${M.name} ${M.version}`);return}if(n.completions){let i=n.completions;if(i==="bash")console.log('_open_knowledge() { local cur; cur="${COMP_WORDS[COMP_CWORD]}"; COMPREPLY=($(compgen -W "add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki ingest help ls rm edit unarchive --json --yes --help --version --desc --page --limit --search --sort --id --store --title --content --url --tag --format --completions --no-color --scope --archived --include-archived" -- "$cur")); }; complete -F _open_knowledge open-knowledge');else if(i==="zsh")console.log(`#compdef open-knowledge
_open_knowledge() { _arguments -C "1: :(add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki ingest help ls rm edit unarchive)" "(--json)--json" "(--yes)-y" "(--help)--help" "(--version)--version" "(--desc)--desc" "(--archived)--archived" "(--include-archived)--include-archived" "(-p --page)"{-p,--page}"[page number]:number:" "(-l --limit)"{-l,--limit}"[items per page]:number:" "(-s --search)"{-s,--search}"[search text]:text:" "(--sort)--sort"{created,title}:" "(--id)--id[item id]:id:" "(--store)--store[store path]:path:" "(--title)--title[new title]:" "(--content)--content[new content]:" "(--url)--url[source url]:" "(-t --tag)"{-t,--tag}"[tag]:tag:" "(--format)--format[json|jsonl]:" "(--completions)--completions[output completions]:shell:(bash zsh fish):" "(--no-color)--no-color[disable color]" "(--scope)--scope"{local,global,project}:" }; _open_knowledge`);else if(i==="fish")console.log('complete -c open-knowledge -f; complete -c open-knowledge -a "add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki ingest help ls rm edit unarchive"; complete -c open-knowledge -l json; complete -c open-knowledge -l yes -s y; complete -c open-knowledge -l help -s h; complete -c open-knowledge -l version -s v; complete -c open-knowledge -l desc; complete -c open-knowledge -l archived; complete -c open-knowledge -l include-archived; complete -c open-knowledge -s p -l page; complete -c open-knowledge -s l -l limit; complete -c open-knowledge -s s -l search; complete -c open-knowledge -l sort; complete -c open-knowledge -l id; complete -c open-knowledge -l store; complete -c open-knowledge -l title; complete -c open-knowledge -l content; complete -c open-knowledge -l url; complete -c open-knowledge -s t -l tag; complete -c open-knowledge -l format; complete -c open-knowledge -l completions; complete -c open-knowledge -l no-color; complete -c open-knowledge -l scope -a "local global project"');else throw Error("Invalid --completions value. Use 'bash', 'zsh', or 'fish'.");return}let r=kn(t[0]);if(!r||n.help||r==="help"){Sn(t[1]);return}let c=ie(n.scope),s=n.store;if(!s)if(n.scope==="project"||n.scope==="local")s=b(c.home).jsonStorePath;else s=V();if(r==="paths"){let i=b(c.home);L({ok:!0,scope:n.scope??"global",home:i.home,config_path:i.configPath,json_store_path:i.jsonStorePath,knowledge_db_path:i.knowledgeDbPath,artifacts_dir:i.artifactsDir,indexes_dir:i.indexesDir,logs_dir:i.logsDir,runs_dir:i.runsDir,schemas_dir:i.schemasDir,wiki_dir:i.wikiDir,config:v(i.configPath),message:i.home},n.json);return}if(r==="db"){let i=t[1]??"init",u=b(c.home);if(i!=="init"&&i!=="stats")throw Error("Invalid db action. Use 'init' or 'stats'.");if(i==="init"){let T=m(u.knowledgeDbPath);L({ok:!0,...T,message:`Initialized ${T.path}`},n.json);return}m(u.knowledgeDbPath);let o=ue(u.knowledgeDbPath);L({ok:!0,path:u.knowledgeDbPath,...o,message:`knowledge.db schema v${o.schema_version}`},n.json);return}if(r==="wiki"){if((t[1]??"init")!=="init")throw Error("Invalid wiki action. Use 'init'.");let u=b(c.home),o=v(u.configPath),T=ae(o,u),a=await pe(T);L({ok:!0,...a,message:`Initialized wiki layout in ${u.home}`},n.json);return}if(r==="ingest"){if((t[1]??"")!=="manifest")throw Error("Invalid ingest action. Use 'manifest'.");let u=t[2];if(!u)throw Error("Usage: open-knowledge ingest manifest <file|s3://bucket/key>");let o=b(c.home),T=v(o.configPath),a=await Ne({dbPath:o.knowledgeDbPath,input:u,config:T});L({ok:!0,...a,message:`Ingested ${a.items_seen} manifest item(s)`},n.json);return}if(q(s),r==="add"){let i=t[1],u=t[2];if(!i||!u)throw Error("Usage: open-knowledge add <title> <content>");l(s,()=>{let o=k(s),T={id:P(),title:i,content:u,url:n.url??null,tags:n.tag?[n.tag]:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()};o.items.push(T),w(s,o),x("info","Item added",{id:T.id,title:T.title}),L({ok:!0,item:T,message:`Added ${T.id}`},n.json)});return}if(r==="list"){if(n.format!==void 0&&n.format!=="table"&&n.format!=="json")throw Error("Invalid --format value for list. Use 'table' or 'json'.");l(s,()=>{let i=k(s),u=Number.isFinite(n.page)&&n.page>0?n.page:1,o=Number.isFinite(n.limit)&&n.limit>0?n.limit:20,T=n.search?String(n.search).toLowerCase():"",a=n.tag?String(n.tag).toLowerCase():"",f=n.format==="table"||!n.json&&!n.format&&An(n),y=n.json||n.format==="json",h=i.items;if(n.archived)h=h.filter((p)=>p.archived===!0);else if(!n.includeArchived)h=h.filter((p)=>!p.archived);if(T)h=h.filter((p)=>p.title.toLowerCase().includes(T)||p.content.toLowerCase().includes(T));if(a)h=h.filter((p)=>p.tags&&p.tags.map((W)=>W.toLowerCase()).includes(a));let{sorted:O,sort:C,direction:N}=In(h,n),U=(u-1)*o,X=O.slice(U,U+o),z=Math.max(1,Math.ceil(O.length/o));if(y){L({ok:!0,page:u,limit:o,total:O.length,total_pages:z,sort:C,direction:N,items:X},!0);return}if(X.length===0){L(`No items found (search=${T||"none"}, tag=${a||"none"})`,!1);return}if(f){let p=(S)=>S,W=`${p("ID")}	${p("TITLE")}	${p("CREATED")}	${p("URL")}	${p("TAGS")}`;console.log(W);for(let S of X)console.log(`${S.id}	${p(S.title)}	${S.created_at}	${S.url?p(S.url):""}	${S.tags?.length?p(`[${S.tags.join(", ")}]`):""}`);console.log(`Page ${u}/${z} | showing ${X.length} of ${O.length} | sort=${C} ${N} | search=${T||"none"} | tag=${a||"none"}`)}else{for(let p of X)console.log(`${p.id}	${p.title}	${p.created_at}${p.url?`	${p.url}`:""}${p.tags?.length?`	[${p.tags.join(", ")}]`:""}`);console.log(`Page ${u}/${z} | showing ${X.length} of ${O.length} | sort=${C} ${N} | search=${T||"none"} | tag=${a||"none"}`)}});return}if(r==="get"){j(n),l(s,()=>{let u=k(s).items.find((o)=>o.id===n.id||o.short_id===n.id);if(!u)throw Error(`Item not found: ${n.id}`);L({ok:!0,item:u,message:`${u.id}: ${u.title}`},n.json)});return}if(r==="update"){j(n),l(s,()=>{let i=k(s),u=i.items.findIndex((T)=>T.id===n.id||T.short_id===n.id);if(u===-1)throw Error(`Item not found: ${n.id}`);let o=i.items[u];if(n.title!==void 0)o.title=n.title;if(n.content!==void 0)o.content=n.content;if(n.url!==void 0)o.url=n.url;if(n.tag!==void 0){if(o.tags=o.tags||[],!o.tags.map((T)=>T.toLowerCase()).includes(n.tag.toLowerCase()))o.tags.push(n.tag)}o.updated_at=new Date().toISOString(),i.items[u]=o,w(s,i),L({ok:!0,item:o,message:`Updated ${o.id}`},n.json)});return}if(r==="archive"||r==="restore"){j(n),l(s,()=>{let i=k(s),u=i.items.findIndex((T)=>T.id===n.id||T.short_id===n.id);if(u===-1)throw Error(`Item not found: ${n.id}`);let o=i.items[u];o.archived=r==="archive",o.updated_at=new Date().toISOString(),i.items[u]=o,w(s,i),L({ok:!0,item:o,message:`${r==="archive"?"Archived":"Restored"} ${o.id}`},n.json)});return}if(r==="untag"){if(j(n),!n.tag)throw Error("Missing required --tag. Example: open-knowledge untag --id <id> -t <tag>");l(s,()=>{let i=k(s),u=i.items.findIndex((a)=>a.id===n.id||a.short_id===n.id);if(u===-1)throw Error(`Item not found: ${n.id}`);let o=i.items[u],T=o.tags?.length??0;o.tags=(o.tags??[]).filter((a)=>a.toLowerCase()!==n.tag.toLowerCase()),o.updated_at=new Date().toISOString(),i.items[u]=o,w(s,i),L({ok:!0,item:o,removed:T-o.tags.length,message:`Removed tag from ${o.id}`},n.json)});return}if(r==="upsert"){let i=n.title??t[1],u=n.content??t[2];l(s,()=>{let o=k(s),T=n.id?o.items.findIndex((y)=>y.id===n.id||y.short_id===n.id):-1,a=new Date().toISOString();if(T===-1){if(!i||!u)throw Error("New item requires title and content. Example: open-knowledge upsert <title> <content> [--id <id>]");let y=n.id??P(),h={id:y,short_id:ce(y),title:i,content:u,url:n.url??null,tags:n.tag?[n.tag]:[],metadata:{},archived:!1,created_at:a,updated_at:a};o.items.push(h),w(s,o),L({ok:!0,created:!0,item:h,message:`Upserted ${h.id}`},n.json);return}let f=o.items[T];if(i!==void 0)f.title=i;if(u!==void 0)f.content=u;if(n.url!==void 0)f.url=n.url;if(n.tag!==void 0){if(f.tags=f.tags||[],!f.tags.map((y)=>y.toLowerCase()).includes(n.tag.toLowerCase()))f.tags.push(n.tag)}f.updated_at=a,o.items[T]=f,w(s,o),L({ok:!0,created:!1,item:f,message:`Upserted ${f.id}`},n.json)});return}if(r==="delete"){if(j(n),!n.yes)throw Error("Refusing delete without --yes. Re-run with: open-knowledge delete --id <id> --yes");l(s,()=>{let i=k(s),u=i.items.length;i.items=i.items.filter((T)=>T.id!==n.id&&T.short_id!==n.id);let o=u!==i.items.length;if(w(s,i),!o)throw Error(`Item not found: ${n.id}`);x("info","Item deleted",{id:n.id}),L({ok:!0,deleted_id:n.id,message:`Deleted ${n.id}`},n.json)});return}if(r==="export"){let i=n.format??"json";if(i!=="json"&&i!=="jsonl")throw Error("Invalid --format. Use 'json' or 'jsonl'.");l(s,()=>{let u=k(s);if(i==="jsonl")for(let o of u.items)console.log(JSON.stringify(o));else L({ok:!0,items:u.items},n.json)});return}if(r==="prune"){if(!n.yes)throw Error("Refusing prune without --yes. Re-run with: open-knowledge prune --yes [--older-than <days>] [--empty]");l(s,()=>{let i=k(s),u=i.items.length;if(n.olderThan!==void 0){let T=new Date;T.setDate(T.getDate()-n.olderThan),i.items=i.items.filter((a)=>new Date(a.created_at)>=T)}if(n.empty)i.items=i.items.filter((T)=>T.content.trim().length>0);let o=u-i.items.length;w(s,i),x("info","Prune completed",{pruned:o,remaining:i.items.length}),L({ok:!0,pruned:o,remaining:i.items.length,message:`Pruned ${o} item(s)`},n.json)});return}if(r==="dedupe"){if(!n.yes)throw Error("Refusing dedupe without --yes. Re-run with: open-knowledge dedupe --yes [--json]");l(s,()=>{let i=k(s),u=new Set,o=i.items.length;i.items=i.items.filter((a)=>{let f=`${a.title}\x00${a.content}`;if(u.has(f))return!1;return u.add(f),!0});let T=o-i.items.length;w(s,i),x("info","Dedupe completed",{removed:T,remaining:i.items.length}),L({ok:!0,removed:T,remaining:i.items.length,message:`Dedupe removed ${T} duplicate(s)`},n.json)});return}if(r==="stats"){l(s,()=>{let i=k(s),u=i.items.filter((N)=>!N.archived),o=u.length,T=i.items.length-o,a=u.filter((N)=>N.url).length,f=u.filter((N)=>N.tags&&N.tags.length>0).length,y=o>0?u.map((N)=>N.created_at).sort()[0]:null,h=o>0?u.map((N)=>N.created_at).sort()[o-1]:null,O={};for(let N of u)for(let U of N.tags||[])O[U]=(O[U]||0)+1;let C=Object.entries(O).sort((N,U)=>U[1]-N[1]).slice(0,5).map(([N,U])=>({tag:N,count:U}));L({ok:!0,total:o,archived:T,with_url:a,with_tags:f,oldest:y,newest:h,top_tags:C,message:`${o} items | ${a} with URL | ${f} with tags`},n.json)});return}let d=wn(t[0]),_=d?` Did you mean '${d}'?`:"";throw x("warn","Unknown command",{input:t[0],suggestion:d}),Error(`Unknown command: ${t[0]}.${_} Run 'open-knowledge --help' for available commands.`)}if(import.meta.main)xn(process.argv.slice(2)).catch((e)=>{let t=e instanceof Error?e.message:String(e);x("error","CLI error",{message:t,stack:e instanceof Error?e.stack:void 0}),console.error(`Error: ${t}`),process.exitCode=1});export{wn as suggestCommand,In as sortItems,xn as run,On as parseArgs};
