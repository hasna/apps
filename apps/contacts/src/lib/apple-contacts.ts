export async function exportFromApple(): Promise<string> {
  if (process.platform !== 'darwin') throw new Error('Apple Contacts sync is only available on macOS');
  // Export all contacts from macOS Contacts as vCard
  const script = `tell application "Contacts" to return vcard of every person`;
  const proc = Bun.spawn(['osascript', '-e', script], { stdout: 'pipe', stderr: 'pipe' });
  const output = await new Response(proc.stdout as unknown as BodyInit).text();
  await proc.exited;
  return output;
}

export async function importToApple(vcfData: string): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('Apple Contacts sync is only available on macOS');
  const tmpFile = `/tmp/contacts-import-${Date.now()}.vcf`;
  await Bun.write(tmpFile, vcfData);
  const proc = Bun.spawn(['open', tmpFile], { stdout: 'pipe', stderr: 'pipe' });
  await proc.exited;
}
