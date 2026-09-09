export function SectionLabel({ number, children, id }: { number: string; children: React.ReactNode; id?: string }) {
  return <h2 className="section-label" id={id}><span className="section-number">{number}.</span><span>{children}</span></h2>;
}
