import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-xl border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-200 outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_8px_20px_rgb(191_95_69/22%)] hover:bg-(--accent-strong)",
        outline:
          "border-border bg-card text-foreground shadow-sm hover:border-primary hover:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground",
        secondary:
          "border-border bg-card text-foreground shadow-sm hover:border-primary hover:bg-muted aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        navigation:
          "justify-start text-muted-foreground hover:bg-muted hover:text-foreground aria-current:page:bg-accent aria-current:page:text-accent-foreground",
        destructive:
          "border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-10 gap-2 px-4 py-2.5",
        xs: "min-h-7 gap-1 rounded-lg px-2 text-xs",
        sm: "min-h-9 gap-1.5 rounded-lg px-3 text-xs",
        lg: "min-h-12 gap-2 px-5",
        icon: "size-9 rounded-lg p-0",
        "icon-xs": "size-6 rounded-md p-0",
        "icon-sm": "size-7 rounded-lg p-0",
        "icon-lg": "size-10 rounded-xl p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
