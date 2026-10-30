// Full-page three-blob backdrop + dot grid, from brand/background/tokens.css
// (emerald / amber / teal at the brand's exact rgba values).
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-bg">
      <div className="absolute -top-40 -left-32 h-[32rem] w-[32rem] rounded-full bg-[rgba(52,211,153,0.35)] blur-[80px]" />
      <div className="absolute -top-24 right-[-10rem] h-[28rem] w-[28rem] rounded-full bg-[rgba(252,211,77,0.4)] blur-[80px]" />
      <div className="absolute bottom-[-14rem] left-1/3 h-[34rem] w-[34rem] rounded-full bg-[rgba(110,231,183,0.3)] blur-[80px]" />
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: "radial-gradient(circle, var(--fg) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
    </div>
  );
}
