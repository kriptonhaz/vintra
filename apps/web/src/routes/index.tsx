import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { createBrowserSupabase } from "@/lib/supabase";
import { captureRefFromUrl } from "@/lib/referral-cookie";
import { CheckCircle2 } from "lucide-react";
import {
  Calculator,
  ShoppingCart,
  Package,
  Clock,
  ArrowRight,
  Play,
  Check,
  Star,
  MessageCircle,
  Wallet,
  Calendar,
  Globe,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LandingNavbar } from "@/components/layout/landing-navbar";
import { LandingFooter } from "@/components/layout/landing-footer";
import { WhatsappFloat } from "@/components/layout/whatsapp-float";
import { Reveal } from "@/components/layout/reveal";
// Lazy-loaded so the tenant public-site bundle — which statically pulls in
// Leaflet and its render-blocking CSS — stays OUT of the apex landing page's
// critical path. The landing route (`kind: 'landing'`) never renders these,
// so without this Leaflet's CSS was blocking first paint on a page with no
// map. Only tenant-subdomain requests (`kind: 'queue' | 'notfound'`) pay for
// it now.
const PublicSitePage = lazy(() =>
  import("@/components/public-site-page").then((m) => ({
    default: m.PublicSitePage,
  })),
);
const PublicQueueNotFound = lazy(() =>
  import("@/components/public-site-page").then((m) => ({
    default: m.PublicQueueNotFound,
  })),
);
import { PublicSiteError } from "@/components/public-site-error";
import { getIndexRouteHostData } from "@/server/functions/public-tenant";
import { buildPublicSiteHead } from "@/lib/public-site-seo";
import { POS_PLANS } from "@vintra/shared";
import { SALES_WHATSAPP_PHONE, buildSalesWaUrl } from "@/lib/constants";

const WA_PRESET_MESSAGE = "Halo, saya ingin bertanya seputar Vintra";
const WA_HREF = buildSalesWaUrl(WA_PRESET_MESSAGE);

/**
 * JUR-185: Host-aware index route.
 *
 * The loader calls a server fn that reads the Host header (server-side
 * only — `getRequest()` can't be imported in the client bundle, hence
 * the server-fn wrapper). The server fn returns one of:
 *   - `kind: 'landing'`   → apex (vintra.my.id) or dev (localhost)
 *   - `kind: 'queue'`     → a claimed tenant subdomain — render queue page
 *   - `kind: 'notfound'`  → a subdomain that nobody claimed
 *
 * SSR runs the loader, serializes its result into the HTML. Client
 * hydrates with the same data and renders the same component. No
 * SSR/CSR mismatch, no flash.
 */
export const Route = createFileRoute("/")({
  loader: () => getIndexRouteHostData(),
  // JUR-177: on a claimed tenant subdomain, emit the full per-tenant
  // SEO head — title, description, OG + Twitter cards, robots, and
  // LocalBusiness JSON-LD. Apex + 404 return {} so the root route's
  // Vintra marketing defaults apply.
  head: ({ loaderData }) => {
    // The branded error fallback must never be indexed.
    if (loaderData?.kind === "error") {
      return { meta: [{ name: "robots", content: "noindex,nofollow" }] };
    }
    if (loaderData?.kind !== "queue") return {};
    const { slug, data } = loaderData;
    return buildPublicSiteHead({
      slug,
      businessName: data.tenant.businessName,
      seo: data.seo,
      branches: data.branches.map((b) => ({
        name: b.name,
        address: b.address,
        isMain: b.isMain,
      })),
    });
  },
  component: IndexRouteComponent,
});

function IndexRouteComponent() {
  const data = Route.useLoaderData();
  if (data.kind === "queue") {
    return (
      <Suspense fallback={null}>
        <PublicSitePage slug={data.slug} initial={data.data} />
      </Suspense>
    );
  }
  if (data.kind === "notfound") {
    return (
      <Suspense fallback={null}>
        <PublicQueueNotFound />
      </Suspense>
    );
  }
  if (data.kind === "error") {
    return <PublicSiteError />;
  }
  return <LandingPage />;
}

// ─── Shared decorative primitives ───────────────────────────────────────────

/**
 * Faint blueprint grid used on the dark ink surfaces. Pure CSS — two 1px
 * line gradients masked so the grid dissolves instead of ending on a
 * hard edge.
 */
function InkGrid() {
  const mask =
    "radial-gradient(ellipse 90% 70% at 50% 0%, black 30%, transparent 100%)";
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage:
          "linear-gradient(to right, rgb(255 255 255 / 0.05) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.05) 1px, transparent 1px)",
        backgroundSize: "56px 56px",
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    />
  );
}

/** Soft radial glow orb. Position via className. */
function Glow({ className }: { className: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute rounded-full blur-[120px]",
        className,
      )}
    />
  );
}

/** Pill-shaped section eyebrow. `dark` flips it for ink sections. */
function Eyebrow({
  children,
  dark,
}: {
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <span
      className={cn(
        "mb-4 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wider uppercase",
        dark
          ? "border-white/10 bg-white/5 text-accent-300"
          : "border-brand-200/70 bg-brand-50 text-brand-700",
      )}
    >
      {children}
    </span>
  );
}

// ─── Hero: floating live-ops widgets ────────────────────────────────────────

/** Compact WhatsApp AI exchange — one question in, one answer out. */
function ChatWidget({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "w-72 rounded-2xl border border-white/10 bg-white/[0.07] p-4 shadow-2xl shadow-gray-950/60 backdrop-blur-xl",
        className,
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-green-500">
          <MessageCircle className="h-3.5 w-3.5 text-white" />
        </div>
        <div>
          <p className="text-xs font-semibold text-white">
            {t("landing.whatsapp.mockup.assistantName")}
          </p>
          <p className="text-[9px] font-medium tracking-wider text-green-400 uppercase">
            {t("landing.whatsapp.mockup.status")}
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <div className="max-w-[85%] rounded-xl rounded-tl-none bg-white/10 p-2.5">
          <p className="text-[11px] leading-snug text-gray-200">
            {t("landing.whatsapp.mockup.customer1")}
          </p>
        </div>
        <div className="ml-auto max-w-[85%] rounded-xl rounded-tr-none bg-brand-500 p-2.5">
          <p className="text-[11px] leading-snug text-white">
            {t("landing.whatsapp.mockup.ai1")}
          </p>
          <p className="mt-1 text-right text-[9px] text-brand-200">
            {t("landing.whatsapp.mockup.aiAuthorTag")}
          </p>
        </div>
      </div>
    </div>
  );
}

/** HPP outcome card — the one number every owner checks. */
function MarginWidget({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "w-60 rounded-2xl bg-white p-4 shadow-2xl shadow-gray-950/60",
        className,
      )}
    >
      <p className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
        {t("landing.hpp.mockup.hppLabel")}
      </p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight text-gray-900">
        Rp 14.000
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full w-[64%] rounded-full bg-gradient-to-r from-brand-500 to-brand-700" />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="text-gray-500">
          {t("landing.hpp.mockup.marginSummary")}
        </span>
        <span className="font-bold text-success-600">36.4%</span>
      </div>
    </div>
  );
}

/** Attendance pulse — who's on the floor right now. */
function AttendanceWidget({ className }: { className?: string }) {
  const { t } = useTranslation();
  const rows = [
    { name: "Rina Amelia", time: "07:58" },
    { name: "Budi Santoso", time: "08:02" },
  ];
  return (
    <div
      className={cn(
        "w-64 rounded-2xl border border-white/10 bg-white/[0.07] p-4 shadow-2xl shadow-gray-950/60 backdrop-blur-xl",
        className,
      )}
    >
      <p className="mb-3 text-xs font-semibold text-white">
        {t("landing.attendance.mockup.title")}
      </p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500/30 text-[9px] font-bold text-brand-200">
                {r.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")}
              </div>
              <span className="text-[11px] text-gray-300">{r.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500">{r.time}</span>
              <span className="rounded-full bg-success-400/15 px-2 py-0.5 text-[9px] font-semibold text-success-400">
                {t("landing.attendance.mockup.statusPresent")}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeroSection() {
  const { t } = useTranslation();
  return (
    <section className="relative overflow-hidden bg-gray-950 pt-36 pb-20 lg:pt-44 lg:pb-28">
      <InkGrid />
      <Glow className="-top-40 left-1/3 h-[460px] w-[680px] -translate-x-1/2 bg-brand-600/25" />
      <Glow className="top-1/3 -right-32 h-96 w-96 bg-primary-700/25" />
      <Glow className="bottom-0 right-1/4 h-64 w-64 bg-accent-500/10" />

      <div className="relative mx-auto grid max-w-7xl items-center gap-16 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
        {/* Left — message */}
        <div className="lg:col-span-7">
          <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium text-gray-300 backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-400" />
            </span>
            {t("landing.hero.badge")}
          </span>

          <h1 className="mb-6 max-w-2xl text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-7xl">
            {t("landing.hero.titleStart")}
            <span className="bg-gradient-to-r from-brand-300 via-brand-400 to-brand-300 bg-clip-text text-transparent">
              {t("landing.hero.titleHighlight1")}
            </span>
            {t("landing.hero.titleAnd")}
            <span className="bg-gradient-to-r from-accent-200 via-accent-300 to-accent-400 bg-clip-text text-transparent">
              {t("landing.hero.titleHighlight2")}
            </span>
          </h1>

          <p className="mb-10 max-w-xl text-lg leading-relaxed text-gray-400 sm:text-xl">
            {t("landing.hero.subtitle")}
          </p>

          <div className="mb-8 flex flex-col gap-3 sm:flex-row">
            <a
              href="/auth/register"
              className="group inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-7 py-3.5 text-base font-semibold text-white shadow-[0_0_40px_rgba(61,105,228,0.45)] transition-all hover:bg-brand-400 hover:shadow-[0_0_56px_rgba(61,105,228,0.6)]"
            >
              {t("landing.hero.ctaPrimary")}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href="#fitur"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-7 py-3.5 text-base font-semibold text-gray-200 backdrop-blur transition-colors hover:bg-white/10"
            >
              <Play className="h-4 w-4" />
              {t("landing.hero.ctaDemo")}
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-500">
            {[
              t("landing.hero.wedge1"),
              t("landing.hero.wedge2"),
              t("landing.hero.wedge3"),
            ].map((wedge) => (
              <span key={wedge} className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-brand-400" />
                {wedge}
              </span>
            ))}
          </div>
        </div>

        {/* Right — layered live-ops widgets */}
        <div className="relative mx-auto h-[440px] w-full max-w-sm lg:col-span-5 lg:max-w-none">
          <Glow className="inset-8 bg-brand-600/20" />
          <ChatWidget className="animate-float absolute top-0 right-0 z-20 -rotate-2" />
          <MarginWidget className="animate-float-delayed absolute top-44 left-0 z-30 rotate-3" />
          <AttendanceWidget className="animate-float absolute bottom-0 right-6 z-10 rotate-1" />
          {/* Connector hint — a faint dashed thread tying the widgets
              together, suggesting one connected system. */}
          <svg
            aria-hidden
            className="absolute inset-0 h-full w-full text-white/10"
            fill="none"
          >
            <path
              d="M 280 90 C 160 130, 120 180, 110 230 M 140 300 C 200 330, 240 350, 250 380"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="4 6"
            />
          </svg>
        </div>
      </div>
    </section>
  );
}

// ─── Marquee social-proof strip ─────────────────────────────────────────────

// Brand names stay as proper nouns — not translated.
const BRANDS = [
  "KopiBenja",
  "RasaNusantara",
  "BatikModern",
  "FloristCantik",
  "BarberBro",
];

function MarqueeStrip() {
  const { t } = useTranslation();
  // The track renders the sequence twice; the keyframe slides -50% and
  // loops, which reads as an endless belt.
  const sequence = (
    <>
      {BRANDS.map((brand) => (
        <span key={brand} className="flex items-center gap-12">
          <span className="text-lg font-bold tracking-tight whitespace-nowrap text-gray-600">
            {brand}
          </span>
          <span className="h-1 w-1 rounded-full bg-accent-500/60" />
        </span>
      ))}
    </>
  );
  return (
    <section className="border-y border-white/5 bg-gray-950 py-10">
      <p className="mb-6 text-center text-xs font-semibold tracking-widest text-gray-500 uppercase">
        {t("landing.social.trustedBy")}
      </p>
      <div
        className="overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(to right, transparent, black 15%, black 85%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, black 15%, black 85%, transparent)",
        }}
      >
        <div className="animate-marquee flex w-max items-center gap-12">
          {sequence}
          {sequence}
        </div>
      </div>
    </section>
  );
}

// ─── Features — grouped module index ───────────────────────────────────────

type FeatureItem = { title: string; description: string };

interface FeatureEntry {
  /** Index into the landing.features.items i18n array. */
  idx: number;
  icon: React.ElementType;
  /** Anchor id — footer + navbar deep-links land on these rows. */
  id?: string;
}

/**
 * Three balanced pillars, three modules each. Every module gets equal
 * visual weight — the hero widgets already demo the product, so this
 * section reads as a calm, organized index instead of a showcase.
 * Item indexes map to locales: 0 HPP · 1 Absensi · 2 POS · 3 Stok ·
 * 4 Booking · 5 Situs · 6 WhatsApp AI · 7 Arus Kas · 8 Konten AI
 */
const FEATURE_GROUPS: { labelKey: string; entries: FeatureEntry[] }[] = [
  {
    labelKey: "landing.features.groupOps",
    entries: [
      { idx: 2, icon: ShoppingCart },
      { idx: 3, icon: Package },
      { idx: 4, icon: Calendar },
    ],
  },
  {
    labelKey: "landing.features.groupFinance",
    entries: [
      { idx: 0, icon: Calculator, id: "hpp" },
      { idx: 7, icon: Wallet },
      { idx: 1, icon: Clock, id: "absensi" },
    ],
  },
  {
    labelKey: "landing.features.groupGrowth",
    entries: [
      { idx: 6, icon: MessageCircle, id: "whatsapp" },
      { idx: 5, icon: Globe },
      { idx: 8, icon: Sparkles },
    ],
  },
];

function FeatureRow({
  entry,
  item,
}: {
  entry: FeatureEntry;
  item: FeatureItem;
}) {
  const Icon = entry.icon;
  return (
    <div
      id={entry.id}
      className="group rounded-2xl p-5 transition-all duration-200 hover:bg-white hover:shadow-lg hover:shadow-gray-900/5"
      style={entry.id ? { scrollMarginTop: "6rem" } : undefined}
    >
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-brand-600 shadow-sm transition-all duration-200 group-hover:border-transparent group-hover:bg-gradient-to-br group-hover:from-brand-500 group-hover:to-brand-700 group-hover:text-white">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h3 className="mb-1 text-[15px] font-bold text-gray-900">
            {item.title}
          </h3>
          <p className="text-sm leading-relaxed text-gray-600">
            {item.description}
          </p>
        </div>
      </div>
    </div>
  );
}

function FeaturesSection() {
  const { t } = useTranslation();
  const items = t("landing.features.items", {
    returnObjects: true,
  }) as FeatureItem[];
  const item = (i: number): FeatureItem =>
    items[i] ?? { title: "", description: "" };

  return (
    <section id="fitur" className="scroll-mt-24 bg-white py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-14 text-center">
          <Eyebrow>{t("landing.features.eyebrow")}</Eyebrow>
          <h2 className="mb-4 text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
            {t("landing.features.title")}
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-gray-600">
            {t("landing.features.subtitle")}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {FEATURE_GROUPS.map((group) => (
            <div
              key={group.labelKey}
              className="rounded-3xl border border-gray-200/80 bg-gray-50/60 p-2"
            >
              <p className="px-5 pt-5 pb-3 text-xs font-semibold tracking-wider text-accent-700 uppercase">
                {t(group.labelKey)}
              </p>
              <div className="space-y-1">
                {group.entries.map((entry) => (
                  <FeatureRow
                    key={entry.idx}
                    entry={entry}
                    item={item(entry.idx)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}


// ─── Day-in-the-life timeline ───────────────────────────────────────────────

function WorkflowSection() {
  const { t } = useTranslation();
  const steps = t("landing.workflow.steps", { returnObjects: true }) as {
    time: string;
    title: string;
    desc: string;
  }[];
  return (
    <section id="solusi" className="scroll-mt-24 bg-gray-50 py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 text-center">
          <Eyebrow>{t("landing.workflow.eyebrow")}</Eyebrow>
          <h2 className="mb-4 text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
            {t("landing.workflow.title")}
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-gray-600">
            {t("landing.workflow.subtitle")}
          </p>
        </div>

        <div className="relative">
          {/* Connecting thread — horizontal on desktop, vertical on mobile */}
          <div
            aria-hidden
            className="absolute top-5 right-[12.5%] left-[12.5%] hidden h-px bg-gradient-to-r from-transparent via-brand-300 to-transparent lg:block"
          />
          <div
            aria-hidden
            className="absolute top-2 bottom-2 left-5 w-px bg-gradient-to-b from-transparent via-brand-300 to-transparent lg:hidden"
          />
          <div className="grid gap-10 lg:grid-cols-4 lg:gap-6">
            {steps.map((step, i) => (
              <div key={step.time} className="relative flex gap-5 lg:block">
                <div className="relative z-10 flex flex-col items-center lg:mb-5">
                  <span className="flex h-10 items-center justify-center rounded-full border border-brand-200 bg-white px-4 text-sm font-bold tracking-wide text-brand-700 tabular-nums shadow-sm">
                    {step.time}
                  </span>
                </div>
                <div className="lg:text-center">
                  <p className="mb-1.5 text-base font-bold text-gray-900">
                    {step.title}
                  </p>
                  <p className="text-sm leading-relaxed text-gray-600 lg:mx-auto lg:max-w-[34ch]">
                    {step.desc}
                  </p>
                </div>
                {/* Step index watermark */}
                <span
                  aria-hidden
                  className="absolute -top-7 right-0 text-5xl font-extrabold text-gray-200/80 select-none lg:right-auto lg:left-1/2 lg:-translate-x-1/2"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Testimonial spotlight ──────────────────────────────────────────────────

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Stars({ className }: { className?: string }) {
  return (
    <div className={cn("flex gap-1", className)}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className="h-4 w-4 fill-accent-400 text-accent-400" />
      ))}
    </div>
  );
}

function TestimonialsSection() {
  const { t } = useTranslation();
  const items = t("landing.testimonials.items", { returnObjects: true }) as {
    name: string;
    business: string;
    quote: string;
  }[];
  const [spotlight, ...rest] = items;

  return (
    <section id="testimoni" className="scroll-mt-24 bg-white py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-14 max-w-2xl">
          <Eyebrow>{t("landing.testimonials.eyebrow")}</Eyebrow>
          <h2 className="mb-4 text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
            {t("landing.testimonials.title")}
          </h2>
          <p className="text-lg text-gray-600">
            {t("landing.testimonials.subtitle")}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-5">
          {/* Spotlight quote on ink */}
          {spotlight && (
            <figure className="relative flex flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-gray-950 p-8 lg:col-span-3 lg:p-10">
              <InkGrid />
              <Glow className="-bottom-20 -left-20 h-56 w-56 bg-brand-600/30" />
              <div className="relative">
                <Stars className="mb-6" />
                <blockquote className="text-xl leading-relaxed font-medium text-white sm:text-2xl">
                  "{spotlight.quote}"
                </blockquote>
              </div>
              <figcaption className="relative mt-8 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-accent-300 to-accent-600 text-sm font-bold text-gray-950">
                  {initials(spotlight.name)}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">
                    {spotlight.name}
                  </p>
                  <p className="text-xs text-gray-400">{spotlight.business}</p>
                </div>
              </figcaption>
            </figure>
          )}

          {/* Supporting voices */}
          <div className="flex flex-col gap-6 lg:col-span-2">
            {rest.map((item) => (
              <figure
                key={item.name}
                className="flex h-full flex-col justify-between rounded-3xl border border-gray-200/80 bg-gray-50 p-6"
              >
                <div>
                  <Stars className="mb-4" />
                  <blockquote className="text-sm leading-relaxed text-gray-600">
                    "{item.quote}"
                  </blockquote>
                </div>
                <figcaption className="mt-5 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-semibold text-white">
                    {initials(item.name)}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {item.name}
                    </p>
                    <p className="text-xs text-gray-500">{item.business}</p>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Pricing (ink) ──────────────────────────────────────────────────────────

function formatIdr(amount: number) {
  return new Intl.NumberFormat("id-ID").format(amount);
}

interface PlanCardProps {
  name: string;
  tagline: string;
  price: string;
  priceUnit: string;
  secondary?: string;
  cta: string;
  href: string;
  featured?: boolean;
  featuredBadge?: string;
}

function PlanCard({
  name,
  tagline,
  price,
  priceUnit,
  secondary,
  cta,
  href,
  featured,
  featuredBadge,
}: PlanCardProps) {
  return (
    <a
      href={href}
      className={cn(
        "relative flex flex-col rounded-3xl p-7 transition-all duration-300 hover:-translate-y-1",
        featured
          ? "bg-white shadow-2xl shadow-brand-600/30 lg:scale-105"
          : "border border-white/10 bg-white/5 backdrop-blur hover:bg-white/[0.08]",
      )}
    >
      {featured && featuredBadge && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-accent-400 to-accent-600 px-3.5 py-1 text-[10px] font-bold tracking-wider text-gray-950 uppercase shadow-md">
          {featuredBadge}
        </span>
      )}
      <h3
        className={cn(
          "text-base font-bold",
          featured ? "text-gray-950" : "text-white",
        )}
      >
        {name}
      </h3>
      <p
        className={cn(
          "mt-0.5 text-xs",
          featured ? "text-gray-500" : "text-gray-400",
        )}
      >
        {tagline}
      </p>
      <div className="mt-5 flex-1">
        <p className="flex items-baseline">
          <span
            className={cn(
              "text-3xl font-extrabold tracking-tight",
              featured ? "text-gray-950" : "text-white",
            )}
          >
            {price}
          </span>
          <span
            className={cn(
              "ml-1 text-xs",
              featured ? "text-gray-500" : "text-gray-400",
            )}
          >
            {priceUnit}
          </span>
        </p>
        {secondary && <p className="mt-1 text-[11px] text-gray-500">{secondary}</p>}
      </div>
      <div
        className={cn(
          "mt-6 inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors",
          featured
            ? "bg-brand-600 text-white shadow-lg shadow-brand-600/30"
            : "border border-white/15 bg-white/5 text-white",
        )}
      >
        {cta} <ArrowRight className="h-3 w-3" />
      </div>
    </a>
  );
}

function PricingSection() {
  const { t } = useTranslation();
  const komplitAnnual = POS_PLANS.find((p) => p.key === "pos_komplit_annual")!;
  const komplitMonthly = POS_PLANS.find(
    (p) => p.key === "pos_komplit_monthly",
  )!;

  return (
    <section
      id="harga"
      className="relative scroll-mt-24 overflow-hidden bg-gray-950 py-24 lg:py-32"
    >
      <InkGrid />
      <Glow className="-top-32 left-1/2 h-80 w-[640px] -translate-x-1/2 bg-brand-600/25" />
      <Glow className="bottom-0 -left-24 h-64 w-64 bg-accent-500/10" />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <div className="mb-14 text-center">
            <Eyebrow dark>{t("landing.pricing.eyebrow")}</Eyebrow>
            <h2 className="mb-4 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              {t("landing.pricing.title")}
            </h2>
            <p className="mx-auto max-w-2xl text-lg text-gray-400">
              {t("landing.pricing.subtitle")}
            </p>
          </div>
        </Reveal>

        <div className="mx-auto grid max-w-5xl gap-5 sm:grid-cols-3 sm:items-stretch">
          <PlanCard
            name={t("landing.pricing.freeName")}
            tagline={t("landing.pricing.freeTagline")}
            price="Rp 0"
            priceUnit={t("landing.pricing.freePriceUnit")}
            cta={t("landing.pricing.freeCta")}
            href="/pricing"
          />
          <PlanCard
            name={t("landing.pricing.annualName")}
            tagline={t("landing.pricing.annualTagline")}
            price={`Rp ${formatIdr(komplitAnnual.pricePerMonth)}`}
            priceUnit={t("landing.pricing.annualPriceUnit")}
            secondary={t("landing.pricing.annualSecondaryTpl", {
              total: formatIdr(komplitAnnual.pricePerMonth * 12),
            })}
            cta={t("landing.pricing.lookCta")}
            href="/pricing"
            featured
            featuredBadge={t("landing.pricing.popularBadge")}
          />
          <PlanCard
            name={t("landing.pricing.monthlyName")}
            tagline={t("landing.pricing.monthlyTagline")}
            price={`Rp ${formatIdr(komplitMonthly.pricePerMonth)}`}
            priceUnit={t("landing.pricing.monthlyPriceUnit")}
            cta={t("landing.pricing.lookCta")}
            href="/pricing"
          />
        </div>

        <div className="mt-12 text-center">
          <a
            href="/pricing"
            className="group inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-3 text-sm font-bold text-white backdrop-blur transition-colors hover:bg-white/10"
          >
            {t("landing.pricing.mainCta")}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <p className="mt-4 text-xs text-gray-500">
            <Trans
              i18nKey="landing.pricing.footnote"
              components={{
                waLink: (
                  <a
                    href="/pricing#whatsapp"
                    className="font-medium text-brand-300 hover:underline"
                  />
                ),
              }}
            />
          </p>
        </div>
      </div>
    </section>
  );
}

// ─── Finale ─────────────────────────────────────────────────────────────────

function FinaleSection() {
  const { t } = useTranslation();
  return (
    <section className="relative overflow-hidden bg-white py-28 lg:py-36">
      {/* Oversized watermark wordmark */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center overflow-hidden select-none"
      >
        <span className="-mb-[0.23em] bg-gradient-to-b from-gray-100 to-white bg-clip-text text-[26vw] leading-none font-extrabold tracking-tighter text-transparent lg:text-[20rem]">
          VINTRA
        </span>
      </div>

      <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
        <span className="mx-auto mb-8 block h-10 w-px bg-gradient-to-b from-transparent to-accent-500" />
        <h2 className="mb-5 text-3xl font-extrabold tracking-tight text-gray-950 sm:text-5xl">
          {t("landing.cta.title")}
        </h2>
        <p className="mb-10 text-lg text-gray-600">
          {t("landing.cta.subtitle")}
        </p>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="/auth/register"
            className="group inline-flex items-center gap-2 rounded-xl bg-gray-950 px-8 py-3.5 text-base font-semibold text-white shadow-xl shadow-gray-950/20 transition-all hover:bg-gray-800"
          >
            {t("landing.cta.ctaTrial")}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <a
            href={WA_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-8 py-3.5 text-base font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            <MessageCircle className="h-4 w-4" />
            {t("landing.cta.ctaWa")}
          </a>
        </div>
      </div>
    </section>
  );
}

// ─── Main Landing Page ──────────────────────────────────────────────────────

function EmailVerifiedScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate({ to: "/auth/login" });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100">
          <CheckCircle2 className="h-8 w-8 text-brand-600" />
        </div>
        <h1 className="mb-2 text-2xl font-bold text-gray-900">
          {t("landing.emailVerified.title")}
        </h1>
        <p className="mb-6 text-sm text-gray-500">
          {t("landing.emailVerified.subtitle")}
        </p>
        <a
          href="/auth/login"
          className="inline-block rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          {t("landing.emailVerified.loginCta")}
        </a>
        <p className="mt-4 text-xs text-gray-400">
          {t("landing.emailVerified.redirectTpl", { count: countdown })}
        </p>
      </div>
    </div>
  );
}

function LandingPage() {
  const { t } = useTranslation();
  const [emailVerified, setEmailVerified] = useState(false);

  const navLinks = [
    { label: t("landing.nav.features"), href: "#fitur" },
    { label: t("landing.nav.solutions"), href: "#solusi" },
    { label: t("landing.nav.pricing"), href: "#harga" },
    { label: t("landing.nav.testimonials"), href: "#testimoni" },
  ];

  useEffect(() => {
    // JUR-91: capture ?ref= into the jq_ref cookie as early as
    // possible so even visitors who browse the landing first and
    // sign up later still get attributed. Idempotent — runs once
    // per mount, no-ops if there's no ?ref param.
    captureRefFromUrl();

    const hash = window.location.hash;

    // Defensive redirect: Supabase recovery emails should land on
    // /auth/reset-password, but if the redirect URL isn't whitelisted
    // in the Supabase project's URL Configuration, Supabase silently
    // falls back to the Site URL (which is the apex `/`). That dumps
    // the user on the landing page with a valid recovery token they
    // can't use. Catch it here and bounce to the correct route with
    // the hash intact — the reset-password page reads the hash via
    // the Supabase client and emits PASSWORD_RECOVERY normally.
    if (hash && hash.includes("type=recovery")) {
      window.location.replace(`/auth/reset-password${hash}`);
      return;
    }
    // Same defense for the search-string forms Supabase uses:
    //   - `?error=access_denied&error_code=otp_expired` (expired/used)
    //   - `?code=<uuid>` (PKCE recovery flow — the project setting puts
    //     this format on the recovery email's redirect URL; if the
    //     allowlist doesn't include /auth/reset-password the user
    //     lands on the apex instead).
    // reset-password.tsx handles both shapes; we just forward.
    const search = window.location.search;
    if (
      search &&
      /error_code=otp_expired|error=access_denied|[?&]code=/.test(search)
    ) {
      window.location.replace(`/auth/reset-password${search}`);
      return;
    }

    if (hash && hash.includes("type=signup")) {
      // Email verification redirect from Supabase — set session and show verified screen
      const supabase = createBrowserSupabase();
      supabase.auth.getSession().then(() => {
        // Clear the hash fragment
        window.history.replaceState(null, "", "/");
        setEmailVerified(true);
      });
    }
  }, []);

  if (emailVerified) {
    return <EmailVerifiedScreen />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <LandingNavbar navLinks={navLinks} tone="dark" />
      <main>
        {/* Hero renders eagerly — it's above the fold and a fade-in
            would create a noticeable empty flash on first paint.
            Every section below is wrapped in <Reveal> so it eases
            into view on scroll. */}
        <HeroSection />
        <Reveal>
          <MarqueeStrip />
        </Reveal>
        <Reveal>
          <FeaturesSection />
        </Reveal>
        <Reveal>
          <WorkflowSection />
        </Reveal>
        <Reveal>
          <TestimonialsSection />
        </Reveal>
        <Reveal>
          <PricingSection />
        </Reveal>
        <Reveal>
          <FinaleSection />
        </Reveal>
      </main>
      <LandingFooter />
      <WhatsappFloat
        phoneNumber={SALES_WHATSAPP_PHONE}
        message={WA_PRESET_MESSAGE}
      />
    </div>
  );
}
