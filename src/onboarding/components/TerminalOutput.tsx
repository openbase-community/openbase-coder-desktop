export function TerminalOutput({ lines }: { lines: string[] }) {
  return (
    <div className="h-72 overflow-auto rounded-xl border border-[#17365f] bg-[#071a35] px-3 py-2 font-mono text-xs leading-5 text-slate-100 shadow-inner">
      {lines.length === 0 ? (
        <div className="text-zinc-500">Setup output will appear here.</div>
      ) : (
        lines.map((line, index) => (
          <div key={`${index}-${line.slice(0, 16)}`} className="whitespace-pre-wrap break-words">
            {line}
          </div>
        ))
      )}
    </div>
  );
}
