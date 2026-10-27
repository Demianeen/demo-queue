import { notFound } from "next/navigation";
import { DevDayPreview } from "./Preview";

// This route renders synthetic data only. It is never available in a production build.
export default function DevDayThemePreviewPage() {
  if (process.env.NODE_ENV !== "development" || process.env.DEMO_QUEUE_THEME_PREVIEW !== "1") {
    notFound();
  }

  return <DevDayPreview />;
}
