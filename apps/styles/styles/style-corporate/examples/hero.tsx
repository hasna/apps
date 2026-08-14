// Corporate Hero — centered heading, subtext, 2-button CTA, trust badges
export function Hero() {
  return (
    <section className="bg-white py-20 px-4">
      <div className="max-w-3xl mx-auto text-center">
        <span className="inline-block px-3 py-1 text-xs font-semibold text-blue-700 bg-blue-50 rounded-full mb-6 border border-blue-100">
          Enterprise Ready
        </span>
        <h1 className="text-4xl font-bold text-gray-900 leading-tight mb-4">
          The platform your team<br />can rely on
        </h1>
        <p className="text-base text-gray-600 leading-relaxed mb-8 max-w-xl mx-auto">
          Streamline operations, reduce risk, and deliver results with a solution
          trusted by over 2,000 companies worldwide.
        </p>
        <div className="flex items-center justify-center gap-3 mb-10">
          <button className="px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors shadow-sm">
            Request a Demo
          </button>
          <button className="px-6 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors shadow-sm">
            View Pricing
          </button>
        </div>
        <div className="flex items-center justify-center gap-6 text-xs text-gray-400">
          <span>SOC 2 Type II</span>
          <span>•</span>
          <span>GDPR Compliant</span>
          <span>•</span>
          <span>99.9% Uptime SLA</span>
        </div>
      </div>
    </section>
  );
}
