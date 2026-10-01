interface Props { label: string }
export function StubPage({ label }: Props) {
  return (
    <div style={{ padding: 32, color: "var(--muted)", fontFamily: "'JetBrains Mono',monospace", fontSize: 13 }}>
      <div style={{ color: "var(--accent)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
        coming soon
      </div>
      {label}
    </div>
  );
}
