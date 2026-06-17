import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import "./App.css";

const API = "/api";

type Tab = "overview" | "agreements" | "signing" | "people" | "signatures" | "certificates" | "setup";
type SignatureLevel = "ses" | "aes" | "qes" | "eseal" | "qeseal";
type SignerType = "human" | "agent";

interface DocumentItem {
  id: string;
  name: string;
  file_name: string;
  status: "draft" | "prepared" | "pending" | "sent" | "viewed" | "signed" | "completed" | "declined" | "expired" | "failed" | "cancelled";
  description?: string;
  metadata?: Record<string, unknown>;
  updated_at: string;
}

interface Person {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  role?: string;
  signer_type: SignerType;
  agent_id?: string;
  agent_provider?: string;
}

interface Signature {
  id: string;
  name: string;
  type: string;
  text_value?: string;
  color?: string;
}

interface SigningSession {
  id: string;
  document_id: string;
  signer_name?: string;
  signer_email?: string;
  signer_type: SignerType;
  agent_id?: string;
  agent_provider?: string;
  agent_run_id?: string;
  agent_policy_id?: string;
  role?: string;
  signing_order: number;
  parallel_group: number;
  recipient_status: string;
  status: string;
  source: string;
  signing_url?: string;
  certificate_path?: string;
  signed_document_path?: string;
  signature_level?: SignatureLevel;
  provider_status?: string;
  validation_status?: string;
  updated_at: string;
}

interface Certificate {
  id: string;
  document_id: string;
  session_id: string;
  certificate_path: string;
  verification_code: string;
  issued_at: string;
}

interface ProviderEvidence {
  id: string;
  document_id: string;
  session_id?: string;
  provider: string;
  connector_slug?: string;
  operation?: string;
  signature_level: SignatureLevel;
  signer_type?: SignerType;
  recipient_role?: string;
  status: string;
  validation_status: string;
  remote_document_id?: string;
  updated_at: string;
}

interface Stats {
  total_documents: number;
  total_signatures: number;
  total_projects: number;
  total_collections: number;
  total_tags: number;
  total_placements: number;
  total_sessions: number;
  total_people?: number;
  total_agents?: number;
  by_status?: Record<string, number>;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `${response.status} ${response.statusText}`);
  return payload;
}

function cleanForm(form: HTMLFormElement): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of new FormData(form).entries()) {
    const text = String(value).trim();
    if (text) values[key] = text;
  }
  return values;
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function formatDate(value?: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusClass(status: string): string {
  return `badge badge-${status}`;
}

function Empty({ label }: { label: string }) {
  return <div className="empty">{label}</div>;
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`stat ${tone}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function Overview({ stats, documents, sessions, evidence }: {
  stats?: Stats;
  documents: DocumentItem[];
  sessions: SigningSession[];
  evidence: ProviderEvidence[];
}) {
  const pending = sessions.filter((session) => !["completed", "signed", "skipped"].includes(session.status));
  const recent = documents.slice(0, 5);

  return (
    <div className="stack">
      <section className="stats-grid">
        <StatCard label="Agreements" value={stats?.total_documents ?? 0} tone="tone-blue" />
        <StatCard label="People" value={stats?.total_people ?? 0} tone="tone-green" />
        <StatCard label="Agents" value={stats?.total_agents ?? 0} tone="tone-amber" />
        <StatCard label="Sessions" value={stats?.total_sessions ?? 0} tone="tone-slate" />
        <StatCard label="Evidence" value={evidence.length} tone="tone-slate" />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Status</h2>
        </div>
        <div className="status-strip">
          {Object.entries(stats?.by_status ?? {}).map(([status, count]) => (
            <span key={status} className={statusClass(status)}>{status}: {count}</span>
          ))}
          {Object.keys(stats?.by_status ?? {}).length === 0 && <span className="muted">No status counts</span>}
        </div>
      </section>

      <section className="split">
        <div className="panel">
          <div className="panel-head">
            <h2>Recent Agreements</h2>
          </div>
          <EntityList
            items={recent}
            empty="No agreements"
            render={(doc) => (
              <Row key={doc.id}
                title={doc.name}
                meta={`${shortId(doc.id)} - ${doc.file_name}`}
                aside={<span className={statusClass(doc.status)}>{doc.status}</span>}
              />
            )}
          />
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>Pending Signatures</h2>
          </div>
          <EntityList
            items={pending.slice(0, 5)}
            empty="No pending sessions"
            render={(session) => (
              <Row key={session.id}
              title={session.signer_name ?? session.signer_email ?? "Unassigned signer"}
                meta={`${shortId(session.id)} - ${session.signer_type} - order ${session.signing_order} - ${formatDate(session.updated_at)}`}
                aside={session.signing_url ? <a href={session.signing_url}>Open</a> : undefined}
              />
            )}
          />
        </div>
      </section>
    </div>
  );
}

function Agreements({ documents }: { documents: DocumentItem[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Agreements</h2>
        <span className="count">{documents.length}</span>
      </div>
      <EntityList
        items={documents}
        empty="No agreements"
        render={(doc) => {
          const source = doc.metadata?.["source_markdown_path"];
          return (
            <Row key={doc.id}
              title={doc.name}
              meta={`${doc.file_name} - updated ${formatDate(doc.updated_at)}`}
              detail={typeof source === "string" ? source : doc.description}
              aside={<span className={statusClass(doc.status)}>{doc.status}</span>}
            />
          );
        }}
      />
    </section>
  );
}

function Signing({ documents, sessions }: {
  documents: DocumentItem[];
  sessions: SigningSession[];
}) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const createSession = useMutation({
    mutationFn: (payload: Record<string, unknown>) => postJson<{ signing_url: string }>(`/documents/${payload["document_id"]}/send`, payload),
    onSuccess: async (result) => {
      setMessage(result.signing_url);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
        queryClient.invalidateQueries({ queryKey: ["stats"] }),
      ]);
    },
  });

  return (
    <div className="split split-wide">
      <section className="panel">
        <div className="panel-head">
          <h2>Send For Signature</h2>
        </div>
        <form className="form" onSubmit={(event) => {
          event.preventDefault();
          const payload = cleanForm(event.currentTarget);
          createSession.mutate(payload);
        }}>
          <label>Agreement
            <select name="document_id" required>
              {documents.map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
            </select>
          </label>
          <label>Signer Name <input name="signer_name" autoComplete="name" /></label>
          <label>Signer Email <input name="signer_email" type="email" autoComplete="email" /></label>
          <label>Signer Type
            <select name="signer_type" defaultValue="human">
              <option value="human">Human</option>
              <option value="agent">Agent</option>
            </select>
          </label>
          <label>Agent ID <input name="agent_id" /></label>
          <label>Agent Provider <input name="agent_provider" /></label>
          <label>Agent Run ID <input name="agent_run_id" /></label>
          <label>Agent Policy <input name="agent_policy_id" /></label>
          <label>Role <input name="role" /></label>
          <label>Signing Order <input name="signing_order" type="number" min="1" defaultValue="1" /></label>
          <label>From Email <input name="from" type="email" autoComplete="email" /></label>
          <label>Base URL <input name="base_url" defaultValue="http://localhost:19440" /></label>
          <label>Expiry <input name="expiry" defaultValue="7d" /></label>
          <button type="submit" disabled={createSession.isPending || documents.length === 0}>Create Session</button>
          <Result mutation={createSession} message={message} />
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Sessions</h2>
          <span className="count">{sessions.length}</span>
        </div>
        <EntityList
          items={sessions}
          empty="No sessions"
          render={(session) => (
            <Row key={session.id}
              title={session.signer_name ?? session.signer_email ?? "Unassigned signer"}
              meta={`${shortId(session.id)} - ${session.source} - ${session.signer_type} - ${session.recipient_status} - order ${session.signing_order}`}
              detail={session.signing_url}
              aside={<span className={statusClass(session.status)}>{session.status}</span>}
            />
          )}
        />
      </section>
    </div>
  );
}

function People({ people }: { people: Person[] }) {
  const queryClient = useQueryClient();
  const createPerson = useMutation({
    mutationFn: (payload: Record<string, unknown>) => postJson<Person>("/people", payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["people"] }),
        queryClient.invalidateQueries({ queryKey: ["stats"] }),
      ]);
    },
  });

  return (
    <div className="split split-wide">
      <section className="panel">
        <div className="panel-head">
          <h2>Add Person</h2>
        </div>
        <form className="form" onSubmit={(event) => {
          event.preventDefault();
          createPerson.mutate(cleanForm(event.currentTarget));
          if (!createPerson.isError) event.currentTarget.reset();
        }}>
          <label>Name <input name="name" required autoComplete="name" /></label>
          <label>Signer Type
            <select name="signer_type" defaultValue="human">
              <option value="human">Human</option>
              <option value="agent">Agent</option>
            </select>
          </label>
          <label>Email <input name="email" type="email" autoComplete="email" /></label>
          <label>Phone <input name="phone" autoComplete="tel" /></label>
          <label>Company <input name="company" autoComplete="organization" /></label>
          <label>Role <input name="role" autoComplete="organization-title" /></label>
          <label>Agent ID <input name="agent_id" /></label>
          <label>Agent Provider <input name="agent_provider" /></label>
          <button type="submit" disabled={createPerson.isPending}>Save Person</button>
          <Result mutation={createPerson} />
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>People</h2>
          <span className="count">{people.length}</span>
        </div>
        <EntityList
          items={people}
          empty="No people"
          render={(person) => (
            <Row key={person.id}
              title={person.name}
              meta={[person.signer_type, person.email, person.phone].filter(Boolean).join(" - ")}
              detail={[person.agent_id ? `agent:${person.agent_id}` : undefined, person.agent_provider, person.company, person.role].filter(Boolean).join(" - ")}
              aside={<span className={statusClass(person.signer_type)}>{person.signer_type}</span>}
            />
          )}
        />
      </section>
    </div>
  );
}

function Signatures({ signatures }: { signatures: Signature[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Signatures</h2>
        <span className="count">{signatures.length}</span>
      </div>
      <div className="card-grid">
        {signatures.map((signature) => (
          <article key={signature.id} className="tile">
            <div className="tile-head">
              <strong>{signature.name}</strong>
              <span className="badge badge-neutral">{signature.type}</span>
            </div>
            {signature.text_value && <div className="signature-preview" style={{ color: signature.color ?? "#111827" }}>{signature.text_value}</div>}
            <span className="muted">{shortId(signature.id)}</span>
          </article>
        ))}
        {signatures.length === 0 && <Empty label="No signatures" />}
      </div>
    </section>
  );
}

function Certificates({ certificates }: { certificates: Certificate[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Certificates</h2>
        <span className="count">{certificates.length}</span>
      </div>
      <EntityList
        items={certificates}
        empty="No certificates"
        render={(certificate) => (
          <Row key={certificate.id}
            title={certificate.id}
            meta={`${shortId(certificate.session_id)} - ${formatDate(certificate.issued_at)}`}
            detail={certificate.certificate_path}
            aside={<span className="badge badge-neutral">{certificate.verification_code}</span>}
          />
        )}
      />
    </section>
  );
}

function Setup({ documents, evidence }: { documents: DocumentItem[]; evidence: ProviderEvidence[] }) {
  const queryClient = useQueryClient();
  const [domainResult, setDomainResult] = useState("");
  const [providerResult, setProviderResult] = useState("");
  const domainSetup = useMutation({
    mutationFn: (payload: Record<string, unknown>) => postJson<{ output?: string; error?: string }>("/domains/setup", payload),
    onSuccess: (result) => setDomainResult(result.error ?? result.output ?? "Domain setup completed"),
  });
  const providerSend = useMutation({
    mutationFn: (payload: Record<string, unknown>) => postJson<Record<string, unknown>>(`/documents/${payload["document_id"]}/provider-send`, payload),
    onSuccess: async (result) => {
      setProviderResult(JSON.stringify(result, null, 2));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["provider-evidence"] }),
        queryClient.invalidateQueries({ queryKey: ["sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["stats"] }),
      ]);
    },
  });

  return (
    <div className="split split-wide">
      <section className="panel">
        <div className="panel-head">
          <h2>Signing Domain</h2>
        </div>
        <form className="form" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const payload = cleanForm(form);
          payload["dry_run"] = String((form.elements.namedItem("dry_run") as HTMLInputElement).checked);
          if (payload["dry_run"] === "true") {
            domainSetup.mutate({ ...payload, dry_run: true });
          } else {
            domainSetup.mutate({ ...payload, dry_run: false });
          }
        }}>
          <label>Domain <input name="domain" required placeholder="example.com" /></label>
          <label>Subdomain <input name="subdomain" defaultValue="sign" /></label>
          <label>Target <input name="target" defaultValue="localhost" /></label>
          <label className="check"><input type="checkbox" name="dry_run" defaultChecked /> Dry run</label>
          <button type="submit" disabled={domainSetup.isPending}>Run Domain Setup</button>
          <Result mutation={domainSetup} message={domainResult} />
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Provider Send</h2>
        </div>
        <form className="form" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const payload = cleanForm(form);
          const dryRun = (form.elements.namedItem("dry_run") as HTMLInputElement).checked;
          providerSend.mutate({
            ...payload,
            dry_run: dryRun,
            recipient: { email: payload["recipient_email"], name: payload["recipient_name"] },
          });
        }}>
          <label>Agreement
            <select name="document_id" required>
              {documents.map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
            </select>
          </label>
          <label>Provider <input name="provider" defaultValue="pandadoc" /></label>
          <label>Signature Level
            <select name="signature_level" required defaultValue="qes">
              <option value="ses">SES</option>
              <option value="aes">AES</option>
              <option value="qes">QES provider</option>
              <option value="eseal">eSeal dry-run</option>
              <option value="qeseal">Qualified eSeal dry-run</option>
            </select>
          </label>
          <label>Recipient Email <input name="recipient_email" type="email" required /></label>
          <label>Recipient Name <input name="recipient_name" /></label>
          <label>Signer Type
            <select name="signer_type" defaultValue="human">
              <option value="human">Human</option>
              <option value="agent">Agent</option>
            </select>
          </label>
          <label>Subject <input name="subject" /></label>
          <label className="check"><input type="checkbox" name="dry_run" defaultChecked /> Dry run</label>
          <button type="submit" disabled={providerSend.isPending || documents.length === 0}>Send To Provider</button>
          <Result mutation={providerSend} message={providerResult} />
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Provider Evidence</h2>
          <span className="count">{evidence.length}</span>
        </div>
        <EntityList
          items={evidence}
          empty="No provider evidence"
          render={(item) => (
            <Row key={item.id}
              title={`${item.provider} ${item.signature_level}`}
              meta={`${shortId(item.id)} - ${item.signer_type ?? "human"} - ${item.status}/${item.validation_status}`}
              detail={[item.recipient_role, item.connector_slug, item.operation, item.remote_document_id].filter(Boolean).join(" - ")}
              aside={<span className={statusClass(item.status)}>{item.status}</span>}
            />
          )}
        />
      </section>
    </div>
  );
}

function Row({ title, meta, detail, aside }: {
  title: string;
  meta?: string;
  detail?: string;
  aside?: React.ReactNode;
}) {
  return (
    <article className="row">
      <div className="row-main">
        <strong>{title}</strong>
        {meta && <span className="muted">{meta}</span>}
        {detail && <span className="detail">{detail}</span>}
      </div>
      {aside && <div className="row-aside">{aside}</div>}
    </article>
  );
}

function EntityList<T>({ items, empty, render }: {
  items: T[];
  empty: string;
  render: (item: T) => React.ReactNode;
}) {
  if (items.length === 0) return <Empty label={empty} />;
  return <div className="list">{items.map(render)}</div>;
}

function Result({ mutation, message }: {
  mutation: { isError: boolean; isSuccess: boolean; error: unknown };
  message?: string;
}) {
  if (mutation.isError) return <div className="result error">{mutation.error instanceof Error ? mutation.error.message : "Request failed"}</div>;
  if (message) return <pre className="result">{message}</pre>;
  if (mutation.isSuccess) return <div className="result">Saved</div>;
  return null;
}

export function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => fetchJson<Stats>("/stats") });
  const documents = useQuery({ queryKey: ["documents"], queryFn: () => fetchJson<DocumentItem[]>("/documents") });
  const people = useQuery({ queryKey: ["people"], queryFn: () => fetchJson<Person[]>("/people") });
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => fetchJson<SigningSession[]>("/sessions") });
  const signatures = useQuery({ queryKey: ["signatures"], queryFn: () => fetchJson<Signature[]>("/signatures") });
  const certificates = useQuery({ queryKey: ["certificates"], queryFn: () => fetchJson<Certificate[]>("/certificates") });
  const providerEvidence = useQuery({ queryKey: ["provider-evidence"], queryFn: () => fetchJson<ProviderEvidence[]>("/provider-evidence") });

  const loading = [stats, documents, people, sessions, signatures, certificates, providerEvidence].some((query) => query.isLoading);
  const error = [stats, documents, people, sessions, signatures, certificates, providerEvidence].find((query) => query.isError)?.error;
  const docs = documents.data ?? [];
  const sessionItems = sessions.data ?? [];
  const evidence = providerEvidence.data ?? [];

  const tabs = useMemo<Array<{ id: Tab; label: string }>>(() => [
    { id: "overview", label: "Overview" },
    { id: "agreements", label: "Agreements" },
    { id: "signing", label: "Signing" },
    { id: "people", label: "People" },
    { id: "signatures", label: "Signatures" },
    { id: "certificates", label: "Certificates" },
    { id: "setup", label: "Setup" },
  ], []);

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>Open Signatures</h1>
          <p>Agreement operations and e-signature workflows</p>
        </div>
        <span className="badge badge-neutral">{stats.data?.total_sessions ?? 0} sessions</span>
      </header>

      <nav className="tabs" aria-label="Dashboard sections">
        {tabs.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "active" : ""}
            onClick={() => setTab(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>

      {loading && <div className="panel"><Empty label="Loading" /></div>}
      {error instanceof Error && <div className="panel"><div className="result error">{error.message}</div></div>}
      {!loading && !error && (
        <>
          {tab === "overview" && <Overview stats={stats.data} documents={docs} sessions={sessionItems} evidence={evidence} />}
          {tab === "agreements" && <Agreements documents={docs} />}
          {tab === "signing" && <Signing documents={docs} sessions={sessionItems} />}
          {tab === "people" && <People people={people.data ?? []} />}
          {tab === "signatures" && <Signatures signatures={signatures.data ?? []} />}
          {tab === "certificates" && <Certificates certificates={certificates.data ?? []} />}
          {tab === "setup" && <Setup documents={docs} evidence={evidence} />}
        </>
      )}
    </main>
  );
}
