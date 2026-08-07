import { forwardRef } from "react";

type Variant = "default" | "outline" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  // --accent-strong, not --accent: white text on --accent is 4.47:1, just
  // under the 4.5:1 AA threshold for normal-size text. --accent-strong is
  // the same brand hue darkened enough to clear it (6.29:1).
  default:
    "bg-[var(--accent-strong)] text-white hover:bg-[var(--accent-strong)]/85 active:scale-[0.97] active:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed",
  outline:
    "border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface-elevated)] active:scale-[0.97] active:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed",
  ghost:
    "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)] active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed",
  destructive:
    "bg-[var(--negative)]/15 text-[var(--negative)] hover:bg-[var(--negative)]/25 active:scale-[0.97] active:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed",
};

const sizeClasses: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs min-h-[44px]",
  md: "px-4 py-2 text-sm min-h-[44px]",
  lg: "px-5 py-2.5 text-sm min-h-[44px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", size = "md", className = "", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    />
  )
);
Button.displayName = "Button";
