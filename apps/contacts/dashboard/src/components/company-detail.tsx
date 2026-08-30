import * as React from "react";
import { MailIcon, PhoneIcon, MapPinIcon, LinkIcon, TagIcon, GlobeIcon, UsersIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CompanyWithDetails } from "@/types";

interface CompanyDetailProps {
  company: CompanyWithDetails;
  onClose?: () => void;
}

export function CompanyDetail({ company, onClose }: CompanyDetailProps) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-start justify-between p-6 border-b">
        <div className="flex items-start gap-4">
          <div className="size-16 rounded-md bg-primary/10 flex items-center justify-center text-2xl font-semibold text-primary flex-shrink-0">
            {company.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-xl font-semibold">{company.name}</h2>
            {company.industry && (
              <p className="text-sm text-muted-foreground">{company.industry}</p>
            )}
            {company.domain && (
              <a
                href={`https://${company.domain}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-sm text-primary hover:underline mt-1"
              >
                <GlobeIcon className="size-3" />
                {company.domain}
              </a>
            )}
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 hover:bg-accent rounded-md transition-colors">
            <XIcon className="size-4" />
          </button>
        )}
      </div>

      <div className="p-6 space-y-5">
        <div className="flex gap-4">
          <StatCard icon={<UsersIcon className="size-4" />} label="Employees" value={String(company.employee_count)} />
          {company.founded_year && (
            <StatCard icon={<span className="text-xs">📅</span>} label="Founded" value={String(company.founded_year)} />
          )}
          {company.size && (
            <StatCard icon={<span className="text-xs">📊</span>} label="Size" value={company.size} />
          )}
        </div>

        {company.description && (
          <Section icon={<span className="size-4 text-xs">ℹ</span>} title="About">
            <p className="text-sm">{company.description}</p>
          </Section>
        )}

        {company.emails.length > 0 && (
          <Section icon={<MailIcon className="size-4" />} title="Email">
            {company.emails.map((e) => (
              <div key={e.id} className="flex items-center justify-between">
                <a href={`mailto:${e.address}`} className="text-sm hover:underline text-primary">
                  {e.address}
                </a>
                <Badge variant="secondary" className="text-xs capitalize">{e.type}</Badge>
              </div>
            ))}
          </Section>
        )}

        {company.phones.length > 0 && (
          <Section icon={<PhoneIcon className="size-4" />} title="Phone">
            {company.phones.map((p) => (
              <div key={p.id} className="flex items-center justify-between">
                <a href={`tel:${p.number}`} className="text-sm hover:underline text-primary">
                  {p.number}
                </a>
                <Badge variant="secondary" className="text-xs capitalize">{p.type}</Badge>
              </div>
            ))}
          </Section>
        )}

        {company.addresses.length > 0 && (
          <Section icon={<MapPinIcon className="size-4" />} title="Address">
            {company.addresses.map((a) => (
              <div key={a.id} className="text-sm">
                {[a.street, a.city, a.state, a.zip, a.country].filter(Boolean).join(", ")}
              </div>
            ))}
          </Section>
        )}

        {company.social_profiles.length > 0 && (
          <Section icon={<LinkIcon className="size-4" />} title="Social">
            {company.social_profiles.map((s) => (
              <div key={s.id} className="flex items-center justify-between">
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-sm hover:underline text-primary truncate">
                    {s.handle ?? s.url}
                  </a>
                ) : (
                  <span className="text-sm">{s.handle}</span>
                )}
                <Badge variant="secondary" className="text-xs capitalize">{s.platform}</Badge>
              </div>
            ))}
          </Section>
        )}

        {company.tags.length > 0 && (
          <Section icon={<TagIcon className="size-4" />} title="Tags">
            <div className="flex flex-wrap gap-2">
              {company.tags.map((t) => (
                <Badge
                  key={t.id}
                  variant="secondary"
                  style={{ backgroundColor: t.color + "20", color: t.color }}
                >
                  {t.name}
                </Badge>
              ))}
            </div>
          </Section>
        )}

        {company.notes && (
          <Section icon={<span className="size-4 text-xs leading-none">✎</span>} title="Notes">
            <p className="text-sm whitespace-pre-wrap">{company.notes}</p>
          </Section>
        )}

        <div className="text-xs text-muted-foreground pt-2 border-t space-y-1">
          <div>Created: {new Date(company.created_at).toLocaleDateString()}</div>
          <div>Updated: {new Date(company.updated_at).toLocaleDateString()}</div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 border rounded-md px-3 py-2">
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
      <div className="space-y-1.5 pl-6">{children}</div>
    </div>
  );
}
