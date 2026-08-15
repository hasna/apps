import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "@/lib/utils";

// Format: { [key]: { label: string, color: string, icon?: React.ComponentType } }
export type ChartConfig = Record<
  string,
  {
    label: string;
    color: string;
    icon?: React.ComponentType;
  }
>;

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }
  return context;
}

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    config: ChartConfig;
    children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
  }
>(({ id, className, children, config, ...props }, ref) => {
  const uniqueId = React.useId();
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        ref={ref}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted/50 [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none",
          className
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
});
ChartContainer.displayName = "ChartContainer";

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(([, cfg]) => cfg.color);

  if (!colorConfig.length) return null;

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
[data-chart="${id}"] {
${colorConfig
  .map(([key, cfg]) => `  --color-${key}: ${cfg.color};`)
  .join("\n")}
}
`,
      }}
    />
  );
};

const ChartTooltip = RechartsPrimitive.Tooltip;

const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
>(
  (
    {
      active,
      payload,
      className,
      indicator = "dot",
      hideLabel = false,
      hideIndicator = false,
      label,
      labelKey,
      nameKey,
      formatter,
    }: {
      active?: boolean;
      payload?: Array<{ name: string; value: number; dataKey: string; color: string; payload: Record<string, unknown> }>;
      className?: string;
      indicator?: "line" | "dot" | "dashed";
      hideLabel?: boolean;
      hideIndicator?: boolean;
      label?: string;
      labelKey?: string;
      nameKey?: string;
      formatter?: (value: number, name: string) => React.ReactNode;
    },
    ref
  ) => {
    const { config } = useChart();

    if (!active || !payload?.length) return null;

    return (
      <div
        ref={ref}
        className={cn(
          "grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
          className
        )}
      >
        {!hideLabel && (
          <div className="font-medium">{labelKey && payload[0]?.payload ? String(payload[0].payload[labelKey]) : label}</div>
        )}
        <div className="grid gap-1.5">
          {payload.map((item) => {
            const key = nameKey ? (item.payload?.[nameKey] as string) : (item.dataKey as string);
            const itemConfig = config[key] || { label: key, color: item.color || "var(--color-primary)" };
            const indicatorColor = item.color || itemConfig.color;

            return (
              <div key={item.dataKey} className="flex items-center gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground">
                {!hideIndicator && (
                  <div
                    className={cn("shrink-0 rounded-[2px] border-[--color-border] bg-[--color-bg]", {
                      "h-2.5 w-2.5": indicator === "dot",
                      "w-1 h-full": indicator === "line",
                      "w-0 border-[1.5px] border-dashed bg-transparent h-full": indicator === "dashed",
                    })}
                    style={
                      {
                        "--color-bg": indicatorColor,
                        "--color-border": indicatorColor,
                      } as React.CSSProperties
                    }
                  />
                )}
                <div className="flex flex-1 justify-between items-center leading-none gap-2">
                  <span className="text-muted-foreground">{itemConfig.label}</span>
                  <span className="font-mono font-medium tabular-nums text-foreground">
                    {formatter ? formatter(item.value as number, key) : (item.value as number)?.toLocaleString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);
ChartTooltipContent.displayName = "ChartTooltipContent";

const ChartLegend = RechartsPrimitive.Legend;

const ChartLegendContent = React.forwardRef<
  HTMLDivElement,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
>(({ className, payload, nameKey, ...props }: { className?: string; payload?: Array<{ value: string; dataKey?: string; color?: string }>; nameKey?: string; [k: string]: unknown }, ref) => {
  const { config } = useChart();

  if (!payload?.length) return null;

  return (
    <div ref={ref} className={cn("flex items-center justify-center gap-4 pt-3", className)} {...props}>
      {payload.map((entry: { value: string; dataKey?: string; color?: string }) => {
        const key = nameKey ? (entry.value as string) : (entry.dataKey as string) || (entry.value as string);
        const itemConfig = config[key] || { label: key, color: entry.color || "var(--color-primary)" };

        return (
          <div key={key} className="flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground">
            <div className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: entry.color || itemConfig.color }} />
            <span className="text-muted-foreground">{itemConfig.label}</span>
          </div>
        );
      })}
    </div>
  );
});
ChartLegendContent.displayName = "ChartLegendContent";

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
};
