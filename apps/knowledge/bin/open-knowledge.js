#!/usr/bin/env bun
// @bun
var U=import.meta.require;import{readFileSync as H,writeFileSync as J,existsSync as z,renameSync as Ie,unlinkSync as ae}from"fs";import{randomUUID as de}from"crypto";import{existsSync as be,mkdirSync as V,readFileSync as Se,writeFileSync as we}from"fs";import{homedir as ue}from"os";import{dirname as ke,join as g,resolve as me}from"path";var xe=g(".hasna","apps","knowledge");function Q(){return g(ue(),".open-knowledge","db.json")}function Z(){return g(ue(),".hasna","apps","knowledge")}function Ue(e=process.cwd()){return me(e,xe)}function v(e){return{home:e,configPath:g(e,"config.json"),jsonStorePath:g(e,"db.json"),knowledgeDbPath:g(e,"knowledge.db"),artifactsDir:g(e,"artifacts"),cacheDir:g(e,"cache"),exportsDir:g(e,"exports"),indexesDir:g(e,"indexes"),logsDir:g(e,"logs"),runsDir:g(e,"runs"),schemasDir:g(e,"schemas"),wikiDir:g(e,"wiki")}}function Ae(){return{version:1,mode:"local",storage:{type:"local",artifacts_root:"artifacts"},sources:{preferred_ref:"open-files",allowed_schemes:["open-files","s3","file","https","http"]}}}function I(e){let n=v(e);V(n.home,{recursive:!0});for(let t of[n.artifactsDir,n.cacheDir,n.exportsDir,n.indexesDir,n.logsDir,n.runsDir,n.schemasDir,n.wikiDir])V(t,{recursive:!0});if(!be(n.configPath))we(n.configPath,`${JSON.stringify(Ae(),null,2)}
`);return n}function ce(e,n=process.cwd()){if(e==="project"||e==="local")return v(Ue(n));return v(Z())}function Y(e){V(ke(e),{recursive:!0})}function K(e){let n=Se(e,"utf8");return JSON.parse(n)}function ee(){return v(Z()).jsonStorePath}function te(e){if(!z(e))if(Y(e),e===ee()&&z(Q()))J(e,H(Q(),"utf8"));else J(e,JSON.stringify({items:[]},null,2))}function Ce(e){return`${e}.lock`}function De(e,n){let i=Date.now();while(Date.now()-i<5000){try{if(!z(e)){J(e,JSON.stringify({owner:n,ts:Date.now()}));return}let d=JSON.parse(H(e,"utf8"));if(Date.now()-d.ts>1e4)ae(e)}catch{}let s=Date.now();while(Date.now()-s<50);}throw Error(`Could not acquire lock on ${e} after 5000ms`)}function je(e,n){try{if(z(e)){if(JSON.parse(H(e,"utf8")).owner===n)ae(e)}}catch{}}function L(e){te(e);let n=H(e,"utf8"),t=JSON.parse(n);if(!t||!Array.isArray(t.items))return{items:[]};return t}function w(e,n){let t=`${e}.tmp.${de()}`;J(t,JSON.stringify(n,null,2)),Ie(t,e)}function b(e,n){let t=de(),r=Ce(e);De(r,t);try{return n()}finally{je(r,t)}}function ne(){return`k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`}function Ee(e){return e.replace(/^k_/,"").slice(0,12)}import{Database as Xe}from"bun:sqlite";var Fe=`
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
`,Me=`
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
`;function X(e){Y(e);let n=new Xe(e);return n.exec("PRAGMA foreign_keys = ON;"),n}function C(e){let n=X(e);try{if(n.exec(Fe),re(n)<2)n.exec(Me);return{path:e,schema_version:re(n)}}finally{n.close()}}function re(e){return e.query("SELECT MAX(version) AS version FROM schema_versions").get()?.version??0}function A(e,n){return e.query(`SELECT COUNT(*) AS n FROM ${n}`).get()?.n??0}function Te(e){let n=X(e);try{return{schema_version:re(n),sources:A(n,"sources"),source_revisions:A(n,"source_revisions"),chunks:A(n,"chunks"),wiki_pages:A(n,"wiki_pages"),citations:A(n,"citations"),indexes:A(n,"knowledge_indexes"),runs:A(n,"runs"),run_events:A(n,"run_events")}}finally{n.close()}}import{existsSync as ve,mkdirSync as fe,readFileSync as Ke,writeFileSync as $e}from"fs";import{dirname as Be,join as ie,relative as We,sep as Ye}from"path";function $(e){let n=e.replace(/\\/g,"/").trim();if(!n||n.startsWith("/"))throw Error(`Invalid artifact key: ${e}`);let t=n.split("/").filter(Boolean);if(t.length===0||t.some((r)=>r==="."||r===".."))throw Error(`Invalid artifact key: ${e}`);return t.join("/")}function se(e,n){let t=We(e,n);if(t.startsWith("..")||t===".."||t.startsWith(`..${Ye}`))throw Error(`Artifact path escapes root: ${n}`)}class _e{root;type="local";canRead=!0;canWrite=!0;constructor(e){this.root=e;fe(e,{recursive:!0})}async put(e){let n=$(e.key),t=ie(this.root,n);return se(this.root,t),fe(Be(t),{recursive:!0}),$e(t,e.body),{key:n,uri:`file://${t}`}}async getText(e){let n=$(e),t=ie(this.root,n);return se(this.root,t),Ke(t,"utf8")}async exists(e){let n=$(e),t=ie(this.root,n);return se(this.root,t),ve(t)}}class pe{options;type="s3";canRead=!0;canWrite=!0;client;constructor(e){this.options=e;this.client=e.client}async getClient(){if(this.client)return this.client;let[{S3Client:e},{fromIni:n}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]);return this.client=new e({region:this.options.region,credentials:this.options.profile?n({profile:this.options.profile}):void 0,maxAttempts:this.options.max_attempts}),this.client}objectKey(e){let n=$(e),t=this.options.prefix?$(this.options.prefix):"";return t?`${t}/${n}`:n}async put(e){let[{PutObjectCommand:n},t]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e.key);return await t.send(new n({Bucket:this.options.bucket,Key:r,Body:e.body,ContentType:e.content_type,Metadata:e.metadata,ServerSideEncryption:this.options.server_side_encryption,SSEKMSKeyId:this.options.kms_key_id})),{key:r,uri:`s3://${this.options.bucket}/${r}`}}async getText(e){let[{GetObjectCommand:n},t]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e),i=await t.send(new n({Bucket:this.options.bucket,Key:r}));if(!i.Body)return"";return await i.Body.transformToString()}async exists(e){let[{HeadObjectCommand:n},t]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e);try{return await t.send(new n({Bucket:this.options.bucket,Key:r})),!0}catch(i){let s=i instanceof Error?i.name:"";if(s==="NotFound"||s==="NoSuchKey"||s==="NotFoundError")return!1;throw i}}}function le(e,n){if(e.storage.type==="s3"){if(!e.storage.s3?.bucket)throw Error("S3 artifact storage requires storage.s3.bucket");return new pe({bucket:e.storage.s3.bucket,prefix:e.storage.s3.prefix,region:e.storage.s3.region,profile:e.storage.s3.profile,max_attempts:e.storage.s3.max_attempts,server_side_encryption:e.storage.s3.server_side_encryption,kms_key_id:e.storage.s3.kms_key_id})}return new _e(n.artifactsDir)}function Je(e){let n=String(e.getUTCFullYear()),t=String(e.getUTCMonth()+1).padStart(2,"0"),r=String(e.getUTCDate()).padStart(2,"0");return{year:n,month:t,day:r}}function ze(){return`# Knowledge Agent Schema v1

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
`}function He(){return`# Knowledge Index

This is a compact orientation index for agents. It is not the full search index.

## Shards

- wiki/
- indexes/
- schemas/
- logs/

## Source Ownership

Raw source files are resolved through open-files. This app stores source refs,
citations, chunks, generated wiki artifacts, indexes, and run records.
`}function Ge(){return`# Wiki

Generated durable knowledge pages live here.

Pages should be concise, cited, and organized for both humans and agents.
`}async function he(e,n=new Date){let{year:t,month:r,day:i}=Je(n),s="schemas/v1.md",d="indexes/root.md",_="wiki/README.md",o=`logs/${t}/${r}/${i}.jsonl`,c={ts:n.toISOString(),event:"wiki_layout_initialized",schema_key:"schemas/v1.md",root_index_key:"indexes/root.md",wiki_readme_key:"wiki/README.md"},u=[e.put({key:"schemas/v1.md",body:ze(),content_type:"text/markdown"}),e.put({key:"indexes/root.md",body:He(),content_type:"text/markdown"}),e.put({key:"wiki/README.md",body:Ge(),content_type:"text/markdown"}),e.put({key:o,body:`${JSON.stringify(c)}
`,content_type:"application/x-ndjson"})];return await Promise.all(u),{schema_key:"schemas/v1.md",root_index_key:"indexes/root.md",wiki_readme_key:"wiki/README.md",log_key:o,written:["schemas/v1.md","indexes/root.md","wiki/README.md",o]}}import{createHash as Ze}from"crypto";import{existsSync as et,readFileSync as tt}from"fs";import{basename as nt}from"path";function Ne(e,n){if(!e)throw Error(n);return e}function qe(e){let t=e.slice(13).split("/").filter(Boolean),r=t[0];if(r!=="file"&&r!=="source")throw Error("Invalid open-files ref. Expected open-files://file/<id>, open-files://file/<id>/revision/<revision_id>, or open-files://source/<id>/path/<path>.");let i=Ne(t[1],"Invalid open-files ref. Missing id.");if(r==="file"){if(t.length===2)return{kind:"open-files",uri:e,entity:r,id:i};if(t[2]==="revision"&&t[3]&&t.length===4)return{kind:"open-files",uri:e,entity:r,id:i,revision_id:decodeURIComponent(t[3])};throw Error("Invalid open-files file ref. Expected open-files://file/<id>/revision/<revision_id>.")}let s=t.indexOf("path"),d=s>=0?decodeURIComponent(t.slice(s+1).join("/")):void 0;return{kind:"open-files",uri:e,entity:r,id:i,path:d}}function Pe(e){let n=new URL(e),t=Ne(n.hostname,"Invalid s3 ref. Missing bucket."),r=decodeURIComponent(n.pathname.replace(/^\/+/,""));if(!r)throw Error("Invalid s3 ref. Missing object key.");return{kind:"s3",uri:e,bucket:t,key:r}}function Ve(e){let n=new URL(e);return{kind:"file",uri:e,path:decodeURIComponent(n.pathname)}}function Qe(e){let n=new URL(e);return{kind:"web",uri:e,url:n.toString()}}function G(e){if(e.startsWith("open-files://"))return qe(e);if(e.startsWith("s3://"))return Pe(e);if(e.startsWith("file://"))return Ve(e);if(e.startsWith("https://")||e.startsWith("http://"))return Qe(e);throw Error(`Unsupported source ref scheme: ${e}`)}function oe(e,n){return`${e}_${Ze("sha256").update(n).digest("hex").slice(0,20)}`}function F(e){return e&&typeof e==="object"&&!Array.isArray(e)?e:void 0}function T(e){return typeof e==="string"&&e.length>0?e:void 0}function rt(e){return typeof e==="number"&&Number.isFinite(e)?e:void 0}function it(e){let n=T(e.source_ref)??T(e.source_uri)??T(e.uri);if(n)return n;let t=T(e.file_id);if(t){let s=T(e.revision_id)??T(e.revision),d=`open-files://file/${encodeURIComponent(t)}`;return s?`${d}/revision/${encodeURIComponent(s)}`:d}let r=T(e.source_id),i=T(e.path);if(r&&i)return`open-files://source/${encodeURIComponent(r)}/path/${encodeURIComponent(i)}`;throw Error("Manifest item is missing source_ref, file_id, or source_id/path.")}function st(e,n){if(n.kind==="open-files"&&n.entity==="file"&&n.revision_id)return e.replace(/\/revision\/[^/]+$/,"");return e}function ot(e){let n=T(e.extracted_text)??T(e.text)??T(e.content_text)??T(e.markdown);if(n!==void 0)return n;let t=e.content;return typeof t==="string"?t:null}function ut(e){let n=T(e.extracted_text_ref)??T(e.extracted_text_uri)??T(e.text_ref);if(n)return n;let t=F(e.content);return T(t?.extracted_text_ref)??T(t?.extracted_text_uri)??null}function ct(e){let n=T(e.path);return T(e.title)??T(e.name)??(n?nt(n):null)}function at(e){return T(e.hash)??T(e.checksum)??T(e.sha256)??null}function dt(e,n,t){return T(e.revision_id)??T(e.revision)??T(e.version_id)??(n.kind==="open-files"?n.revision_id:void 0)??t??T(e.updated_at)??"current"}function Et(e,n){let t={};for(let[r,i]of Object.entries(e)){if(["text","content","content_text","extracted_text","markdown"].includes(r))continue;t[r]=i}return t.source_ref=n.sourceRef,t.source_uri=n.sourceUri,t.status=n.status,t}function Tt(e,n){let t=it(e),r=G(t),i=st(t,r),s=at(e),d=T(e.status)??"active";return{raw:e,sourceRef:t,sourceUri:i,kind:r.kind,title:ct(e),revision:dt(e,r,s),hash:s,extractedTextUri:ut(e),text:ot(e),metadata:Et(e,{sourceRef:t,sourceUri:i,status:d}),acl:e.permissions??e.acl??{},status:d,updatedAt:T(e.updated_at)??n}}function ft(e){let n=e.trim();if(!n)return[];if(n.startsWith("[")){let t=JSON.parse(n);if(!Array.isArray(t))throw Error("Manifest array parse failed.");return t.map((r)=>{let i=F(r);if(!i)throw Error("Manifest array entries must be objects.");return i})}if(n.startsWith("{"))try{let t=JSON.parse(n),r=F(t);if(!r)throw Error("Manifest object parse failed.");if(Array.isArray(r.items))return r.items.map((i)=>{let s=F(i);if(!s)throw Error("Manifest items entries must be objects.");return s});if("source_ref"in r||"source_uri"in r||"file_id"in r)return[r]}catch(t){let r=n.split(/\r?\n/).filter((i)=>i.trim().length>0);if(r.length<=1)throw t;return r.map((i)=>{let s=F(JSON.parse(i));if(!s)throw Error("Manifest JSONL entries must be objects.");return s})}return n.split(/\r?\n/).filter((t)=>t.trim().length>0).map((t)=>{let r=F(JSON.parse(t));if(!r)throw Error("Manifest JSONL entries must be objects.");return r})}async function _t(e,n){let t=new URL(e),r=t.hostname,i=decodeURIComponent(t.pathname.replace(/^\/+/,""));if(!r||!i)throw Error(`Invalid S3 manifest URI: ${e}`);let[{S3Client:s,GetObjectCommand:d},{fromIni:_}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]),o=n?.storage.type==="s3"&&n.storage.s3?.bucket===r?n.storage.s3:void 0,u=await new s({region:o?.region,credentials:o?.profile?_({profile:o.profile}):void 0,maxAttempts:o?.max_attempts}).send(new d({Bucket:r,Key:i}));if(!u.Body)return"";return await u.Body.transformToString()}async function pt(e,n){if(e.startsWith("s3://"))return _t(e,n);if(!et(e))throw Error(`Manifest not found: ${e}`);return tt(e,"utf8")}function lt(e,n,t){let r=e.replace(/\r\n/g,`
`);if(!r.trim())return[];let i=[],s=0;while(s<r.length){let d=Math.min(r.length,s+n),_=d;if(d<r.length){let c=r.lastIndexOf(`

`,d),u=r.lastIndexOf(". ",d),a=Math.max(c,u);if(a>s+Math.floor(n*0.5))_=a+(a===c?2:1)}let o=r.slice(s,_).trim();if(o)i.push({ordinal:i.length,text:o,startOffset:s,endOffset:_});if(_>=r.length)break;s=Math.max(0,_-t)}return i}function ht(e){let n=e.trim().split(/\s+/).filter(Boolean).length;return Math.max(1,Math.ceil(n*1.25))}function Nt(e,n){let t=e.query("SELECT id FROM chunks WHERE source_revision_id = ?").all(n);for(let r of t)e.run("DELETE FROM chunks_fts WHERE chunk_id = ?",[r.id]);return e.run("DELETE FROM chunks WHERE source_revision_id = ?",[n]),t.length}function Ot(e,n,t){let r=oe("src",n.sourceUri);e.run(`INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       kind = excluded.kind,
       title = excluded.title,
       metadata_json = excluded.metadata_json,
       acl_json = excluded.acl_json,
       updated_at = excluded.updated_at`,[r,n.sourceUri,n.kind,n.title,JSON.stringify(n.metadata),JSON.stringify(n.acl??{}),t,n.updatedAt]);let i=e.query("SELECT id FROM sources WHERE uri = ?").get(n.sourceUri);if(!i)throw Error(`Failed to upsert source: ${n.sourceUri}`);return i.id}function yt(e,n,t,r){let i=oe("rev",`${n}\x00${t.revision}`);e.run(`INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, revision) DO UPDATE SET
       hash = excluded.hash,
       extracted_text_uri = excluded.extracted_text_uri,
       metadata_json = excluded.metadata_json`,[i,n,t.revision,t.hash,t.extractedTextUri,JSON.stringify(t.metadata),r]);let s=e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").get(n,t.revision);if(!s)throw Error(`Failed to upsert source revision: ${t.sourceRef}`);return s.id}function Rt(e,n,t,r,i,s){if(!t.text||t.status.toLowerCase()==="deleted")return 0;let d=lt(t.text,i,s);for(let _ of d){let o=oe("chk",`${n}\x00${_.ordinal}\x00${_.text}`),c={source_ref:t.sourceRef,source_uri:t.sourceUri,hash:t.hash,status:t.status,path:T(t.raw.path)??null,mime:T(t.raw.mime)??T(t.raw.content_type)??null,size:rt(t.raw.size)??null};e.run(`INSERT INTO chunks (id, source_revision_id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,[o,n,"source",_.ordinal,_.text,ht(_.text),_.startOffset,_.endOffset,JSON.stringify(c),r]),e.run("INSERT INTO chunks_fts (chunk_id, text, title, source_uri) VALUES (?, ?, ?, ?)",[o,_.text,t.title??"",t.sourceUri])}return d.length}async function Oe(e){let n=(e.now??new Date).toISOString(),t=e.maxChunkChars??4000,r=e.chunkOverlapChars??200;if(t<500)throw Error("maxChunkChars must be at least 500.");if(r<0||r>=t)throw Error("chunkOverlapChars must be less than maxChunkChars.");C(e.dbPath);let i=await pt(e.input,e.config),s=ft(i),d=X(e.dbPath);try{return d.transaction(()=>{let o=new Set,c=new Set,u=0,a=0,E=0;for(let h of s){let R=Tt(h,n),O=Ot(d,R,n),f=yt(d,O,R,n);if(o.add(O),c.add(f),R.text||R.status.toLowerCase()==="deleted")a+=Nt(d,f);u+=Rt(d,f,R,n,t,r)}return{path:e.input,db_path:e.dbPath,items_seen:s.length,sources_upserted:o.size,revisions_upserted:c.size,chunks_inserted:u,chunks_deleted:a,skipped:E}})()}finally{d.close()}}import{createHash as gt,randomUUID as Lt}from"crypto";import{existsSync as bt,readFileSync as St}from"fs";import{basename as wt}from"path";function q(e,n){return`${e}_${gt("sha256").update(n).digest("hex").slice(0,20)}`}function M(e){return e&&typeof e==="object"&&!Array.isArray(e)?e:void 0}function l(e){return typeof e==="string"&&e.length>0?e:void 0}function kt(e){let n=l(e.source_ref)??l(e.source_uri)??l(e.uri);if(n)return n;let t=l(e.file_id);if(t){let s=l(e.revision_id)??l(e.revision),d=`open-files://file/${encodeURIComponent(t)}`;return s?`${d}/revision/${encodeURIComponent(s)}`:d}let r=l(e.source_id),i=l(e.path);if(r&&i)return`open-files://source/${encodeURIComponent(r)}/path/${encodeURIComponent(i)}`;throw Error("Outbox event is missing source_ref, file_id, or source_id/path.")}function mt(e,n){if(n.kind==="open-files"&&n.entity==="file"&&n.revision_id)return e.replace(/\/revision\/[^/]+$/,"");return e}function xt(e){return l(e.hash)??l(e.checksum)??l(e.sha256)??null}function Ut(e,n,t){return l(e.revision_id)??l(e.revision)??l(e.version_id)??(n.kind==="open-files"?n.revision_id:void 0)??t??null}function At(e){return(l(e.event)??l(e.type)??l(e.action)??l(e.change_type)??"changed").toLowerCase()}function It(e){let n=l(e.path);return l(e.title)??l(e.name)??(n?wt(n):null)}function Ct(e,n){let t=kt(e),r=G(t),i=xt(e);return{raw:e,eventType:At(e),sourceRef:t,sourceUri:mt(t,r),kind:r.kind,title:It(e),revision:Ut(e,r,i),hash:i,status:l(e.status)?.toLowerCase()??null,updatedAt:l(e.updated_at)??n,acl:e.permissions??e.acl??void 0}}function Dt(e){let n=e.trim();if(!n)return[];if(n.startsWith("[")){let t=JSON.parse(n);if(!Array.isArray(t))throw Error("Outbox array parse failed.");return t.map((r)=>{let i=M(r);if(!i)throw Error("Outbox array entries must be objects.");return i})}if(n.startsWith("{"))try{let t=JSON.parse(n),r=M(t);if(!r)throw Error("Outbox object parse failed.");if(Array.isArray(r.events))return r.events.map((i)=>{let s=M(i);if(!s)throw Error("Outbox events entries must be objects.");return s});if("source_ref"in r||"source_uri"in r||"file_id"in r)return[r]}catch(t){let r=n.split(/\r?\n/).filter((i)=>i.trim().length>0);if(r.length<=1)throw t;return r.map((i)=>{let s=M(JSON.parse(i));if(!s)throw Error("Outbox JSONL entries must be objects.");return s})}return n.split(/\r?\n/).filter((t)=>t.trim().length>0).map((t)=>{let r=M(JSON.parse(t));if(!r)throw Error("Outbox JSONL entries must be objects.");return r})}async function jt(e,n){let t=new URL(e),r=t.hostname,i=decodeURIComponent(t.pathname.replace(/^\/+/,""));if(!r||!i)throw Error(`Invalid S3 outbox URI: ${e}`);let[{S3Client:s,GetObjectCommand:d},{fromIni:_}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]),o=n?.storage.type==="s3"&&n.storage.s3?.bucket===r?n.storage.s3:void 0,u=await new s({region:o?.region,credentials:o?.profile?_({profile:o.profile}):void 0,maxAttempts:o?.max_attempts}).send(new d({Bucket:r,Key:i}));if(!u.Body)return"";return await u.Body.transformToString()}async function Xt(e,n){if(e.startsWith("s3://"))return jt(e,n);if(!bt(e))throw Error(`Outbox not found: ${e}`);return St(e,"utf8")}function ye(e,n){let t={};if(e)try{t=M(JSON.parse(e))??{}}catch{t={}}return JSON.stringify({...t,...n})}function Ft(e,n,t){let r=q("src",n.sourceUri);e.run(`INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       kind = excluded.kind,
       title = COALESCE(excluded.title, sources.title),
       updated_at = excluded.updated_at`,[r,n.sourceUri,n.kind,n.title,JSON.stringify({source_ref:n.sourceRef,source_uri:n.sourceUri,status:n.status,last_outbox_event:n.eventType}),JSON.stringify(n.acl??{}),t,n.updatedAt]);let i=e.query("SELECT id, metadata_json, acl_json FROM sources WHERE uri = ?").get(n.sourceUri);if(!i)throw Error(`Failed to upsert source for outbox event: ${n.sourceUri}`);let s={source_ref:n.sourceRef,source_uri:n.sourceUri,last_outbox_event:n.eventType,last_outbox_at:n.updatedAt};if(n.status)s.status=n.status;if(l(n.raw.path))s.path=n.raw.path;return e.run("UPDATE sources SET metadata_json = ?, acl_json = CASE WHEN ? IS NULL THEN acl_json ELSE ? END, updated_at = ? WHERE id = ?",[ye(i.metadata_json,s),n.acl===void 0?null:JSON.stringify(n.acl),n.acl===void 0?null:JSON.stringify(n.acl),n.updatedAt,i.id]),i.id}function Mt(e,n,t,r){if(!t.revision)return null;let i=q("rev",`${n}\x00${t.revision}`),s={source_ref:t.sourceRef,source_uri:t.sourceUri,status:t.status,last_outbox_event:t.eventType,reindex_required:!0};return e.run(`INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, revision) DO UPDATE SET
       hash = COALESCE(excluded.hash, source_revisions.hash),
       metadata_json = excluded.metadata_json`,[i,n,t.revision,t.hash,l(t.raw.extracted_text_ref)??null,JSON.stringify(s),r]),e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").get(n,t.revision)?.id??null}function vt(e,n,t){if(t.revision)return e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").all(n,t.revision).map((r)=>r.id);if(t.hash)return e.query("SELECT id FROM source_revisions WHERE source_id = ? AND hash = ?").all(n,t.hash).map((r)=>r.id);return e.query("SELECT id FROM source_revisions WHERE source_id = ?").all(n).map((r)=>r.id)}function Kt(e,n){let t=e.query("SELECT id FROM chunks WHERE source_revision_id = ?").all(n),r=0;for(let s of t){let d=e.query("SELECT COUNT(*) AS n FROM chunk_embeddings WHERE chunk_id = ?").get(s.id);r+=d?.n??0,e.run("DELETE FROM chunk_embeddings WHERE chunk_id = ?",[s.id]),e.run("DELETE FROM chunks_fts WHERE chunk_id = ?",[s.id])}e.run("DELETE FROM chunks WHERE source_revision_id = ?",[n]);let i=e.query("SELECT metadata_json FROM source_revisions WHERE id = ?").get(n);return e.run("UPDATE source_revisions SET metadata_json = ? WHERE id = ?",[ye(i?.metadata_json,{reindex_required:!0,invalidated_at:new Date().toISOString()}),n]),{chunksDeleted:t.length,embeddingsDeleted:r}}function $t(e,n){return n==="deleted"||["delete","deleted","remove","removed"].includes(e)}function Bt(e){return["move","moved","rename","renamed","path_changed"].includes(e)}function Wt(e){return["permission","permissions","permission_changed","acl_changed"].includes(e)}async function Re(e){let n=(e.now??new Date).toISOString();C(e.dbPath);let t=await Xt(e.input,e.config),r=Dt(t),i=X(e.dbPath),s=`run_${Lt()}`;try{return i.transaction(()=>{i.run(`INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,[s,"open-files-outbox",e.input,"completed","local","open-files-outbox",JSON.stringify({path:e.input,events:r.length}),n,n]);let d=new Set,_=new Set,o=0,c=0,u=0,a=0,E=0,h=0;return r.forEach((R,O)=>{let f=Ct(R,n),k=Ft(i,f,n);d.add(k);let N=Mt(i,k,f,n);if(N)_.add(N);let S=vt(i,k,f);for(let m of S){_.add(m);let j=Kt(i,m);o+=j.chunksDeleted,c+=j.embeddingsDeleted,u+=1}if($t(f.eventType,f.status))a+=1;if(Bt(f.eventType))E+=1;if(Wt(f.eventType)||f.acl!==void 0)h+=1;i.run(`INSERT INTO run_events (id, run_id, level, event, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,[q("evt",`${s}\x00${O}\x00${f.sourceRef}\x00${f.eventType}`),s,"info",f.eventType,JSON.stringify({source_ref:f.sourceRef,source_uri:f.sourceUri,revision:f.revision,hash:f.hash,status:f.status,affected_revisions:S.length}),f.updatedAt])}),i.run(`INSERT INTO provider_usage (id, run_id, provider, model, input_tokens, output_tokens, cost_usd, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`,[q("usage",s),s,"local","open-files-outbox",JSON.stringify({note:"No model provider used for outbox invalidation."}),n]),{path:e.input,db_path:e.dbPath,run_id:s,events_seen:r.length,sources_touched:d.size,revisions_touched:_.size,chunks_deleted:o,embeddings_deleted:c,stale_revisions:u,deleted_sources:a,moved_sources:E,permission_updates:h}})()}finally{i.close()}}var B={name:"@hasna/knowledge",version:"0.2.6",description:"Agent-friendly local knowledge CLI with JSON output, pagination, and safe destructive actions",type:"module",bin:{"open-knowledge":"bin/open-knowledge.js","open-knowledge-mcp":"bin/open-knowledge-mcp.js"},files:["bin","src","docs","LICENSE","README.md"],scripts:{test:"bun test","test:cli":"bun test tests/cli.test.ts",build:"bun build --target=bun --outfile=bin/open-knowledge.js --minify --external @aws-sdk/client-s3 --external @aws-sdk/credential-providers src/cli.ts && bun build --target=bun --outfile=bin/open-knowledge-mcp.js --external @modelcontextprotocol/sdk src/mcp.js",prepublishOnly:"bun run build",postinstall:"bun run build"},keywords:["knowledge","cli","agents","json","notes","local","store"],license:"Apache-2.0",publishConfig:{registry:"https://registry.npmjs.org",access:"public"},repository:{type:"git",url:"git+https://github.com/hasna/knowledge.git"},bugs:{url:"https://github.com/hasna/knowledge/issues"},author:"Hasna Inc. <hasna@example.com>",engines:{bun:">=1.0",node:">=18"},dependencies:{"@aws-sdk/client-s3":"^3.1063.0","@aws-sdk/credential-providers":"^3.1063.0","@modelcontextprotocol/sdk":"^1.29.0",zod:"^4.3.6"},devDependencies:{"@types/bun":"^1.3.14"}};var ge={debug:0,info:1,warn:2,error:3},Jt=()=>{if(process.env.DEBUG)return"debug";if(process.env.LOG_LEVEL==="debug")return"debug";if(process.env.LOG_LEVEL==="warn")return"warn";if(process.env.LOG_LEVEL==="error")return"error";return"info"};function D(e,n,t){if(ge[e]<ge[Jt()])return;let r={debug:"[DEBUG]",info:"[INFO]",warn:"[WARN]",error:"[ERROR]"}[e],i=t?`${r} ${n} ${JSON.stringify(t)}`:`${r} ${n}`;if(e==="error")console.error(i);else console.error(i)}var zt=["add","list","get","delete","update","archive","restore","upsert","untag","export","prune","dedupe","stats","paths","db","wiki","ingest","reindex","help"],Le={ls:"list",rm:"delete",edit:"update",unarchive:"restore"};function Ht(e){let n=[],t={};for(let r=0;r<e.length;r+=1){let i=e[r];if(!i.startsWith("-")){n.push(i);continue}switch(i){case"--json":t.json=!0;break;case"--yes":case"-y":t.yes=!0;break;case"--help":case"-h":t.help=!0;break;case"--version":case"-v":t.version=!0;break;case"--desc":t.desc=!0;break;case"--page":case"-p":t.page=Number(e[r+1]),r+=1;break;case"--limit":case"-l":t.limit=Number(e[r+1]),r+=1;break;case"--search":case"-s":t.search=e[r+1],r+=1;break;case"--sort":t.sort=e[r+1],r+=1;break;case"--id":t.id=e[r+1],r+=1;break;case"--store":t.store=e[r+1],r+=1;break;case"--title":t.title=e[r+1],r+=1;break;case"--content":t.content=e[r+1],r+=1;break;case"--url":t.url=e[r+1],r+=1;break;case"--tag":case"-t":t.tag=e[r+1],r+=1;break;case"--format":t.format=e[r+1],r+=1;break;case"--completions":t.completions=e[r+1],r+=1;break;case"--no-color":t.noColor=!0;break;case"--scope":t.scope=e[r+1],r+=1;break;case"--older-than":t.olderThan=Number(e[r+1]),r+=1;break;case"--empty":t.empty=!0;break;case"--archived":t.archived=!0;break;case"--include-archived":t.includeArchived=!0;break;default:throw Error(`Unknown flag: ${i}. Run 'open-knowledge --help' for valid options.`)}}return{positional:n,flags:t}}function Gt(e){if(!e)return"";return Le[e]??e}function qt(e,n){let t=Array.from({length:e.length+1},()=>Array(n.length+1).fill(0));for(let r=0;r<=e.length;r+=1)t[r][0]=r;for(let r=0;r<=n.length;r+=1)t[0][r]=r;for(let r=1;r<=e.length;r+=1)for(let i=1;i<=n.length;i+=1){let s=e[r-1]===n[i-1]?0:1;t[r][i]=Math.min(t[r-1][i]+1,t[r][i-1]+1,t[r-1][i-1]+s)}return t[e.length][n.length]}function Pt(e){if(!e)return"";let n=[...zt,...Object.keys(Le)],t="",r=Number.POSITIVE_INFINITY;for(let i of n){let s=qt(e,i);if(s<r)r=s,t=i}return r<=3?t:""}function Vt(){console.log(`open-knowledge - local agent knowledge store

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
  reindex outbox <file|s3://>  Consume open-files change events and invalidate chunks
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
  --empty                     Remove items with empty content`)}function Qt(e){if(e==="add"){console.log("Usage: open-knowledge add <title> <content> [--url <url>] [-t <tag>] [--json]");return}if(e==="list"||e==="ls"){console.log("Usage: open-knowledge list|ls [--format table|json] [-p <page>] [-l <limit>] [-s <search>] [-t <tag>] [--sort created|title] [--desc] [--json]");return}if(e==="get"){console.log("Usage: open-knowledge get --id <id> [--json]");return}if(e==="update"||e==="edit"){console.log("Usage: open-knowledge update|edit --id <id> [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]");return}if(e==="archive"){console.log("Usage: open-knowledge archive --id <id> [--json]");return}if(e==="restore"||e==="unarchive"){console.log("Usage: open-knowledge restore|unarchive --id <id> [--json]");return}if(e==="upsert"){console.log("Usage: open-knowledge upsert [title] [content] [--id <id>] [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]");return}if(e==="untag"){console.log("Usage: open-knowledge untag --id <id> -t <tag> [--json]");return}if(e==="delete"||e==="rm"){console.log("Usage: open-knowledge delete|rm --id <id> -y [--json]");return}if(e==="export"){console.log("Usage: open-knowledge export [--format jsonl] [--json]");return}if(e==="prune"){console.log("Usage: open-knowledge prune --yes [--older-than <days>] [--empty] [--json]");return}if(e==="dedupe"){console.log("Usage: open-knowledge dedupe --yes [--json]");return}if(e==="stats"){console.log("Usage: open-knowledge stats [--json]");return}if(e==="paths"){console.log("Usage: open-knowledge paths [--scope local|global|project] [--json]");return}if(e==="db"){console.log("Usage: open-knowledge db init|stats [--scope local|global|project] [--json]");return}if(e==="wiki"){console.log("Usage: open-knowledge wiki init [--scope local|global|project] [--json]");return}if(e==="ingest"){console.log("Usage: open-knowledge ingest manifest <file|s3://bucket/key> [--scope local|global|project] [--json]");return}if(e==="reindex"){console.log("Usage: open-knowledge reindex outbox <file|s3://bucket/key> [--scope local|global|project] [--json]");return}Vt()}function Zt(e){if(e.noColor||process.env.NO_COLOR)return!1;if(process.env.FORCE_COLOR)return!0;return process.stdout.isTTY===!0}function y(e,n,t){if(n){console.log(JSON.stringify(e,null,2));return}if(typeof e==="string"){console.log(e);return}console.log(e.message??JSON.stringify(e,null,2))}function W(e){if(!e.id)throw Error("Missing required --id. Example: open-knowledge get --id <id>")}function en(e,n){let t=n.sort??"created";if(t!=="created"&&t!=="title")throw Error("Invalid --sort value. Use 'created' or 'title'.");let r=[...e].sort((i,s)=>{if(t==="title")return i.title.localeCompare(s.title);return i.created_at.localeCompare(s.created_at)});if(n.desc)r.reverse();return{sorted:r,sort:t,direction:n.desc?"desc":"asc"}}async function tn(e){let{positional:n,flags:t}=Ht(e);if(D("debug","CLI invoked",{command:n[0],flags:{json:t.json,store:t.store}}),t.version){console.log(t.json?JSON.stringify({name:B.name,version:B.version},null,2):`${B.name} ${B.version}`);return}if(t.completions){let o=t.completions;if(o==="bash")console.log('_open_knowledge() { local cur; cur="${COMP_WORDS[COMP_CWORD]}"; COMPREPLY=($(compgen -W "add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki ingest reindex help ls rm edit unarchive --json --yes --help --version --desc --page --limit --search --sort --id --store --title --content --url --tag --format --completions --no-color --scope --archived --include-archived" -- "$cur")); }; complete -F _open_knowledge open-knowledge');else if(o==="zsh")console.log(`#compdef open-knowledge
_open_knowledge() { _arguments -C "1: :(add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki ingest reindex help ls rm edit unarchive)" "(--json)--json" "(--yes)-y" "(--help)--help" "(--version)--version" "(--desc)--desc" "(--archived)--archived" "(--include-archived)--include-archived" "(-p --page)"{-p,--page}"[page number]:number:" "(-l --limit)"{-l,--limit}"[items per page]:number:" "(-s --search)"{-s,--search}"[search text]:text:" "(--sort)--sort"{created,title}:" "(--id)--id[item id]:id:" "(--store)--store[store path]:path:" "(--title)--title[new title]:" "(--content)--content[new content]:" "(--url)--url[source url]:" "(-t --tag)"{-t,--tag}"[tag]:tag:" "(--format)--format[json|jsonl]:" "(--completions)--completions[output completions]:shell:(bash zsh fish):" "(--no-color)--no-color[disable color]" "(--scope)--scope"{local,global,project}:" }; _open_knowledge`);else if(o==="fish")console.log('complete -c open-knowledge -f; complete -c open-knowledge -a "add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki ingest reindex help ls rm edit unarchive"; complete -c open-knowledge -l json; complete -c open-knowledge -l yes -s y; complete -c open-knowledge -l help -s h; complete -c open-knowledge -l version -s v; complete -c open-knowledge -l desc; complete -c open-knowledge -l archived; complete -c open-knowledge -l include-archived; complete -c open-knowledge -s p -l page; complete -c open-knowledge -s l -l limit; complete -c open-knowledge -s s -l search; complete -c open-knowledge -l sort; complete -c open-knowledge -l id; complete -c open-knowledge -l store; complete -c open-knowledge -l title; complete -c open-knowledge -l content; complete -c open-knowledge -l url; complete -c open-knowledge -s t -l tag; complete -c open-knowledge -l format; complete -c open-knowledge -l completions; complete -c open-knowledge -l no-color; complete -c open-knowledge -l scope -a "local global project"');else throw Error("Invalid --completions value. Use 'bash', 'zsh', or 'fish'.");return}let r=Gt(n[0]);if(!r||t.help||r==="help"){Qt(n[1]);return}let i=ce(t.scope),s=t.store;if(!s)if(t.scope==="project"||t.scope==="local")s=I(i.home).jsonStorePath;else s=ee();if(r==="paths"){let o=I(i.home);y({ok:!0,scope:t.scope??"global",home:o.home,config_path:o.configPath,json_store_path:o.jsonStorePath,knowledge_db_path:o.knowledgeDbPath,artifacts_dir:o.artifactsDir,indexes_dir:o.indexesDir,logs_dir:o.logsDir,runs_dir:o.runsDir,schemas_dir:o.schemasDir,wiki_dir:o.wikiDir,config:K(o.configPath),message:o.home},t.json);return}if(r==="db"){let o=n[1]??"init",c=I(i.home);if(o!=="init"&&o!=="stats")throw Error("Invalid db action. Use 'init' or 'stats'.");if(o==="init"){let a=C(c.knowledgeDbPath);y({ok:!0,...a,message:`Initialized ${a.path}`},t.json);return}C(c.knowledgeDbPath);let u=Te(c.knowledgeDbPath);y({ok:!0,path:c.knowledgeDbPath,...u,message:`knowledge.db schema v${u.schema_version}`},t.json);return}if(r==="wiki"){if((n[1]??"init")!=="init")throw Error("Invalid wiki action. Use 'init'.");let c=I(i.home),u=K(c.configPath),a=le(u,c),E=await he(a);y({ok:!0,...E,message:`Initialized wiki layout in ${c.home}`},t.json);return}if(r==="ingest"){if((n[1]??"")!=="manifest")throw Error("Invalid ingest action. Use 'manifest'.");let c=n[2];if(!c)throw Error("Usage: open-knowledge ingest manifest <file|s3://bucket/key>");let u=I(i.home),a=K(u.configPath),E=await Oe({dbPath:u.knowledgeDbPath,input:c,config:a});y({ok:!0,...E,message:`Ingested ${E.items_seen} manifest item(s)`},t.json);return}if(r==="reindex"){if((n[1]??"")!=="outbox")throw Error("Invalid reindex action. Use 'outbox'.");let c=n[2];if(!c)throw Error("Usage: open-knowledge reindex outbox <file|s3://bucket/key>");let u=I(i.home),a=K(u.configPath),E=await Re({dbPath:u.knowledgeDbPath,input:c,config:a});y({ok:!0,...E,message:`Consumed ${E.events_seen} outbox event(s)`},t.json);return}if(te(s),r==="add"){let o=n[1],c=n[2];if(!o||!c)throw Error("Usage: open-knowledge add <title> <content>");b(s,()=>{let u=L(s),a={id:ne(),title:o,content:c,url:t.url??null,tags:t.tag?[t.tag]:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()};u.items.push(a),w(s,u),D("info","Item added",{id:a.id,title:a.title}),y({ok:!0,item:a,message:`Added ${a.id}`},t.json)});return}if(r==="list"){if(t.format!==void 0&&t.format!=="table"&&t.format!=="json")throw Error("Invalid --format value for list. Use 'table' or 'json'.");b(s,()=>{let o=L(s),c=Number.isFinite(t.page)&&t.page>0?t.page:1,u=Number.isFinite(t.limit)&&t.limit>0?t.limit:20,a=t.search?String(t.search).toLowerCase():"",E=t.tag?String(t.tag).toLowerCase():"",h=t.format==="table"||!t.json&&!t.format&&Zt(t),R=t.json||t.format==="json",O=o.items;if(t.archived)O=O.filter((p)=>p.archived===!0);else if(!t.includeArchived)O=O.filter((p)=>!p.archived);if(a)O=O.filter((p)=>p.title.toLowerCase().includes(a)||p.content.toLowerCase().includes(a));if(E)O=O.filter((p)=>p.tags&&p.tags.map((P)=>P.toLowerCase()).includes(E));let{sorted:f,sort:k,direction:N}=en(O,t),S=(c-1)*u,m=f.slice(S,S+u),j=Math.max(1,Math.ceil(f.length/u));if(R){y({ok:!0,page:c,limit:u,total:f.length,total_pages:j,sort:k,direction:N,items:m},!0);return}if(m.length===0){y(`No items found (search=${a||"none"}, tag=${E||"none"})`,!1);return}if(h){let p=(x)=>x,P=`${p("ID")}	${p("TITLE")}	${p("CREATED")}	${p("URL")}	${p("TAGS")}`;console.log(P);for(let x of m)console.log(`${x.id}	${p(x.title)}	${x.created_at}	${x.url?p(x.url):""}	${x.tags?.length?p(`[${x.tags.join(", ")}]`):""}`);console.log(`Page ${c}/${j} | showing ${m.length} of ${f.length} | sort=${k} ${N} | search=${a||"none"} | tag=${E||"none"}`)}else{for(let p of m)console.log(`${p.id}	${p.title}	${p.created_at}${p.url?`	${p.url}`:""}${p.tags?.length?`	[${p.tags.join(", ")}]`:""}`);console.log(`Page ${c}/${j} | showing ${m.length} of ${f.length} | sort=${k} ${N} | search=${a||"none"} | tag=${E||"none"}`)}});return}if(r==="get"){W(t),b(s,()=>{let c=L(s).items.find((u)=>u.id===t.id||u.short_id===t.id);if(!c)throw Error(`Item not found: ${t.id}`);y({ok:!0,item:c,message:`${c.id}: ${c.title}`},t.json)});return}if(r==="update"){W(t),b(s,()=>{let o=L(s),c=o.items.findIndex((a)=>a.id===t.id||a.short_id===t.id);if(c===-1)throw Error(`Item not found: ${t.id}`);let u=o.items[c];if(t.title!==void 0)u.title=t.title;if(t.content!==void 0)u.content=t.content;if(t.url!==void 0)u.url=t.url;if(t.tag!==void 0){if(u.tags=u.tags||[],!u.tags.map((a)=>a.toLowerCase()).includes(t.tag.toLowerCase()))u.tags.push(t.tag)}u.updated_at=new Date().toISOString(),o.items[c]=u,w(s,o),y({ok:!0,item:u,message:`Updated ${u.id}`},t.json)});return}if(r==="archive"||r==="restore"){W(t),b(s,()=>{let o=L(s),c=o.items.findIndex((a)=>a.id===t.id||a.short_id===t.id);if(c===-1)throw Error(`Item not found: ${t.id}`);let u=o.items[c];u.archived=r==="archive",u.updated_at=new Date().toISOString(),o.items[c]=u,w(s,o),y({ok:!0,item:u,message:`${r==="archive"?"Archived":"Restored"} ${u.id}`},t.json)});return}if(r==="untag"){if(W(t),!t.tag)throw Error("Missing required --tag. Example: open-knowledge untag --id <id> -t <tag>");b(s,()=>{let o=L(s),c=o.items.findIndex((E)=>E.id===t.id||E.short_id===t.id);if(c===-1)throw Error(`Item not found: ${t.id}`);let u=o.items[c],a=u.tags?.length??0;u.tags=(u.tags??[]).filter((E)=>E.toLowerCase()!==t.tag.toLowerCase()),u.updated_at=new Date().toISOString(),o.items[c]=u,w(s,o),y({ok:!0,item:u,removed:a-u.tags.length,message:`Removed tag from ${u.id}`},t.json)});return}if(r==="upsert"){let o=t.title??n[1],c=t.content??n[2];b(s,()=>{let u=L(s),a=t.id?u.items.findIndex((R)=>R.id===t.id||R.short_id===t.id):-1,E=new Date().toISOString();if(a===-1){if(!o||!c)throw Error("New item requires title and content. Example: open-knowledge upsert <title> <content> [--id <id>]");let R=t.id??ne(),O={id:R,short_id:Ee(R),title:o,content:c,url:t.url??null,tags:t.tag?[t.tag]:[],metadata:{},archived:!1,created_at:E,updated_at:E};u.items.push(O),w(s,u),y({ok:!0,created:!0,item:O,message:`Upserted ${O.id}`},t.json);return}let h=u.items[a];if(o!==void 0)h.title=o;if(c!==void 0)h.content=c;if(t.url!==void 0)h.url=t.url;if(t.tag!==void 0){if(h.tags=h.tags||[],!h.tags.map((R)=>R.toLowerCase()).includes(t.tag.toLowerCase()))h.tags.push(t.tag)}h.updated_at=E,u.items[a]=h,w(s,u),y({ok:!0,created:!1,item:h,message:`Upserted ${h.id}`},t.json)});return}if(r==="delete"){if(W(t),!t.yes)throw Error("Refusing delete without --yes. Re-run with: open-knowledge delete --id <id> --yes");b(s,()=>{let o=L(s),c=o.items.length;o.items=o.items.filter((a)=>a.id!==t.id&&a.short_id!==t.id);let u=c!==o.items.length;if(w(s,o),!u)throw Error(`Item not found: ${t.id}`);D("info","Item deleted",{id:t.id}),y({ok:!0,deleted_id:t.id,message:`Deleted ${t.id}`},t.json)});return}if(r==="export"){let o=t.format??"json";if(o!=="json"&&o!=="jsonl")throw Error("Invalid --format. Use 'json' or 'jsonl'.");b(s,()=>{let c=L(s);if(o==="jsonl")for(let u of c.items)console.log(JSON.stringify(u));else y({ok:!0,items:c.items},t.json)});return}if(r==="prune"){if(!t.yes)throw Error("Refusing prune without --yes. Re-run with: open-knowledge prune --yes [--older-than <days>] [--empty]");b(s,()=>{let o=L(s),c=o.items.length;if(t.olderThan!==void 0){let a=new Date;a.setDate(a.getDate()-t.olderThan),o.items=o.items.filter((E)=>new Date(E.created_at)>=a)}if(t.empty)o.items=o.items.filter((a)=>a.content.trim().length>0);let u=c-o.items.length;w(s,o),D("info","Prune completed",{pruned:u,remaining:o.items.length}),y({ok:!0,pruned:u,remaining:o.items.length,message:`Pruned ${u} item(s)`},t.json)});return}if(r==="dedupe"){if(!t.yes)throw Error("Refusing dedupe without --yes. Re-run with: open-knowledge dedupe --yes [--json]");b(s,()=>{let o=L(s),c=new Set,u=o.items.length;o.items=o.items.filter((E)=>{let h=`${E.title}\x00${E.content}`;if(c.has(h))return!1;return c.add(h),!0});let a=u-o.items.length;w(s,o),D("info","Dedupe completed",{removed:a,remaining:o.items.length}),y({ok:!0,removed:a,remaining:o.items.length,message:`Dedupe removed ${a} duplicate(s)`},t.json)});return}if(r==="stats"){b(s,()=>{let o=L(s),c=o.items.filter((N)=>!N.archived),u=c.length,a=o.items.length-u,E=c.filter((N)=>N.url).length,h=c.filter((N)=>N.tags&&N.tags.length>0).length,R=u>0?c.map((N)=>N.created_at).sort()[0]:null,O=u>0?c.map((N)=>N.created_at).sort()[u-1]:null,f={};for(let N of c)for(let S of N.tags||[])f[S]=(f[S]||0)+1;let k=Object.entries(f).sort((N,S)=>S[1]-N[1]).slice(0,5).map(([N,S])=>({tag:N,count:S}));y({ok:!0,total:u,archived:a,with_url:E,with_tags:h,oldest:R,newest:O,top_tags:k,message:`${u} items | ${E} with URL | ${h} with tags`},t.json)});return}let d=Pt(n[0]),_=d?` Did you mean '${d}'?`:"";throw D("warn","Unknown command",{input:n[0],suggestion:d}),Error(`Unknown command: ${n[0]}.${_} Run 'open-knowledge --help' for available commands.`)}if(import.meta.main)tn(process.argv.slice(2)).catch((e)=>{let n=e instanceof Error?e.message:String(e);D("error","CLI error",{message:n,stack:e instanceof Error?e.stack:void 0}),console.error(`Error: ${n}`),process.exitCode=1});export{Pt as suggestCommand,en as sortItems,tn as run,Ht as parseArgs};
