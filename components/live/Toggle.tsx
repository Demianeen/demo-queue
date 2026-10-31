import styles from "./live.module.css";

/** A small on and off switch: a checkbox with role="switch". */
export function Toggle({ label, checked, disabled, title, describedBy, onChange }: { label: string; checked: boolean; disabled?: boolean; title?: string; describedBy?: string; onChange: (checked: boolean) => unknown }) {
  return <label className={styles.toggle} title={title}>
    <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-describedby={describedBy} onChange={(changeEvent) => void onChange(changeEvent.currentTarget.checked)} />
    <span className={styles.toggleTrack} aria-hidden />{label}
  </label>;
}
