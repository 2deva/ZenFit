export const ZenLogo = ({ className = "w-full h-full", monochrome = false }: { className?: string, monochrome?: boolean }) => (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <defs>
            <linearGradient id="logoGradientClaude" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#E87A38" />
                <stop offset="100%" stopColor="#D96922" />
            </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="11" stroke={monochrome ? "currentColor" : "url(#logoGradientClaude)"} strokeWidth="3" fill="none" strokeLinecap="round" strokeDasharray="55 14" />
        <circle cx="16" cy="16" r="4" fill={monochrome ? "currentColor" : "url(#logoGradientClaude)"} />
    </svg>
);
