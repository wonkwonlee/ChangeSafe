export function CaseStudyBadge({ label }: { readonly label: string }) {
  return (
    <span
      className="eyebrow ml-2 rounded border border-active/50 bg-active/10 px-2 py-1 text-active"
      title={`Featured in docs/CASE_STUDIES.md — ${label}`}
    >
      Case study
    </span>
  );
}
