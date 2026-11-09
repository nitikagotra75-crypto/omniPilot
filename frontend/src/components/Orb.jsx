/** Pilo, the OmniPilot mascot. It only animates while a task is running. */
export function Orb({ size = 40, busy = false }) {
  return (
    <div className={`shrink-0 ${busy ? "animate-bounce2" : ""}`} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 100 100" width={size} height={size} overflow="visible">
        <path d="M50 24 Q48 14 52 8" stroke="#231942" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <polygon
          points="53,-4 56,3 63,3.5 57.5,8 59.5,15 53,11 46.5,15 48.5,8 43,3.5 50,3"
          fill="#ffe566"
          stroke="#231942"
          strokeWidth="2.5"
          strokeLinejoin="round"
          className={busy ? "animate-twirl" : ""}
          style={{ transformOrigin: "53px 6px" }}
        />
        <ellipse cx="36" cy="90" rx="10" ry="6" fill="#7cc6f2" stroke="#231942" strokeWidth="3.5" />
        <ellipse cx="64" cy="90" rx="10" ry="6" fill="#7cc6f2" stroke="#231942" strokeWidth="3.5" />
        <ellipse cx="50" cy="58" rx="40" ry="34" fill="#9bd8ff" stroke="#231942" strokeWidth="3.5" />
        <ellipse cx="33" cy="40" rx="11" ry="6" fill="#fff" opacity=".6" transform="rotate(-28 33 40)" />
        <g style={{ transformOrigin: "50px 56px", animation: "blink 4.2s infinite" }}>
          <ellipse cx="35" cy="56" rx="9" ry="11" fill="#fff" stroke="#231942" strokeWidth="3" />
          <ellipse cx="65" cy="56" rx="9" ry="11" fill="#fff" stroke="#231942" strokeWidth="3" />
          <circle cx="37" cy="58" r="5.5" fill="#231942" />
          <circle cx="67" cy="58" r="5.5" fill="#231942" />
          <circle cx="39" cy="55.5" r="2" fill="#fff" />
          <circle cx="69" cy="55.5" r="2" fill="#fff" />
        </g>
        <ellipse cx="22" cy="70" rx="7" ry="4" fill="#ff9ac1" opacity=".85" />
        <ellipse cx="78" cy="70" rx="7" ry="4" fill="#ff9ac1" opacity=".85" />
        {busy ? (
          <ellipse cx="50" cy="73" rx="5" ry="5.5" fill="#231942" />
        ) : (
          <path d="M43 70 Q50 79 57 70" stroke="#231942" strokeWidth="3.2" fill="none" strokeLinecap="round" />
        )}
      </svg>
    </div>
  );
}
