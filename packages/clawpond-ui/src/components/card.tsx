import type { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
}

export function Card({
  title,
  description,
  className = "",
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={`rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 ${className}`}
      {...props}
    >
      {title && (
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {title}
        </h3>
      )}
      {description && (
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
      )}
      {children && <div className={title ? "mt-4" : ""}>{children}</div>}
    </div>
  );
}
