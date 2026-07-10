import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:h-4 [&>svg]:w-4 [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "border-slate-200 bg-white text-slate-900",
        info: "border-sky-200 bg-sky-50 text-sky-900 [&>svg]:text-sky-600",
        warning: "border-amber-200 bg-amber-50 text-amber-900 [&>svg]:text-amber-600",
        danger: "border-red-200 bg-red-50 text-red-900 [&>svg]:text-red-600",
        success: "border-emerald-200 bg-emerald-50 text-emerald-900 [&>svg]:text-emerald-600",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

export function Alert({ className, variant, ...props }: AlertProps) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h5 className={cn("mb-1 font-semibold leading-none tracking-tight", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <div className={cn("text-sm leading-relaxed", className)} {...props} />;
}
