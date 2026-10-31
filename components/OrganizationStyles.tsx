"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { Check, ExternalLink, MoreHorizontal, Pencil, Plus, Smartphone } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { StagePresentationPreview } from "./StagePresentationPreview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { groupStyles, styleDate, styleEntries, type StyleEntry } from "@/lib/style-library";
import { PREVIEW_TABS, parsePreviewPage, previewPageLabel, previewTab, stylePreviewPath, type PreviewPage, type PreviewStyle } from "@/lib/style-preview";
import { buildStylePreviewStage } from "@/lib/style-preview-fixture";
import { useSiteOrigin } from "@/lib/use-site-origin";

type Brand = Doc<"styleBrands">;
type Device = "desktop" | "phone";
const DEVICES: Record<Device, { label: string; width: number; height: number }> = {
  desktop: { label: "Desktop", width: 1440, height: 900 },
  phone: { label: "Phone", width: 390, height: 844 },
};
const NO_DEFAULT = "none";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ConvexError && typeof error.data === "string" ? error.data : fallback;
}

function previewStyle(entry: StyleEntry): PreviewStyle {
  return entry.preset ? { visualStyle: entry.preset } : { visualStyle: "neutral", theme: entry.theme };
}

/** A built-in by name or a saved style by id, as the brand mutations take it. */
function styleRef(entry: StyleEntry) {
  return entry.preset ? { kind: "preset" as const, preset: entry.preset } : { kind: "saved" as const, id: entry.savedId as Doc<"organizationStyles">["_id"] };
}

/**
 * Styles: the organization's styles grouped by brand on the left, and the
 * selected one on the right as the real pages render it. Which style, page
 * and device are shown lives in the address (?style=&page=&device=).
 */
export function OrganizationStyles({ organizationId, organizationName, styles, brands, active }: {
  organizationId: string; organizationName: string; styles: Doc<"organizationStyles">[]; brands: Brand[];
  /** The page is mounted hidden behind the others; the preview loads only while it shows. */
  active: boolean;
}) {
  const search = useSearchParams();
  const entries = useMemo(() => styleEntries(styles), [styles]);
  const groups = useMemo(() => groupStyles(entries, brands), [entries, brands]);
  const ordered = groups.flatMap((group) => group.styles);
  const defaultEntry = entries.find((entry) => entry.isDefault);
  const selected = entries.find((entry) => entry.key === search.get("style")) ?? defaultEntry ?? ordered[0];
  const page = parsePreviewPage(search.get("page") ?? "") ?? "stage";
  const device: Device = search.get("device") === "phone" ? "phone" : "desktop";

  // View state, so it goes through history.replaceState, which Next keeps in step with useSearchParams.
  const setParams = useCallback((patch: Record<string, string | null>) => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const next = params.toString();
    window.history.replaceState(null, "", next ? `/styles?${next}` : "/styles");
  }, []);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [newBrandFor, setNewBrandFor] = useState<StyleEntry | "none" | null>(null);
  const setPresetDefault = useMutation(api.organizationStyles.setPresetDefault);
  const setSavedDefault = useMutation(api.organizationStyles.setSavedDefault);
  const clearDefault = useMutation(api.organizationStyles.clearDefault);
  const setStyleBrand = useMutation(api.organizationStyles.setStyleBrand);

  /** Runs one change at a time; the controls wait while it saves. */
  async function run(change: () => Promise<unknown>, done: string, fallback: string) {
    setBusy(true); setNotice(""); setError("");
    try { await change(); setNotice(done); return true; }
    catch (error) { setError(errorMessage(error, fallback)); return false; }
    finally { setBusy(false); }
  }
  function setDefault(key: string) {
    const entry = entries.find((item) => item.key === key);
    const expectedOrganizationId = organizationId;
    void run(
      () => !entry ? clearDefault({ expectedOrganizationId })
        : entry.preset ? setPresetDefault({ expectedOrganizationId, preset: entry.preset })
        : setSavedDefault({ expectedOrganizationId, id: entry.savedId as Doc<"organizationStyles">["_id"] }),
      entry ? `${entry.name} is the default for new events. Existing events keep their style.` : "No default. New event asks for a style.",
      "Could not change the default. Please try again.",
    );
  }
  function moveToBrand(entry: StyleEntry, brandId: Brand["_id"] | undefined) {
    const brand = brands.find((item) => item._id === brandId);
    void run(() => setStyleBrand({ expectedOrganizationId: organizationId, style: styleRef(entry), brandId }),
      brand ? `${entry.name} is in ${brand.name}.` : `${entry.name} has no brand.`, "Could not change the brand. Please try again.");
  }

  const savedCount = entries.filter((entry) => !entry.preset).length;
  return <section className="styles-layout">
    <h1 className="sr-only">Styles</h1>
    <div className="styles-column">
      <div className="flex items-center gap-2"><h2 className="ws-card-title">Styles</h2><span className="ws-count">{entries.length}</span></div>
      <div className="ws-card ws-card-body styles-default">
        <label htmlFor="style-default" className="ws-label">Default for new events</label>
        <Select items={[{ value: NO_DEFAULT, label: "No default" }, ...entries.map((entry) => ({ value: entry.key, label: entry.name }))]} value={defaultEntry?.key ?? NO_DEFAULT} disabled={busy} onValueChange={(value) => { if (value) setDefault(value); }}>
          <SelectTrigger id="style-default" className="min-h-9 rounded-lg py-1.5 text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent className="workspace-popup">
            <SelectItem value={NO_DEFAULT}>No default</SelectItem>
            {groups.map((group) => <SelectGroup key={group.brand?._id ?? "none"}>
              <SelectLabel>{group.brand?.name ?? "No brand"}</SelectLabel>
              {group.styles.map((entry) => <SelectItem key={entry.key} value={entry.key}>{entry.name}</SelectItem>)}
            </SelectGroup>)}
          </SelectContent>
        </Select>
        <p className="ws-help">{defaultEntry ? `New events in ${organizationName} start in ${defaultEntry.name}. Each event can pick another.` : "New event asks you to pick a style, with each brand's styles together."}</p>
      </div>
      {busy && <p role="status" className="ws-sub">Saving…</p>}
      {!busy && notice && <p role="status" className="ws-success">{notice}</p>}
      {error && <p role="alert" className="ws-error">{error}</p>}

      {groups.map((group) => <StyleGroupSection key={group.brand?._id ?? "none"} organizationId={organizationId} brand={group.brand} styles={group.styles} brands={brands} selectedKey={selected?.key} busy={busy}
        onSelect={(entry) => setParams({ style: entry.key })} onSetDefault={setDefault} onMove={moveToBrand} onNewBrand={(entry) => setNewBrandFor(entry)} />)}

      {newBrandFor ? <NewBrandForm organizationId={organizationId} forStyle={newBrandFor === "none" ? undefined : newBrandFor} onDone={(name) => { setNewBrandFor(null); if (name) { setError(""); setNotice(`${name} is ready.`); } }} />
        : <Button variant="outline" size="sm" className="self-start" disabled={busy} onClick={() => setNewBrandFor("none")}><Plus aria-hidden />New brand</Button>}
      {!brands.length && !newBrandFor && <p className="ws-help">Group styles by brand, such as a sponsor, so New event lists them together.</p>}
      {!savedCount && <p className="ws-help">No saved styles yet. Styles you save show here with the date they were made, newest first.</p>}
    </div>

    {selected ? <StylePreview entry={selected} page={page} device={device} active={active}
      onPage={(next) => setParams({ page: next === "stage" ? null : next })} onDevice={(next) => setParams({ device: next === "desktop" ? null : next })} />
      : <p className="ws-sub">This style is no longer available. Choose another style.</p>}
  </section>;
}

function StyleGroupSection({ organizationId, brand, styles, brands, selectedKey, busy, onSelect, onSetDefault, onMove, onNewBrand }: {
  organizationId: string; brand: Brand | null; styles: StyleEntry[]; brands: Brand[]; selectedKey?: string; busy: boolean;
  onSelect: (entry: StyleEntry) => void; onSetDefault: (key: string) => void; onMove: (entry: StyleEntry, brandId: Brand["_id"] | undefined) => void; onNewBrand: (entry: StyleEntry) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const title = brand?.name ?? "No brand";
  return <section className="style-group" aria-label={title}>
    {renaming && brand ? <RenameBrandForm organizationId={organizationId} brand={brand} onDone={() => setRenaming(false)} />
      : <div className="style-group-head">
        <h3>{title}</h3><span className="ws-count">{styles.length}</span>
        {brand && <button type="button" className="style-group-rename" aria-label={`Rename ${brand.name}`} disabled={busy} onClick={() => setRenaming(true)}><Pencil aria-hidden /></button>}
      </div>}
    {styles.length ? <ul className="style-cards">
      {styles.map((entry) => <StyleCard key={entry.key} entry={entry} brands={brands} selected={entry.key === selectedKey} busy={busy}
        onSelect={() => onSelect(entry)} onSetDefault={onSetDefault} onMove={onMove} onNewBrand={onNewBrand} />)}
    </ul> : <p className="ws-help">No styles in this brand yet. Move one here from its menu.</p>}
  </section>;
}

function StyleCard({ entry, brands, selected, busy, onSelect, onSetDefault, onMove, onNewBrand }: {
  entry: StyleEntry; brands: Brand[]; selected: boolean; busy: boolean;
  onSelect: () => void; onSetDefault: (key: string) => void; onMove: (entry: StyleEntry, brandId: Brand["_id"] | undefined) => void; onNewBrand: (entry: StyleEntry) => void;
}) {
  const brandValue = brands.some((brand) => brand._id === entry.brandId) ? entry.brandId! : NO_DEFAULT;
  return <li className="style-card" data-selected={selected ? "" : undefined}>
    <StyleThumbnail entry={entry} />
    <div className="style-card-meta">
      {/* The button covers the whole card, so the thumbnail picks it too. */}
      <button type="button" className="style-card-pick" aria-pressed={selected} onClick={onSelect}>
        <span className="style-card-name">{entry.name}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger className="style-card-menu" aria-label={`Options for ${entry.name}`} disabled={busy}><MoreHorizontal aria-hidden /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => onSetDefault(entry.isDefault ? NO_DEFAULT : entry.key)}>{entry.isDefault ? "Remove as default" : "Make default for new events"}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Brand</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={brandValue} onValueChange={(value: string) => { if (value !== brandValue) onMove(entry, value === NO_DEFAULT ? undefined : value as Brand["_id"]); }}>
              {brands.map((brand) => <DropdownMenuRadioItem key={brand._id} value={brand._id}>{brand.name}</DropdownMenuRadioItem>)}
              <DropdownMenuRadioItem value={NO_DEFAULT}>No brand</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuItem onClick={() => onNewBrand(entry)}><Plus aria-hidden />New brand…</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div className="style-card-sub">
      <span>{entry.createdAt === undefined ? "Built in" : styleDate(entry.createdAt)}</span>
      {entry.isDefault && <span className="style-card-default"><Check aria-hidden />Default</span>}
    </div>
  </li>;
}

/**
 * The real stage in this style with the sample lineup, scaled into the card.
 * It mounts when the card scrolls near, so a long list stays light.
 */
function StyleThumbnail({ entry }: { entry: StyleEntry }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || near) return;
    const observer = new IntersectionObserver((items) => { if (items.some((item) => item.isIntersecting)) setNear(true); }, { rootMargin: "200px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);
  const style = previewStyle(entry);
  return <div ref={ref} className="style-thumb" aria-hidden inert>
    {near ? <StagePresentationPreview stage={buildStylePreviewStage(style, "stage")} submissionUrl={stylePreviewPath(style, "submit")} /> : <Skeleton className="size-full rounded-none" />}
  </div>;
}

function NewBrandForm({ organizationId, forStyle, onDone }: { organizationId: string; forStyle?: StyleEntry; onDone: (name?: string) => void }) {
  const createBrand = useMutation(api.organizationStyles.createBrand);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      await createBrand({ expectedOrganizationId: organizationId, name, style: forStyle ? styleRef(forStyle) : undefined });
      onDone(name.trim());
    } catch (error) { setError(errorMessage(error, "Could not make the brand. Please try again.")); setSaving(false); }
  }
  return <form className="ws-card ws-card-body" onSubmit={submit} onKeyDown={(event) => { if (event.key === "Escape") onDone(); }}>
    <label htmlFor="new-brand" className="ws-label">New brand</label>
    <Input id="new-brand" autoFocus maxLength={60} placeholder="Sponsor or series name" value={name} onChange={(event) => setName(event.target.value)} disabled={saving} aria-describedby="new-brand-help" />
    <p id="new-brand-help" className="ws-help">{forStyle ? `${forStyle.name} moves into it.` : "Move styles into it from their menu."}</p>
    {error && <p role="alert" className="ws-error">{error}</p>}
    <div className="ws-actions">
      <Button type="button" variant="ghost" size="sm" onClick={() => onDone()} disabled={saving}>Cancel</Button>
      <Button type="submit" size="sm" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Create brand"}</Button>
    </div>
  </form>;
}

function RenameBrandForm({ organizationId, brand, onDone }: { organizationId: string; brand: Brand; onDone: () => void }) {
  const renameBrand = useMutation(api.organizationStyles.renameBrand);
  const [name, setName] = useState(brand.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === brand.name) { onDone(); return; }
    setSaving(true); setError("");
    try { await renameBrand({ expectedOrganizationId: organizationId, id: brand._id, name }); onDone(); }
    catch (error) { setError(errorMessage(error, "Could not rename the brand. Please try again.")); setSaving(false); }
  }
  return <form className="style-group-rename-form" onSubmit={submit} onKeyDown={(event) => { if (event.key === "Escape") onDone(); }}>
    <Input autoFocus aria-label={`New name for ${brand.name}`} maxLength={60} value={name} onChange={(event) => setName(event.target.value)} disabled={saving} />
    <Button type="submit" size="sm" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save"}</Button>
    <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={saving}>Cancel</Button>
    {error && <p role="alert" className="ws-error">{error}</p>}
  </form>;
}

/**
 * The selected style as the real page renders it: the public preview route
 * in a frame, 1440 wide on desktop or 390 wide in a phone, scaled to fit.
 * Open and the phone QR go to the same address.
 */
function StylePreview({ entry, page, device, active, onPage, onDevice }: {
  entry: StyleEntry; page: PreviewPage; device: Device; active: boolean; onPage: (page: PreviewPage) => void; onDevice: (device: Device) => void;
}) {
  const origin = useSiteOrigin();
  const path = stylePreviewPath(previewStyle(entry), page);
  const url = `${origin}${path}`;
  const tab = previewTab(page);
  return <section className="style-preview" aria-label={`${entry.name} preview`}>
    <div className="style-preview-bar">
      <h2 className="ws-card-title">{entry.name}</h2>
      <div className="ws-segment" role="tablist" aria-label="Page">
        {/* A tab opens on its first state: Submitted, or the winners with finalists. */}
        {PREVIEW_TABS.map((item) => <button key={item.label} type="button" role="tab" aria-selected={item === tab} onClick={() => { if (item !== tab) onPage(item.pages[0].page); }}>{item.label}</button>)}
      </div>
      {tab.pages.length > 1 && <div className="ws-segment" role="radiogroup" aria-label={tab.stateLabel}>
        {tab.pages.map((item) => <button key={item.page} type="button" role="radio" aria-checked={item.page === page} onClick={() => onPage(item.page)}>{item.label}</button>)}
      </div>}
      <span className="flex-1" />
      <div className="ws-segment" role="radiogroup" aria-label="Device">
        {(Object.keys(DEVICES) as Device[]).map((item) => <button key={item} type="button" role="radio" aria-checked={item === device} onClick={() => onDevice(item)}>{DEVICES[item].label}</button>)}
      </div>
      <Popover>
        <PopoverTrigger render={<Button variant="outline" size="sm" />}><Smartphone aria-hidden />On your phone</PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="style-preview-qr">
          {origin ? <QRCodeSVG value={url} size={168} marginSize={1} role="img" aria-label={`QR code for the ${previewPageLabel(page).toLowerCase()} sample`} /> : <Skeleton className="size-[168px]" />}
          <p className="ws-help">Scan to open this page on your phone. Sample data, no sign-in.</p>
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="sm" render={<a href={path} target="_blank" rel="noopener" />} nativeButton={false}>Open<ExternalLink aria-hidden /></Button>
    </div>
    <PreviewFrame url={path} title={`${entry.name}: ${previewPageLabel(page).toLowerCase()} sample`} device={device} active={active} />
  </section>;
}

function PreviewFrame({ url, title, device, active }: { url: string; title: string; device: Device; active: boolean }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  useEffect(() => {
    const node = areaRef.current;
    if (!node) return;
    const measure = () => setArea({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const { width, height } = DEVICES[device];
  // Room around the frame: the browser bar on desktop, the bezel on a phone.
  const chrome = device === "desktop" ? { x: 0, y: 28 } : { x: 24, y: 24 };
  const scale = Math.min(1, (area.width - 32 - chrome.x) / width, (area.height - 32 - chrome.y) / height);
  const frameKey = `${device}:${url}`;
  const loading = loadedUrl !== frameKey;
  return <div ref={areaRef} className="style-preview-area">
    {active && scale > 0 && <div className="style-preview-device" data-device={device} style={{ width: width * scale + chrome.x, height: height * scale + chrome.y }}>
      {device === "desktop" && <div className="style-preview-browser" aria-hidden><span /><span /><span /><code>{url}</code></div>}
      <div className="style-preview-screen" style={{ width: width * scale, height: height * scale }}>
        <iframe key={frameKey} src={url} title={title} width={width} height={height} style={{ transform: `scale(${scale})` }} onLoad={() => setLoadedUrl(frameKey)} />
        {loading && <div className="style-preview-loading" role="status" aria-label="Loading the preview"><Skeleton className="h-2/5 w-3/5" /><Skeleton className="h-4 w-2/5" /><Skeleton className="h-4 w-1/3" /></div>}
      </div>
    </div>}
  </div>;
}
