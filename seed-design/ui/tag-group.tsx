/**
 * @file ui:tag-group
 * @requires @seed-design/react@^2.0.0 || ^3.0.0
 **/

"use client";

import { PrefixIcon, TagGroup as SeedTagGroup, SuffixIcon } from "@seed-design/react";
import * as React from "react";

export interface TagGroupRootProps extends SeedTagGroup.RootProps {}

/**
 * @see https://seed-design.io/react/components/tag-group
 */
export const TagGroupRoot = SeedTagGroup.Root;

export interface TagGroupItemProps extends Omit<SeedTagGroup.ItemProps, "children" | "asChild"> {
  prefixIcon?: React.ReactNode;

  label: React.ReactNode;

  suffixIcon?: React.ReactNode;
}

/**
 * @see https://seed-design.io/react/components/tag-group
 */
export const TagGroupItem = React.forwardRef<HTMLSpanElement, TagGroupItemProps>(
  ({ prefixIcon, label, suffixIcon, ...props }, ref) => {
    return (
      <SeedTagGroup.Item {...props} ref={ref}>
        {prefixIcon && <PrefixIcon svg={prefixIcon} />}
        <SeedTagGroup.ItemLabel>{label}</SeedTagGroup.ItemLabel>
        {suffixIcon && <SuffixIcon svg={suffixIcon} />}
      </SeedTagGroup.Item>
    );
  },
);

/**
 * This file is a snippet from SEED Design, helping you get started quickly with @seed-design/* packages.
 * You can extend this snippet however you want.
 */
