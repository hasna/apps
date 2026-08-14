export default function SettingsPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
        <div className="p-4">
          <h2 className="font-semibold mb-1">API Keys</h2>
          <p className="text-sm text-gray-500">Manage API keys for programmatic access.</p>
        </div>
        <div className="p-4">
          <h2 className="font-semibold mb-1">Custom Domains</h2>
          <p className="text-sm text-gray-500">Connect custom domains to your projects.</p>
        </div>
        <div className="p-4">
          <h2 className="font-semibold mb-1">Email</h2>
          <p className="text-sm text-gray-500">Configure email provider (SES, Resend, SMTP).</p>
        </div>
        <div className="p-4">
          <h2 className="font-semibold mb-1">Webhooks</h2>
          <p className="text-sm text-gray-500">Subscribe to ticket events via HTTP webhooks.</p>
        </div>
      </div>
    </div>
  );
}
