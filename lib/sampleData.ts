// Lightweight, dependency-free generator for realistic-looking demo submissions.
// Used only by the admin "Add test people" button. Kept out of the data layer so
// it never ships into real event data, and avoids bundling a heavy faker dependency
// into the client.

const FIRST_NAMES = [
  "Ada", "Mateo", "Priya", "Liam", "Sofia", "Kenji", "Noor", "Diego",
  "Amara", "Felix", "Yuki", "Olamide", "Hannah", "Ravi", "Elena", "Marcus",
  "Ingrid", "Tariq", "Chloe", "Sven", "Aisha", "Theo", "Mei", "Lucas",
];

const LAST_NAMES = [
  "Okafor", "Nguyen", "Patel", "Rossi", "Kim", "Andersson", "Haddad", "Silva",
  "Müller", "Tanaka", "Oyelaran", "Costa", "Ivanova", "Reyes", "Bauer", "Khan",
  "Larsen", "Mensah", "Dubois", "Greco",
];

const PRODUCT_ADJECTIVES = [
  "Realtime", "Offline-first", "AI-native", "Zero-config", "Self-hosted",
  "Collaborative", "Local-first", "Edge", "Privacy-first", "Open-source",
];

const PRODUCT_NOUNS = [
  "notebook", "queue", "CRM", "search engine", "design tool", "data pipeline",
  "agent runtime", "dashboard", "code reviewer", "scheduler", "analytics layer",
  "voice assistant", "knowledge base", "API gateway", "feature-flag platform",
];

const CATEGORIES = ["AI", "Devtools", "Consumer", "Hardware", "Fintech", "Health", "Climate", "Robotics"];

const DESCRIPTION_TEMPLATES = [
  (p: string) => `A ${p} that ships in an afternoon. Demoing the live onboarding flow.`,
  (p: string) => `We built a ${p} after getting fed up with the status quo. 3-min live demo.`,
  (p: string) => `${p} for small teams. I'll show the part judges always ask about.`,
  (p: string) => `Early prototype of a ${p}. Looking for brutally honest feedback.`,
  (p: string) => `Turning a weekend hack into a real ${p}. Live, no slides.`,
];

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomPhone() {
  const area = 200 + Math.floor(Math.random() * 800);
  const mid = 100 + Math.floor(Math.random() * 900);
  const last = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `+1 ${area} ${mid} ${last}`;
}

export type SamplePerson = {
  name: string;
  demoTitle: string;
  description: string;
  phone: string;
  email: string;
  twitter: string;
  linkedin: string;
  category: string;
};

export function makeSamplePerson(): SamplePerson {
  const first = pick(FIRST_NAMES);
  const last = pick(LAST_NAMES);
  const name = `${first} ${last}`;
  const product = `${pick(PRODUCT_ADJECTIVES)} ${pick(PRODUCT_NOUNS)}`;
  const handle = `${first}${last}`.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
  // Small numeric suffix keeps emails/handles from colliding within a seeded batch.
  const suffix = Math.floor(Math.random() * 90) + 10;

  return {
    name,
    demoTitle: product.replace(/^./, (c) => c.toUpperCase()),
    description: pick(DESCRIPTION_TEMPLATES)(product),
    phone: randomPhone(),
    email: `${handle}${suffix}@example.com`,
    twitter: `@${handle}`,
    linkedin: `in/${handle}-${suffix}`,
    category: pick(CATEGORIES),
  };
}
