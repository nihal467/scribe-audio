import * as React from "react";
import { cn } from "@/lib/utils";

export function Progress({
  value,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-slate-200", className)}
      {...props}
    >
      <div
        className="h-full bg-sky-500 transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
