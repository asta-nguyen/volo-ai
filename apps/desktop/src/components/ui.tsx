import * as React from "react";
import { ChevronDown, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-200 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:pointer-events-none disabled:opacity-50 active:translate-y-px",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--accent)] text-white shadow-[0_10px_24px_rgb(191_95_69/18%)] hover:bg-[var(--accent-strong)]",
        secondary:
          "border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:border-[var(--accent)] hover:bg-[var(--surface-muted)]",
        ghost:
          "text-[var(--muted-foreground)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]",
        destructive:
          "border border-[var(--destructive-border)] bg-[var(--destructive-surface)] text-[var(--destructive)] hover:bg-[var(--destructive)] hover:text-white",
        icon: "size-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--muted-foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)]",
      },
      size: {
        default: "min-h-10 px-4 py-2.5",
        sm: "min-h-9 px-3 text-xs",
        lg: "min-h-12 px-5",
        icon: "size-9 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_12px_34px_rgb(31_37_34/4%)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-start justify-between gap-4 p-5 pb-0", className)} {...props} />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base font-semibold tracking-[-0.02em]", className)} {...props} />;
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm leading-6 text-[var(--muted-foreground)]", className)} {...props} />
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 text-sm text-[var(--foreground)] shadow-sm transition-colors placeholder:text-[var(--muted-foreground)] hover:border-[var(--border-strong)] focus-visible:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-24 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-sm leading-6 text-[var(--foreground)] shadow-sm transition-colors placeholder:text-[var(--muted-foreground)] hover:border-[var(--border-strong)] focus-visible:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(function Label({ className, ...props }, ref) {
  return (
    <label
      ref={ref}
      className={cn(
        "text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]",
        className,
      )}
      {...props}
    />
  );
});

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-[var(--success-border)] bg-[var(--success-surface)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--success)]",
        className,
      )}
      {...props}
    />
  );
}

export function Separator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="separator" className={cn("h-px w-full bg-[var(--border)]", className)} {...props} />
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-lg bg-[var(--surface-muted)]", className)}
      {...props}
    />
  );
}

export function Progress({ value, className }: { value: number | null; className?: string }) {
  return (
    <ProgressPrimitive.Root value={value} className={cn("w-full", className)} aria-label="Progress">
      <ProgressPrimitive.Track className="h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
        <ProgressPrimitive.Indicator className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500" />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export function Select({
  value,
  onValueChange,
  children,
  disabled,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
  placeholder?: React.ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <SelectPrimitive.Root
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next);
      }}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 text-left text-sm text-[var(--foreground)] shadow-sm outline-none transition-colors hover:border-[var(--border-strong)] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-[var(--muted-foreground)]" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner className="z-50 outline-none" sideOffset={6}>
          <SelectPrimitive.Popup className="min-w-[var(--anchor-width)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 text-sm shadow-[0_18px_40px_rgb(31_37_34/15%)] outline-none data-[open]:animate-in data-[closed]:animate-out">
            <SelectPrimitive.List className="max-h-64 overflow-auto outline-none">
              {children}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <SelectPrimitive.Item
      value={value}
      className="flex cursor-default items-center justify-between rounded-lg px-3 py-2.5 text-[var(--foreground)] outline-none data-[highlighted]:bg-[var(--surface-muted)] data-[selected]:font-semibold"
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="text-[var(--accent)]">
        ✓
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onOpenChange,
  onConfirm,
  busy,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-[rgb(18_24_21/48%)] backdrop-blur-[2px] data-[open]:animate-in data-[closed]:animate-out" />
        <DialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <DialogPrimitive.Popup className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_24px_64px_rgb(18_24_21/24%)] outline-none data-[open]:animate-in data-[closed]:animate-out">
            <div className="flex items-start justify-between gap-5">
              <div>
                <DialogPrimitive.Title className="text-lg font-semibold tracking-[-0.03em] text-[var(--foreground)]">
                  {title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                  {description}
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close
                aria-label="Close"
                className="rounded-lg p-1.5 text-[var(--muted-foreground)] outline-none hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <DialogPrimitive.Close className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none hover:bg-[var(--surface-muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
                {cancelLabel}
              </DialogPrimitive.Close>
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--destructive)] px-4 text-sm font-semibold text-white outline-none hover:bg-[var(--destructive-strong)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50"
                disabled={busy}
                onClick={onConfirm}
              >
                {confirmLabel}
              </button>
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
