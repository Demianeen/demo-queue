"use client";

import { useCallback, type ComponentProps, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Moving between an event's tabs and views only changes `?view=` and friends,
 * but a Next navigation on this dynamic route asks the server for the page
 * again (auth and the event's details) before anything changes. When the
 * address stays on the same page, these go through history.pushState and
 * replaceState instead, which Next keeps in step with useSearchParams, so the
 * switch is instant and back and forward still work. A link to another page
 * is an ordinary Next navigation.
 */
function samePage(href: string) {
  const url = new URL(href, window.location.href);
  return url.origin === window.location.origin && url.pathname === window.location.pathname;
}

function showInPage(href: string, { replace = false, scroll = true }: { replace?: boolean; scroll?: boolean } = {}) {
  const url = new URL(href, window.location.href);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (replace) window.history.replaceState(null, "", next);
  else window.history.pushState(null, "", next);
  if (scroll) window.scrollTo({ top: 0 });
}

/** router.push for in-page state: same page goes through history, another page navigates. */
export function useInPageNavigate() {
  const router = useRouter();
  return useCallback((href: string, options: { replace?: boolean; scroll?: boolean } = {}) => {
    if (samePage(href)) showInPage(href, options);
    else if (options.replace) router.replace(href, { scroll: options.scroll });
    else router.push(href, { scroll: options.scroll });
  }, [router]);
}

/** A Link that switches in the page when it stays on the same page. Opening in a new tab works as usual. */
export function InPageLink({ href, replace, scroll, onClick, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (props.target && props.target !== "_self") return;
    if (!samePage(href)) return;
    event.preventDefault();
    showInPage(href, { replace, scroll: scroll !== false });
  };
  return <Link href={href} replace={replace} scroll={scroll} prefetch={false} onClick={handleClick} {...props} />;
}
