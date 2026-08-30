export interface ParsedSignature {
  name?: string;
  title?: string;
  company?: string;
  phone?: string;
  email?: string;
  linkedin?: string;
  website?: string;
}

export function parseEmailSignature(text: string): ParsedSignature {
  const result: ParsedSignature = {};
  const phoneMatch = text.match(/(\+?[\d\s\-\(\)]{7,20})/);
  if (phoneMatch) result.phone = phoneMatch[1]?.trim();
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  if (emailMatch) result.email = emailMatch[0];
  const linkedinMatch = text.match(/(?:linkedin\.com\/in\/)([\w-]+)/i);
  if (linkedinMatch) result.linkedin = `https://linkedin.com/in/${linkedinMatch[1]}`;
  const websiteMatch = text.match(/https?:\/\/(?!linkedin)(?!twitter)[\w.-]+\.[a-z]{2,}/i);
  if (websiteMatch) result.website = websiteMatch[0];
  // Title/company heuristic: lines with | or — separator
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2 && l.length < 80);
  if (lines[0]) result.name = lines[0];
  for (const line of lines.slice(1)) {
    if (line.match(/\b(CEO|CTO|VP|Director|Manager|Engineer|Partner|Associate|Consultant|Analyst|President|Founder)\b/i)) {
      result.title = line;
    } else if (!result.company && line.match(/^[A-Z][A-Za-z\s,\.]+$/) && !line.includes('@')) {
      result.company = line;
    }
  }
  return result;
}

export function extractContactsFromEmailThread(
  participants: Array<{ name?: string; email: string; signature?: string }>
): Array<{
  display_name: string;
  emails: Array<{ address: string; type: string; is_primary: boolean }>;
  job_title?: string;
  social_profiles?: Array<{ platform: string; url: string; is_primary: boolean }>;
  phones?: Array<{ number: string; type: string; is_primary: boolean }>;
  website?: string;
  source: string;
}> {
  return participants.map(p => {
    const sig = p.signature ? parseEmailSignature(p.signature) : {};
    const name = p.name || sig.name || p.email.split('@')[0] || 'Unknown';
    const contact: {
      display_name: string;
      emails: Array<{ address: string; type: string; is_primary: boolean }>;
      job_title?: string;
      social_profiles?: Array<{ platform: string; url: string; is_primary: boolean }>;
      phones?: Array<{ number: string; type: string; is_primary: boolean }>;
      website?: string;
      source: string;
    } = {
      display_name: name,
      emails: [{ address: p.email, type: 'work', is_primary: true }],
      source: 'import',
    };
    if (sig.title) contact.job_title = sig.title;
    if (sig.phone) contact.phones = [{ number: sig.phone, type: 'work', is_primary: true }];
    if (sig.linkedin) contact.social_profiles = [{ platform: 'linkedin', url: sig.linkedin, is_primary: true }];
    if (sig.website) contact.website = sig.website;
    return contact;
  });
}
