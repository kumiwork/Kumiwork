"use client";

import { MODEL_CATALOG, type ModelProvider } from "@kumiwork/core";
import { GroupedSelect } from "@kumiwork/shared";
import { useTranslation } from "@/lib/i18n/context";

interface ModelSelectProps {
  value: string;
  onChange: (modelId: string) => void;
  className?: string;
}

export function ModelSelect({ value, onChange, className }: ModelSelectProps) {
  const { t } = useTranslation();
  return (
    <GroupedSelect
      value={value}
      onChange={onChange}
      className={className}
      options={MODEL_CATALOG.map((entry) => ({ key: entry.id, value: entry.id, label: entry.label, group: entry.provider }))}
      groupLabel={(provider) => t(`models.provider.${provider as ModelProvider}`)}
    />
  );
}
