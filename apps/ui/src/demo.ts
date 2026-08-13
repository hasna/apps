// Demo UI used to compare our picker against the reference picker. Three
// genuinely distinct hero variants authored per the harvested ui.sh design
// guidelines (typography scale + contrast, restrained accent color, generous
// spacing, real assets from assets.ui.sh). Wrapped in the data-uidotsh-* picker
// contract so the SAME markup works under either picker.

export function demoHtml(pickerSrc: string, which: "local" | "reference"): string {
  return `<!doctype html>
<html lang="en" class="antialiased">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ui-local demo — ${which} picker</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet" />
  <style>
    body { font-family: 'Inter', ui-sans-serif, system-ui, sans-serif; }
    .font-serif-display { font-family: 'DM Serif Display', Georgia, serif; }
    .font-grotesk { font-family: 'Space Grotesk', ui-sans-serif, sans-serif; }
  </style>
</head>
<body class="isolate min-h-screen bg-white text-neutral-900">
  <!-- which-picker badge (not part of variants) -->
  <div class="fixed top-3 left-1/2 z-50 -translate-x-1/2 rounded-full bg-neutral-900/90 px-3 py-1 text-xs font-medium text-white shadow-lg">
    picker: ${which}
  </div>

  <div data-uidotsh-pick="Hero style" class="contents">

    <!-- Option 1: Minimal — centered, clean, single indigo accent -->
    <div data-uidotsh-option="Minimal" class="contents">
      <main class="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
        <a href="#" class="mb-8 inline-flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1 text-sm font-medium text-neutral-600 ring-1 ring-neutral-200">
          <span class="size-1.5 rounded-full bg-indigo-500"></span> Now in public beta
        </a>
        <h1 class="text-5xl font-bold tracking-tight text-neutral-900 sm:text-6xl">
          Ship interfaces that feel inevitable
        </h1>
        <p class="mt-6 max-w-xl text-lg leading-relaxed text-neutral-600">
          A design engine for teams who care about the details. Generate, compare, and refine production-ready UI — without the generic AI look.
        </p>
        <div class="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <a href="#" class="rounded-lg bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500">Start building</a>
          <a href="#" class="rounded-lg px-5 py-3 text-sm font-semibold text-neutral-700 transition hover:text-neutral-900">Read the docs &rarr;</a>
        </div>
      </main>
    </div>

    <!-- Option 2: Editorial — asymmetric, serif display, warm stone + terracotta -->
    <div data-uidotsh-option="Editorial" class="contents" hidden>
      <main class="min-h-screen bg-stone-50 text-stone-900">
        <div class="mx-auto grid max-w-6xl gap-12 px-6 py-28 lg:grid-cols-12 lg:gap-8 lg:py-40">
          <div class="lg:col-span-7">
            <p class="font-grotesk text-sm uppercase tracking-[0.2em] text-stone-500">The design engine</p>
            <h1 class="font-serif-display mt-6 text-6xl leading-[1.05] text-stone-900 sm:text-7xl">
              Interfaces with a point of view.
            </h1>
            <div class="mt-10">
              <a href="#" class="inline-flex rounded-full bg-orange-700 px-6 py-3 text-sm font-semibold tracking-wide text-orange-50 transition hover:bg-orange-800">Begin a draft</a>
            </div>
          </div>
          <div class="lg:col-span-5 lg:pt-6">
            <p class="max-w-sm text-lg leading-relaxed text-stone-600">
              No cards, no borders, no shadows. Hierarchy through type scale and weight alone — a high-end editorial spread, not a tech template.
            </p>
            <dl class="mt-10 grid grid-cols-2 gap-6 border-t border-stone-200 pt-8">
              <div>
                <dt class="text-sm text-stone-500">Components shipped</dt>
                <dd class="font-serif-display mt-1 text-3xl text-stone-900">12k+</dd>
              </div>
              <div>
                <dt class="text-sm text-stone-500">Teams onboard</dt>
                <dd class="font-serif-display mt-1 text-3xl text-stone-900">480</dd>
              </div>
            </dl>
          </div>
        </div>
      </main>
    </div>

    <!-- Option 3: Bold — dark, gradient, oversized grotesk, logo cloud -->
    <div data-uidotsh-option="Bold" class="contents" hidden>
      <main class="relative min-h-screen overflow-hidden bg-neutral-950 text-white">
        <div class="pointer-events-none absolute -top-40 left-1/2 size-[42rem] -translate-x-1/2 rounded-full bg-gradient-to-b from-violet-600/40 to-transparent blur-3xl"></div>
        <div class="relative mx-auto flex max-w-5xl flex-col items-center px-6 py-32 text-center sm:py-44">
          <h1 class="font-grotesk text-6xl font-bold leading-[0.95] tracking-tight sm:text-8xl">
            Build the<br />undeniable.
          </h1>
          <p class="mt-8 max-w-xl text-lg leading-relaxed text-neutral-300">
            A design engine that turns prompts into polished, componentized, production-grade interfaces — with motion, dark mode, and responsiveness baked in.
          </p>
          <div class="mt-12 flex flex-col items-center gap-4 sm:flex-row">
            <a href="#" class="rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-200">Get early access</a>
            <a href="#" class="rounded-xl px-6 py-3.5 text-sm font-semibold text-neutral-300 ring-1 ring-white/15 transition hover:bg-white/5">Watch the demo</a>
          </div>
          <div class="mt-20 flex flex-wrap items-center justify-center gap-x-10 gap-y-6 opacity-60">
            ${["align", "axiom", "orbital", "relay", "quirk"]
              .map(
                (id) =>
                  `<img src="https://assets.ui.sh/logos/${id}.svg?color=white&height=22" alt="${id}" class="h-5" loading="lazy" />`,
              )
              .join("\n            ")}
          </div>
        </div>
      </main>
    </div>

  </div>

  <script src="${pickerSrc}"></script>
</body>
</html>`;
}
