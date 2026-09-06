import Link from "next/link";
import { SavedEventLinks } from "@/components/SavedEventLinks";

export default function SavedPage() { return <main className="workspace"><div className="workspace-content"><Link className="workspace-brand" href="/events">Demo Queue</Link><div className="workspace-heading"><h1>Saved event links</h1><p>Event links saved on this device.</p></div><SavedEventLinks /><Link href="/events">Back to events</Link></div></main>; }
