import * as React from "react";
import { MailIcon, PhoneIcon, MapPinIcon, LinkIcon, TagIcon, BuildingIcon, CalendarIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ContactWithDetails } from "@/types";

interface ContactDetailProps {
  contact: ContactWithDetails;
  onClose?: () => void;
}

export function ContactDetail({ contact, onClose }: ContactDetailProps) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-start justify-between p-6 border-b">
        <div className="flex items-start gap-4">
          <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-semibold text-primary flex-shrink-0">
            {contact.display_name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-xl font-semibold">{contact.display_name}</h2>
            {contact.job_title && (
              <p className="text-sm text-muted-foreground">{contact.job_title}</p>
            )}
            {contact.company && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                <BuildingIcon className="size-3" />
                <span>{contact.company.name}</span>
              </div>
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
        {contact.emails.length > 0 && (
          <Section icon={<MailIcon className="size-4" />} title="Email">
            {contact.emails.map((e) => (
              <div key={e.id} className="flex items-center justify-between">
                <a href={`mailto:${e.address}`} className="text-sm hover:underline text-primary">
                  {e.address}
                </a>
                <Badge variant="secondary" className="text-xs capitalize">{e.type}</Badge>
              </div>
            ))}
          </Section>
        )}

        {contact.phones.length > 0 && (
          <Section icon={<PhoneIcon className="size-4" />} title="Phone">
            {contact.phones.map((p) => (
              <div key={p.id} className="flex items-center justify-between">
                <a href={`tel:${p.number}`} className="text-sm hover:underline text-primary">
                  {p.number}
                </a>
                <Badge variant="secondary" className="text-xs capitalize">{p.type}</Badge>
              </div>
            ))}
          </Section>
        )}

        {contact.addresses.length > 0 && (
          <Section icon={<MapPinIcon className="size-4" />} title="Address">
            {contact.addresses.map((a) => (
              <div key={a.id} className="text-sm">
                {[a.street, a.city, a.state, a.zip, a.country].filter(Boolean).join(", ")}
                <Badge variant="secondary" className="text-xs capitalize ml-2">{a.type}</Badge>
              </div>
            ))}
          </Section>
        )}

        {contact.social_profiles.length > 0 && (
          <Section icon={<LinkIcon className="size-4" />} title="Social">
            {contact.social_profiles.map((s) => (
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

        {contact.tags.length > 0 && (
          <Section icon={<TagIcon className="size-4" />} title="Tags">
            <div className="flex flex-wrap gap-2">
              {contact.tags.map((t) => (
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

        {contact.birthday && (
          <Section icon={<CalendarIcon className="size-4" />} title="Birthday">
            <span className="text-sm">{contact.birthday}</span>
          </Section>
        )}

        {contact.notes && (
          <Section icon={<span className="size-4 text-xs leading-none">✎</span>} title="Notes">
            <p className="text-sm whitespace-pre-wrap">{contact.notes}</p>
          </Section>
        )}

        <div className="text-xs text-muted-foreground pt-2 border-t space-y-1">
          <div>Created: {new Date(contact.created_at).toLocaleDateString()}</div>
          <div>Updated: {new Date(contact.updated_at).toLocaleDateString()}</div>
          <div>Source: {contact.source}</div>
        </div>
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
