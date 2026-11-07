import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main className="narrow-page">
      <section className="panel panel-pad" style={{ width: "min(560px, 100%)" }}>
        <p className="eyebrow">Demo Queue</p>
        <h1 style={{ fontSize: "clamp(26px, 3vw, 34px)", lineHeight: 1.1 }}>
          This page doesn&apos;t exist.
        </h1>
        <p className="lead">The link may be mistyped or out of date.</p>
        <div className="actions">
          <a className="button" href="/events">Go to events</a>
        </div>
      </section>
    </main>
  );
}
