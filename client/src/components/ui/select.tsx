"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp, Search } from "lucide-react"

import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background data-[placeholder]:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

type SelectContentProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content> & {
  searchable?: boolean;
};

const getSelectItemText = (node: React.ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getSelectItemText).join(" ");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return getSelectItemText(node.props.children);
  }
  return "";
};

const filterSelectItems = (children: React.ReactNode, query: string): { children: React.ReactNode; total: number; matches: number } => {
  let total = 0;
  let matches = 0;
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const filterNode = (node: React.ReactNode): React.ReactNode => {
    if (Array.isArray(node)) return node.map(filterNode);
    if (!React.isValidElement<{ children?: React.ReactNode; value?: string }>(node)) return node;
    if (node.type === SelectItem) {
      total += 1;
      const matchesQuery = !normalizedQuery
        || getSelectItemText(node.props.children).toLocaleLowerCase().includes(normalizedQuery)
        || node.props.value?.toLocaleLowerCase().includes(normalizedQuery);
      if (!matchesQuery) return null;
      matches += 1;
      return node;
    }
    if (node.type === React.Fragment) {
      return React.cloneElement(node, undefined, filterNode(node.props.children));
    }
    if (node.props.children !== undefined) {
      return React.cloneElement(node, undefined, filterNode(node.props.children));
    }
    return node;
  };

  return { children: filterNode(children), total, matches };
};

/**
 * Keyboard handling for a search box that lives inside a Select list.
 * Without it the box swallows every key, so the list cannot be driven from the keyboard.
 *   ArrowDown / PageDown -> first option      ArrowUp / End -> last option
 *   Enter                -> pick first match  Escape / Tab -> left to Radix (close)
 * From the options, Radix already handles Up/Down/Home/End/Enter; SelectContent hands ArrowUp on the
 * first option back to the search box (see onKeyDown below).
 */
export function handleSelectSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
  const key = event.key;
  if (key === "Escape" || key === "Tab") return;
  event.stopPropagation(); // stop Radix typeahead from eating the characters being typed
  const listbox = event.currentTarget.closest('[role="listbox"]');
  if (!listbox) return;
  const options = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]:not([data-disabled])'));
  if (options.length === 0) return;
  if (key === "ArrowDown" || key === "PageDown") {
    event.preventDefault();
    options[0].focus();
  } else if (key === "ArrowUp" || key === "End") {
    event.preventDefault();
    options[options.length - 1].focus();
  } else if (key === "Enter") {
    event.preventDefault();
    options[0].focus();
    options[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  }
}

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  SelectContentProps
>(({ className, children, position = "popper", searchable = true, onCloseAutoFocus, onKeyDown, ...props }, ref) => {
  const [search, setSearch] = React.useState("");
  const filtered = searchable ? filterSelectItems(children, search) : null;

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={cn(
          "relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]",
          position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        onCloseAutoFocus={(event) => {
          setSearch("");
          onCloseAutoFocus?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.key !== "ArrowUp") return;
          // ArrowUp on the first option goes back to the search box (if this list has one).
          const target = event.target as HTMLElement;
          const listbox = event.currentTarget as HTMLElement;
          const options = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]:not([data-disabled])'));
          const searchBox = listbox.querySelector<HTMLInputElement>("[data-select-search]");
          if (searchBox && options[0] === target) {
            event.preventDefault();
            event.stopPropagation();
            searchBox.focus();
          }
        }}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
          )}
        >
          {searchable && filtered && filtered.total > 0 && (
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/50 bg-popover px-2">
              <Search className="h-3.5 w-3.5 shrink-0 opacity-50" />
              <input
                type="search"
                aria-label="Search options"
                placeholder="Search..."
                data-select-search
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={handleSelectSearchKeyDown}
                className="h-9 min-w-0 flex-1 bg-transparent text-sm text-inherit outline-none placeholder:text-muted-foreground"
              />
            </div>
          )}
          {searchable && filtered ? filtered.children : children}
          {searchable && filtered && filtered.total > 0 && filtered.matches === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">No matching options</div>
          )}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
})
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>

    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
