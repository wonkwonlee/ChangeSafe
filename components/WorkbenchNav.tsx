import Link from "next/link";

type WorkbenchDestination = "network" | "terraform" | "kubernetes" | "self-hosted";

const DESTINATIONS: ReadonlyArray<{ id: WorkbenchDestination; label: string; href: string }> = [
  { id: "network", label: "Network", href: "/" },
  { id: "terraform", label: "Terraform", href: "/workbench/terraform" },
  { id: "kubernetes", label: "Kubernetes", href: "/workbench/kubernetes" },
  { id: "self-hosted", label: "Authenticated self-hosted", href: "/workbench/self-hosted" },
];

const linkClassName = "inline-flex rounded-md px-3 py-2 text-sm text-ink-dim hover:text-ink";
const activeClassName =
  "inline-flex rounded-md border border-active/50 bg-active/10 px-3 py-2 text-sm text-active";

/**
 * Single source of truth for the domain-switch nav shared by every workbench
 * shell. `active` is the current destination; it renders as a non-link span
 * (there is no link to the page you're already on) rather than a duplicate
 * `href="/"` alongside a plain "Home" link.
 */
export function WorkbenchNav({
  active,
  showSources = false,
}: {
  active: WorkbenchDestination;
  showSources?: boolean;
}) {
  return (
    <nav
      aria-label="Product navigation"
      className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-6"
    >
      <Link className="mr-auto text-base font-bold tracking-tight text-ink" href="/">
        ChangeSafe <span className="ml-2 text-xs font-normal text-ink-dim">infrastructure change airlock</span>
      </Link>
      {DESTINATIONS.map((destination) =>
        destination.id === active ? (
          <span key={destination.id} aria-current="page" className={activeClassName}>
            {destination.label}
          </span>
        ) : (
          <Link key={destination.id} className={linkClassName} href={destination.href}>
            {destination.label}
          </Link>
        ),
      )}
      {showSources ? (
        <a className={linkClassName} href="#sources">
          Sources
        </a>
      ) : null}
    </nav>
  );
}
