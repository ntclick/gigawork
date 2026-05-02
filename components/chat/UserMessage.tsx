export function UserMessage({ text }: { text: string }) {
  return (
    <div className="gw-slide-in-right flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md border border-white/10 bg-gradient-to-br from-white/[0.10] to-white/[0.04] px-4 py-2.5 text-sm leading-relaxed text-white/95 shadow-[0_4px_16px_-8px_rgba(255,255,255,0.1)]">
        {text}
      </div>
    </div>
  )
}
