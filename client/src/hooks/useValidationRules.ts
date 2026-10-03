import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_VALIDATION_RULES, normalizeValidationRules, type ValidationRules } from '@shared/timesheetValidation';

export type ValidationRulesRecord = {
  rules: ValidationRules;
  updatedAt: string | null;
  updatedBy: string | null;
};

export const VALIDATION_RULES_QUERY_KEY = '/api/timesheet-validation-rules';

// The Admin-configured timesheet validation rules (saved on the server).
// Falls back to the starting rules while loading; the server always enforces the saved ones.
export function useValidationRules() {
  const query = useQuery<ValidationRulesRecord>({
    queryKey: [VALIDATION_RULES_QUERY_KEY],
    // Always fetch fresh data on mount so toggled states persist correctly after
    // logout / login / page reload without waiting for the stale window.
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
  const rules = useMemo(
    () => (query.data?.rules ? normalizeValidationRules(query.data.rules) : DEFAULT_VALIDATION_RULES),
    [query.data]
  );
  return { rules, record: query.data, isLoading: query.isLoading };
}